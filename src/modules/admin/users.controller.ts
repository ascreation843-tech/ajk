import { Context } from 'hono'
import prisma from '../../lib/prisma.js'
import { getCache, setCache, deleteCache, deleteCachePattern } from '../../lib/redis.js'
import { notificationService } from '../../lib/notification.service.js'
import { MediaService } from '../../lib/media.service.js'

const ADMIN_STATS_CACHE_KEY = 'admin:user:stats'

export const getUserStats = async (c: Context) => {
  try {
    // Try to get from cache first
    console.time('fetch-user-stats')
    const cachedData = await getCache(ADMIN_STATS_CACHE_KEY)
    if (cachedData) {
      console.timeEnd('fetch-user-stats')
      return c.json({
        success: true,
        data: cachedData,
        cached: true
      })
    }

    console.time('db-stats-queries')
    // 1-3. Fetch all counts in a SINGLE raw SQL query to minimize RTT latency
    const rawStats: any[] = await prisma.$queryRaw`
      SELECT 
        (SELECT COUNT(*)::int FROM "users") as "total",
        (SELECT COUNT(*)::int FROM "users" WHERE role IN ('BUSINESS_PARTNER', 'FREELANCER')) as "resellers",
        (SELECT COUNT(*)::int FROM "users" WHERE role IN ('BUYER', 'USER')) as "buyers",
        (SELECT COUNT(*)::int FROM "users" WHERE role = 'ADMIN') as "admins",
        (SELECT COUNT(*)::int FROM "orders") as "totalActions",
        (SELECT COUNT(*)::int FROM "users" WHERE "createdAt" >= CURRENT_DATE) as "newToday"
    `
    const statsResult = rawStats[0] || {
      total: 0, resellers: 0, buyers: 0, admins: 0, totalActions: 0, newToday: 0
    }
    console.timeEnd('db-stats-queries')

    console.time('db-fetch-users')
    // 4. Fetch recent users for the directory (Limit to 100 for performance)
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
        createdAt: true,
      } as any,
      orderBy: { createdAt: 'desc' },
      take: 100
    }) as any[]
    console.timeEnd('db-fetch-users')

    const data = {
      stats: {
        total: statsResult.total,
        resellers: statsResult.resellers,
        buyers: statsResult.buyers,
        admins: statsResult.admins,
        totalActions: statsResult.totalActions,
        newToday: statsResult.newToday
      },
      users: users.map(u => ({
        ...u,
        status: u.isActive ? 'Active' : 'Banned',
        joined: new Date(u.createdAt).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
      }))
    }

    // Cache for 5 minutes (Non-blocking for faster response)
    setCache(ADMIN_STATS_CACHE_KEY, data, 300)
      .catch(err => console.error('[RedisError] stats-cache-set:', err))
    
    console.timeEnd('fetch-user-stats')

    return c.json({
      success: true,
      data: data,
      cached: false
    })
  } catch (error: any) {
    console.error('Admin Fetch User Stats Error:', error)
    return c.json({ success: false, message: 'Failed to fetch user statistics' }, 500)
  }
}

export const toggleUserStatus = async (c: Context) => {
  try {
    const id = c.req.param('id')
    const user = await prisma.user.findUnique({ where: { id } }) as any

    if (!user) {
      return c.json({ success: false, message: 'User not found' }, 404)
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: { isActive: !user.isActive } as any
    }) as any

    // Invalidate dashboard stats cache (Non-blocking)
    console.log(`[Admin] Invalidating stats cache: ${ADMIN_STATS_CACHE_KEY}`)
    deleteCache(ADMIN_STATS_CACHE_KEY)
      .catch(err => console.error('[RedisError] toggle-status-cache-del:', err))
    
    // Invalidate users and freelancers general lists
    deleteCache('admin:users:all').catch(() => {})
    deleteCache('admin:freelancers:all').catch(() => {})

    // Update individual user status cache for instant enforcement in middleware
    await setCache(`user:status:${id}`, updatedUser.isActive, 86400)

    // AS REQUESTED: Proper Redis Caching
    // If user is a Freelancer or Partner, invalidate product lists because their products' 
    // visibility depends on their account status.
    if (user.role === 'FREELANCER' || user.role === 'BUSINESS_PARTNER') {
      deleteCachePattern('products:list:*').catch(() => {})
    }

    // Send Notification (Non-blocking for instant UI response)
    const titleText = updatedUser.isActive ? 'Account Reactivated' : 'Account Temporarily Suspended'
    const bodyText = updatedUser.isActive 
      ? 'Your account has been reactivated by our team. You can continue using the app.'
      : 'Your account has been temporarily suspended. Please contact support for assistance.'
    
    await notificationService.createAndSend(id, {
      type: 'ACCOUNT_STATUS',
      title: titleText,
      body: bodyText,
      data: { status: updatedUser.isActive ? 'ACTIVE' : 'SUSPENDED' }
    }).catch(err => console.error('[NotificationError] ToggleStatus:', err))

    return c.json({
      success: true,
      message: `User ${updatedUser.isActive ? 'activated' : 'suspended'} successfully`,
      data: updatedUser
    })
  } catch (error: any) {
    console.error('Error toggling user status:', error)
    return c.json({ success: false, message: 'Failed to toggle user status' }, 500)
  }
}

export const updateUser = async (c: Context) => {
  try {
    const id = c.req.param('id')
    const data = await c.req.json()
    
    // Check user existence
    const user = await prisma.user.findUnique({ where: { id } })
    if (!user) {
      return c.json({ success: false, message: 'User not found' }, 404)
    }

    // Filter relevant fields for update
    // Separate User and Freelancer updates
    const userUpdateData: any = {}
    const freelancerUpdateData: any = {}

    if (data.name !== undefined) userUpdateData.name = data.name
    if (data.role !== undefined) {
       userUpdateData.role = data.role
    }
    
    // Freelancer specific fields
    if (data.shopName !== undefined) freelancerUpdateData.shopName = data.shopName
    if (data.phone !== undefined) freelancerUpdateData.phone = data.phone
    if (data.region !== undefined) freelancerUpdateData.region = data.region
    
    // Always update legacy User fields for now to maintain backward compatibility if requested
    if (data.shopName !== undefined) userUpdateData.shopName = data.shopName
    if (data.phone !== undefined) userUpdateData.phone = data.phone
    if (data.region !== undefined) userUpdateData.region = data.region

    // Transaction to update both
    const updatedUser = await prisma.$transaction(async (tx) => {
       const u = await tx.user.update({
          where: { id },
          data: userUpdateData
       })

       // Update Freelancer Profile if exists or if we are updating relevant fields
       if (Object.keys(freelancerUpdateData).length > 0) {
          // Check if profile exists
          const profile = await tx.freelancer.findUnique({ where: { userId: id } })
          if (profile) {
             await tx.freelancer.update({
                where: { userId: id },
                data: freelancerUpdateData
             })
          } else if (u.role === 'FREELANCER' || u.role === 'BUSINESS_PARTNER') {
             // Create if missing and role is correct
             await tx.freelancer.create({
                data: {
                   userId: id,
                   ...freelancerUpdateData,
                   isActive: true,
                   isSubscriptionActive: true,
                 }
             })
          }
       }
       return u
    }) as any

    // Invalidate cache (Non-blocking)
    console.log(`[Admin] Updating user ${id}. Invalidating stats cache: ${ADMIN_STATS_CACHE_KEY}`)
    deleteCache(ADMIN_STATS_CACHE_KEY)
      .catch(err => console.error('[RedisError] update-user-cache-del:', err))
    
    // Invalidate users and freelancers general lists
    deleteCache('admin:users:all').catch(() => {})
    deleteCache('admin:freelancers:all').catch(() => {})

    await notificationService.createAndSend(id, { 
      type: 'ACCOUNT_UPDATE', 
      title: 'Account Details Updated', 
      body: 'Your account information was updated by our team.',
      data: { timestamp: new Date().toISOString() }
    }).catch(err => console.error('[NotificationError] UpdateUser:', err))

    return c.json({
      success: true,
      message: 'User profile updated successfully',
      data: updatedUser
    })
  } catch (error: any) {
    console.error('Error updating user:', error)
    return c.json({ success: false, message: 'Failed to update user' }, 500)
  }
}

export const deleteUser = async (c: Context) => {
  try {
    const id = c.req.param('id')
    
    // Check if user exists
    const user = await prisma.user.findUnique({ 
      where: { id },
      include: {
        freelancerProfile: true
      }
    }) as any
    if (!user) {
      return c.json({ success: false, message: 'User not found' }, 404)
    }

    const publicIdsToDelete: string[] = []

    // 1. Gather user's avatar public id
    if (user.avatarPublicId) {
      publicIdsToDelete.push(user.avatarPublicId)
    }

    // 2. Gather user's reviews image public ids
    const userReviews = await prisma.review.findMany({
      where: { userId: id },
      select: { imagePublicIds: true }
    })
    for (const review of userReviews) {
      if (review.imagePublicIds && Array.isArray(review.imagePublicIds)) {
        publicIdsToDelete.push(...review.imagePublicIds)
      }
    }

    // 3. Gather user's orders payment proof public ids
    const userOrderItems = await prisma.orderItem.findMany({
      where: { order: { userId: id } },
      select: { paymentProofPublicId: true }
    })
    for (const item of userOrderItems) {
      if (item.paymentProofPublicId) {
        publicIdsToDelete.push(item.paymentProofPublicId)
      }
    }

    // 4. Gather freelancer-related payment proofs (do not touch product assets)
    if (user.freelancerProfile) {
      const freelancerId = user.freelancerProfile.id
      const freelancerOrderItems = await prisma.orderItem.findMany({
        where: { freelancerId },
        select: { paymentProofPublicId: true }
      })
      for (const item of freelancerOrderItems) {
        if (item.paymentProofPublicId) {
          publicIdsToDelete.push(item.paymentProofPublicId)
        }
      }
    }

    // 5. Run sequential deletion transaction
    await prisma.$transaction(async (tx) => {
      // a) Delete reviews written by the user
      await tx.review.deleteMany({ where: { userId: id } })

      // b) If freelancer profile exists, detach products and order items, then delete freelancer profile
      if (user.freelancerProfile) {
        const freelancerId = user.freelancerProfile.id
        
        // Detach products (DO NOT DELETE/CHANGE PRODUCTS - set freelancerId to null)
        await tx.product.updateMany({
          where: { freelancerId },
          data: { freelancerId: null }
        })

        // Detach order items
        await tx.orderItem.updateMany({
          where: { freelancerId },
          data: { freelancerId: null }
        })

        // Delete freelancer profile
        await tx.freelancer.delete({ where: { id: freelancerId } })
      }

      // c) Delete order items associated with the user's orders
      const userOrders = await tx.order.findMany({
        where: { userId: id },
        select: { id: true }
      })
      const userOrderIds = userOrders.map(o => o.id)

      await tx.orderItem.deleteMany({ where: { orderId: { in: userOrderIds } } })

      // d) Delete user's orders
      await tx.order.deleteMany({ where: { userId: id } })

      // e) Delete cart items and wishlist items of the user
      await tx.cartItem.deleteMany({ where: { userId: id } })
      await tx.wishlistItem.deleteMany({ where: { userId: id } })

      // f) Delete user record (cascades: PushToken, Notification, NotificationPreferences, PasswordResetOtp, EmailVerificationOtp, RefreshToken)
      await tx.user.delete({ where: { id } })
    })

    // 6. Asynchronously delete gathered assets from Cloudinary
    if (publicIdsToDelete.length > 0) {
      MediaService.deleteMany(publicIdsToDelete).catch(err => {
        console.error('[MediaServiceError] Failed to batch delete user assets:', err)
      })
    }

    // Invalidate cache
    console.log(`[Admin] User deleted. Invalidating stats cache: ${ADMIN_STATS_CACHE_KEY}`)
    await deleteCache(ADMIN_STATS_CACHE_KEY)
    await deleteCache('admin:users:all')
    await deleteCache('admin:freelancers:all')

    return c.json({
      success: true,
      message: 'User deleted permanently'
    })
  } catch (error: any) {
    console.error('Error deleting user:', error)
    return c.json({ success: false, message: 'Failed to delete user' }, 500)
  }
}

export const getAllUsers = async (c: Context) => {
    try {
        const cacheKey = 'admin:users:all'
        const cachedUsers = await getCache(cacheKey)
        if (cachedUsers) {
            return c.json({ success: true, data: cachedUsers, cached: true })
        }

        const users = await prisma.user.findMany({
            where: { role: { in: ['USER', 'BUYER'] } },
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              role: true,
              isActive: true,
              avatar: true,
              createdAt: true,
              _count: {
                  select: { orders: true }
              }
            }
        })
        
        const mappedUsers = users.map((u: any) => {
            const { _count, ...rest } = u
            return {
                ...rest,
                totalOrders: _count?.orders || 0
            }
        })

        await setCache(cacheKey, mappedUsers, 300)

        return c.json({ success: true, data: mappedUsers, cached: false })
    } catch (error: any) {
        console.error('Error fetching users:', error)
        return c.json({ success: false, message: 'Failed to fetch users' }, 500)
    }
}

export const getAllFreelancers = async (c: Context) => {
    try {
        const cacheKey = 'admin:freelancers:all'
        const cachedFreelancers = await getCache(cacheKey)
        if (cachedFreelancers) {
            return c.json({ success: true, data: cachedFreelancers, cached: true })
        }

        const freelancers = await prisma.freelancer.findMany({
            where: {
                user: {
                    role: { in: ['FREELANCER', 'BUSINESS_PARTNER'] }
                }
            },
            include: { user: { select: { name: true, email: true, isActive: true, avatar: true, createdAt: true } } },
            orderBy: { shopName: 'asc' }
        })

        const freelancersWithCounts = await Promise.all(freelancers.map(async (f) => {
            const orderCount = await prisma.orderItem.count({
                where: { freelancerId: f.id }
            })
            return {
                ...f,
                totalOrders: orderCount
            }
        }))

        await setCache(cacheKey, freelancersWithCounts, 300)

        return c.json({ success: true, data: freelancersWithCounts, cached: false })
    } catch (error: any) {
        console.error('Error fetching freelancers:', error)
        return c.json({ success: false, message: 'Failed to fetch freelancers' }, 500)
    }
}
