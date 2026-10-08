import { Context } from 'hono'
import prisma from '../../lib/prisma.js'
import { MediaService } from '../../lib/media.service.js'
import { NotificationEvents } from '../../lib/notification.events.js'
import { getCache, setCache, deleteCache, deleteCachePattern, invalidateProductCache, CACHE_TTL } from '../../lib/redis.js'

const MAX_FREELANCER_PRODUCT_IMAGES = 3

function validateFreelancerProductImages(
  images: unknown
): { ok: true; assets: { url: string; publicId: string }[] } | { ok: false; message: string } {
  if (!Array.isArray(images)) {
    return { ok: false, message: 'images must be an array' }
  }
  const assets = images.filter((i): i is { url: string; publicId: string } => 
    typeof i === 'object' && i !== null && typeof i.url === 'string' && typeof i.publicId === 'string'
  )
  if (assets.length < 1) {
    return { ok: false, message: 'Add at least one product image' }
  }
  if (assets.length > MAX_FREELANCER_PRODUCT_IMAGES) {
    return {
      ok: false,
      message: `Maximum ${MAX_FREELANCER_PRODUCT_IMAGES} images per product`,
    }
  }
  return { ok: true, assets }
}

/**
 * GET /freelancer/profile
 * Returns the freelancer profile for the logged-in user
 */
export const getFreelancerProfile = async (c: Context) => {
  try {
    const user = c.get('user') as any
    const profile = await (prisma as any).freelancer.findUnique({
      where: { userId: user.id },
      include: { user: true }
    })

    if (!profile) {
      return c.json({ success: false, message: 'Freelancer profile not found' }, 404)
    }

    return c.json({ success: true, data: profile })
  } catch (error: any) {
    console.error('Get Freelancer Profile Error:', error)
    return c.json({ success: false, message: 'Failed to fetch profile' }, 500)
  }
}

/**
 * PUT /freelancer/profile
 * Update the freelancer profile for the logged-in user
 */
export const updateFreelancerProfile = async (c: Context) => {
  try {
    const user = c.get('user') as any
    const body = await c.req.json()

    const profile = await (prisma as any).freelancer.update({
      where: { userId: user.id },
      data: {
        shopName: body.shopName,
        phone: body.phone,
        region: body.region,
        accountNumber: body.accountNumber,
        accountTitle: body.accountTitle,
        bankName: body.bankName,
      }
    })

    return c.json({ success: true, data: profile })
  } catch (error: any) {
    console.error('Update Freelancer Profile Error:', error)
    return c.json({ success: false, message: 'Failed to update profile' }, 500)
  }
}

/**
 * GET /freelancer/products/:id
 * Returns a specific product belonging to the logged-in freelancer
 */
export const getFreelancerProductById = async (c: Context) => {
  try {
    const user = c.get('user') as any
    const id = c.req.param('id')

    const profile = await (prisma as any).freelancer.findUnique({
      where: { userId: user.id },
      select: { id: true }
    })

    if (!profile) {
      return c.json({ success: false, message: 'Freelancer profile not found' }, 404)
    }

    const product = await (prisma as any).product.findFirst({
      where: { id, freelancerId: profile.id },
      include: {
        _count: {
          select: { orderItems: true }
        }
      }
    })

    if (!product) {
      return c.json({ success: false, message: 'Product not found or unauthorized' }, 404)
    }

    return c.json({ success: true, data: product })
  } catch (error: any) {
    console.error('Get Freelancer Product By ID Error:', error)
    return c.json({ success: false, message: 'Failed to fetch product' }, 500)
  }
}

/**
 * GET /freelancer/products
 * Returns all products belonging to the logged-in freelancer
 */
export const getFreelancerProducts = async (c: Context) => {
  try {
    const user = c.get('user') as any
    const profile = await (prisma as any).freelancer.findUnique({
      where: { userId: user.id },
      select: { id: true }
    })

    if (!profile) {
      return c.json({ success: false, message: 'Freelancer profile not found' }, 404)
    }

    const cacheKey = `freelancer:products:${user.id}`
    const cached = await getCache(cacheKey)
    if (cached) return c.json({ success: true, data: cached, fromCache: true })

    const products = await (prisma as any).product.findMany({
      // Hide archived/deleted products from freelancer inventory tabs.
      where: { freelancerId: profile.id, isActive: true },
      include: {
        _count: {
          select: { orderItems: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    setCache(cacheKey, products, CACHE_TTL.PRODUCT_LIST).catch(() => {})

    return c.json({ success: true, data: products })
  } catch (error: any) {
    console.error('Get Freelancer Products Error:', error)
    return c.json({ success: false, message: 'Failed to fetch products' }, 500)
  }
}

/**
 * POST /freelancer/products
 * Create a new product as a freelancer (approved immediately, max 3 images)
 */
export const createFreelancerProduct = async (c: Context) => {
  try {
    const user = c.get('user') as any
    const body = await c.req.json()

    const profile = await (prisma as any).freelancer.findUnique({
      where: { userId: user.id },
      select: { id: true, isSubscriptionActive: true, shopName: true }
    })

    if (!profile) {
      return c.json({ success: false, message: 'Freelancer profile not found' }, 404)
    }

    if (!profile.isSubscriptionActive) {
      return c.json({ success: false, message: 'Your subscription is inactive. Please renew to add products.' }, 403)
    }

    const imageCheck = validateFreelancerProductImages(body.images)
    if (!imageCheck.ok) {
      return c.json({ success: false, message: imageCheck.message }, 400)
    }

    const product = await (prisma as any).product.create({
      data: {
        name: body.name,
        category: body.category,
        description: body.description,
        originalPrice: body.originalPrice,
        discountPrice: body.discountPrice,
        stock: body.stock || 0,
        images: imageCheck.assets.map(a => a.url),
        imagePublicIds: imageCheck.assets.map(a => a.publicId),
        isActive: true,
        isApproved: true, 
        condition: body.condition || 'NEW',
        freelancerId: profile.id,
      }
    })
    invalidateProductCache().catch(() => {})
    deleteCache(`freelancer:products:${user.id}`).catch(() => {})

    // Notify all buyers about the new product via event layer
    // This is now handled centrally with persistence
    // We can use a broadcast-style event or bulk send
    const { notificationService } = await import('../../lib/notification.service.js')
    try {
      await notificationService.sendToRole('USER', {
        type: 'NEW_PRODUCT',
        title: 'New Arrival! 🛍️',
        body: `${profile.shopName || 'A seller'} just added "${product.name}". Check it out!`,
        data: { productId: product.id, productName: product.name }
      });
    } catch (err) {
      console.error('[FreelancerProduct] Broadcast failed:', err);
    }

    return c.json({ success: true, data: product }, 201)
  } catch (error: any) {
    console.error('Create Freelancer Product Error:', error)
    return c.json({ success: false, message: 'Failed to create product' }, 500)
  }
}

/**
 * PUT /freelancer/products/:id
 * Update a freelancer product (stays approved; max 3 images)
 */
export const updateFreelancerProduct = async (c: Context) => {
  try {
    const user = c.get('user') as any
    const id = c.req.param('id')
    const body = await c.req.json()

    const profile = await (prisma as any).freelancer.findUnique({
      where: { userId: user.id },
      select: { id: true, shopName: true }
    })

    if (!profile) {
      return c.json({ success: false, message: 'Freelancer profile not found' }, 404)
    }

    // Verify ownership
    const existing = await (prisma as any).product.findFirst({
      where: { id, freelancerId: profile.id }
    })

    if (!existing) {
      return c.json({ success: false, message: 'Product not found or you do not have permission to edit it' }, 403)
    }

    let imageCheck: { ok: boolean; assets?: { url: string; publicId: string }[]; message?: string } = { ok: false }
    if (body.images !== undefined) {
      imageCheck = validateFreelancerProductImages(body.images) as any
      if (!imageCheck.ok) {
        return c.json({ success: false, message: imageCheck.message }, 400)
      }
    }

    const product = await (prisma as any).product.update({
      where: { id },
      data: {
        name: body.name,
        category: body.category,
        description: body.description,
        originalPrice: body.originalPrice,
        discountPrice: body.discountPrice,
        stock: body.stock,
        condition: body.condition,
        ...(imageCheck.ok && imageCheck.assets ? { 
          images: imageCheck.assets.map((a: any) => a.url),
          imagePublicIds: imageCheck.assets.map((a: any) => a.publicId)
        } : {}),
        isApproved: true,
        rejectionReason: null,
      }
    })

    // Production-Safe Lifecycle: Purge removed images AFTER successful DB update
    if (imageCheck.ok && imageCheck.assets) {
      await MediaService.syncImages(existing.imagePublicIds || [], imageCheck.assets.map((a: any) => a.publicId));
    }

    // Invalidate caches
    invalidateProductCache(id).catch(() => {})
    deleteCachePattern(`freelancer:products:${user.id}`).catch(() => {})

    // Notify users about product updates (especially if price dropped or restocked)
    const priceDropped = body.discountPrice < existing.discountPrice || (body.discountPrice && !existing.discountPrice)
    const restocked = body.stock > 0 && existing.stock === 0

    if (priceDropped || restocked) {
      // Find users who have this in their wishlist
      const wishlistUsers = await (prisma as any).wishlistItem.findMany({
        where: { productId: id },
        select: { userId: true }
      })
      const userIds = wishlistUsers.map((w: any) => w.userId)

      if (userIds.length > 0) {
        const { notificationService } = await import('../../lib/notification.service.js')
        const promises = userIds.map(async (uid: string) => {
          if (priceDropped) {
             try {
                await notificationService.createAndSend(uid, {
                  type: 'PRICE_DROP',
                  title: 'Price Drop! 💸',
                  body: `Great news! "${product.name}" is now available at a lower price: Rs. ${product.discountPrice}.`,
                  data: { productId: id, screen: 'ProductDetails' }
                });
             } catch (e) {}
          } else {
             try {
                await notificationService.createAndSend(uid, {
                  type: 'RESTOCKED',
                  title: 'Back in Stock! 🚀',
                  body: `"${product.name}" is back in stock. Grab yours before it's gone!`,
                  data: { productId: id, screen: 'ProductDetails' }
                });
             } catch (e) {}
          }
        });
        await Promise.all(promises);
      }
    }

    // Always notify all buyers about the product update via service
    const { notificationService } = await import('../../lib/notification.service.js')
    try {
      await notificationService.sendToRole('USER', {
         type: 'PRODUCT_UPDATE',
         title: 'Product Updated! 🔄',
         body: `"${product.name}" from ${profile.shopName || 'a seller'} has been updated.`,
         data: { productId: id, screen: 'ProductDetails' }
      });
    } catch (err) {
      console.error('[NotificationError] ProductUpdate broadcast failed:', err);
    }

    return c.json({ success: true, data: product })
  } catch (error: any) {
    console.error('Update Freelancer Product Error:', error)
    return c.json({ success: false, message: 'Failed to update product' }, 500)
  }
}

/**
 * DELETE /freelancer/products/:id
 * Hard-delete when no order/review history; otherwise archive (deactivate) so FKs stay valid.
 */
export const deleteFreelancerProduct = async (c: Context) => {
  try {
    const user = c.get('user') as any
    const id = c.req.param('id')

    const profile = await (prisma as any).freelancer.findUnique({
      where: { userId: user.id },
      select: { id: true }
    })

    if (!profile) {
      return c.json({ success: false, message: 'Freelancer profile not found' }, 404)
    }

    const existing = await (prisma as any).product.findFirst({
      where: { id, freelancerId: profile.id },
      include: {
        _count: { select: { orderItems: true, reviews: true } }
      }
    })

    if (!existing) {
      return c.json({ success: false, message: 'Product not found or unauthorized' }, 404)
    }

    const hasHistory =
      (existing._count?.orderItems ?? 0) > 0 || (existing._count?.reviews ?? 0) > 0

    let archived = hasHistory

    if (hasHistory) {
      await (prisma as any).product.update({
        where: { id },
        data: {
          isActive: false,
          stock: 0,
          isApproved: false,
        }
      })
    } else {
      try {
        const deleted = await (prisma as any).product.delete({ where: { id } })
        // Purge media assets
        if (deleted.imagePublicIds?.length) {
          await MediaService.deleteMany(deleted.imagePublicIds);
        }
      } catch (delErr: any) {
        if (delErr?.code === 'P2003') {
          archived = true
          await (prisma as any).product.update({
            where: { id },
            data: {
              isActive: false,
              stock: 0,
              isApproved: false,
            }
          })
        } else {
          throw delErr
        }
      }
    }

    invalidateProductCache(id).catch(() => {})
    deleteCachePattern(`freelancer:products:${user.id}`).catch(() => {})

    return c.json({
      success: true,
      archived,
      message: archived
        ? 'Product removed from your shop. Past orders and reviews are unchanged.'
        : 'Product deleted',
    })
  } catch (error: any) {
    console.error('Delete Freelancer Product Error:', error)
    return c.json({ success: false, message: 'Failed to delete product' }, 500)
  }
}

/**
 * GET /freelancer/orders
 * Returns orders that contain the freelancer's products
 */
export const getFreelancerOrders = async (c: Context) => {
  try {
    const user = c.get('user') as any

    const profile = await (prisma as any).freelancer.findUnique({
      where: { userId: user.id },
      select: { id: true }
    })

    if (!profile) {
      return c.json({ success: false, message: 'Freelancer profile not found' }, 404)
    }

    const cacheKey = `freelancer:orders:${user.id}`
    const cached = await getCache(cacheKey)
    if (cached) return c.json({ success: true, data: cached, fromCache: true })

   
    const orderItems = await (prisma as any).orderItem.findMany({
      where: { freelancerId: profile.id },
      select: { orderId: true }
    })

    const orderIds = [...new Set(orderItems.map((i: any) => i.orderId))] as string[]

    const orders = await prisma.order.findMany({
      where: { id: { in: orderIds } },
      include: {
        user: { select: { name: true, email: true, phone: true } },
        items: {
          where: { freelancerId: profile.id } as any,
          include: {
            product: { select: { name: true, images: true } }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    setCache(cacheKey, orders, 300).catch(() => {}) 

    return c.json({ success: true, data: orders })
  } catch (error: any) {
    console.error('Get Freelancer Orders Error:', error)
    return c.json({ success: false, message: 'Failed to fetch orders' }, 500)
  }
}

/**
 * PUT /freelancer/orders/:id/status
 * Update order status and tracking info
 */
export const updateFreelancerOrderStatus = async (c: Context) => {
  try {
    const user = c.get('user') as any
    const id = c.req.param('id')
    const body = await c.req.json()
    const { status, trackingNumber, carrier } = body

    const allowedStatuses = ['PENDING', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED']
    if (status && !allowedStatuses.includes(status)) {
      return c.json({ success: false, message: 'Invalid status' }, 400)
    }

    const profile = await (prisma as any).freelancer.findUnique({
      where: { userId: user.id },
      select: { id: true }
    })

    if (!profile) {
      return c.json({ success: false, message: 'Freelancer profile not found' }, 404)
    }

    // Verify ownership: Does this order contain any items from THIS freelancer?
    const orderItem = await (prisma as any).orderItem.findFirst({
      where: { orderId: id, freelancerId: profile.id }
    })

    if (!orderItem) {
      return c.json({ success: false, message: 'Unauthorized: This order does not contain your products' }, 403)
    }

    // Update the order
    const updatedOrder = await prisma.order.update({
      where: { id },
      data: {
        ...(status && { status }),
        ...(trackingNumber && { trackingNumber }),
        ...(carrier && { carrier })
      },
      include: { user: true, items: true }
    })

    // Award Loyalty Points on delivery — 3 points per PKR spent
    if (status === 'DELIVERED' && !(updatedOrder as any).pointsAwarded) {
      try {
        const POINTS_PER_PKR = 3
        const pointsToAward = Math.floor(Number(updatedOrder.total) * POINTS_PER_PKR)

        await prisma.$transaction([
          prisma.user.update({
            where: { id: updatedOrder.userId },
            data: { points: { increment: pointsToAward } }
          }),
          (prisma as any).order.update({
            where: { id: updatedOrder.id },
            data: { pointsAwarded: true }
          })
        ])
        console.log(`[LoyaltyPoints] Awarded ${pointsToAward} pts (${POINTS_PER_PKR}x PKR ${updatedOrder.total}) to user ${updatedOrder.userId}`)
      } catch (awardError) {
        console.error('[LoyaltyPoints] Error awarding points:', awardError)
      }
    }

    // Invalidate caches
    const cacheKey = `freelancer:orders:${user.id}`
    const hasAdminItems = updatedOrder.items.some((item: any) => !item.freelancerId)

    deleteCache(cacheKey).catch(() => {})
    deleteCache(`order:stats:${updatedOrder.userId}`).catch(() => {})
    deleteCache(`orders:my:${updatedOrder.userId}`).catch(() => {})
    hasAdminItems && deleteCache('admin:orders:all').catch(() => {})

    if (updatedOrder.userId !== user.id) {
      await NotificationEvents.onOrderStatusUpdated(updatedOrder.userId, updatedOrder.id, status).catch(err => 
        console.error('[Notification] Failed to send status update notification:', err)
      )
    }

    return c.json({ success: true, message: 'Order updated successfully', data: updatedOrder })
  } catch (error: any) {
    console.error('Update Freelancer Order Error:', error)
    return c.json({ success: false, message: 'Failed to update order' }, 500)
  }
}

/**
 * PUT /freelancer/orders/:orderId/items/:itemId/verify-payment
 * Mark a direct-pay order item as VERIFIED
 */
export const verifyFreelancerPayment = async (c: Context) => {
  try {
    const user = c.get('user') as any
    const orderId = c.req.param('orderId')
    const itemId = c.req.param('itemId')

    const profile = await (prisma as any).freelancer.findUnique({
      where: { userId: user.id },
      select: { id: true }
    })

    if (!profile) {
      return c.json({ success: false, message: 'Freelancer profile not found' }, 404)
    }

    // Verify ownership of the item
    const orderItem = await (prisma as any).orderItem.findFirst({
      where: { id: itemId, orderId, freelancerId: profile.id },
      include: { order: true, product: { select: { name: true } } }
    })

    if (!orderItem) {
      return c.json({ success: false, message: 'Unauthorized or item not found' }, 403)
    }

    if (!["AWAITING_DIRECT_PAY", "PENDING_FREELANCER_VERIFICATION"].includes(orderItem.paymentStatus || "")) {
      return c.json({ success: false, message: 'Item is not awaiting verification' }, 400)
    }

    // Update item payment status
    await (prisma as any).orderItem.update({
      where: { id: itemId },
      data: { paymentStatus: 'VERIFIED' }
    })

    // Invalidate caches
    const orderItems = await (prisma as any).orderItem.findMany({
      where: { orderId },
      select: { freelancerId: true },
    })
    const hasAdminItems = orderItems.some((item: any) => !item.freelancerId)

    deleteCache(`freelancer:orders:${user.id}`).catch(() => {})
    deleteCache(`orders:my:${orderItem.order.userId}`).catch(() => {})
    hasAdminItems && deleteCache('admin:orders:all').catch(() => {})

    if (orderItem.order.userId !== user.id) {
       await NotificationEvents.onPaymentVerified(orderItem.order.userId, orderId).catch(err => 
         console.error('[Notification] Failed to send payment verification notification:', err)
       )
    }

    return c.json({ success: true, message: 'Payment verified successfully' })
  } catch (error: any) {
    console.error('Verify Freelancer Payment Error:', error)
    return c.json({ success: false, message: 'Failed to verify payment' }, 500)
  }
}

/**
 * GET /freelancer/analytics/earnings?period=daily|weekly|monthly|yearly
 * Returns earnings analytics for the freelancer grouped by period
 */
export const getFreelancerEarningsAnalytics = async (c: Context) => {
  try {
    const user = c.get('user') as any
    const period = c.req.query('period') || 'monthly'

    const profile = await (prisma as any).freelancer.findUnique({
      where: { userId: user.id },
      select: { id: true }
    })

    if (!profile) {
      return c.json({ success: false, message: 'Freelancer profile not found' }, 404)
    }

    const cacheKey = `freelancer:analytics:${user.id}:${period}`
    const cached = await getCache(cacheKey)
    if (cached) return c.json({ success: true, data: cached, fromCache: true })

    // Determine date range based on period
    const now = new Date()
    let startDate: Date
    let groupFn: (date: Date) => string

    if (period === 'daily') {
      // Last 14 days
      startDate = new Date(now)
      startDate.setDate(now.getDate() - 13)
      startDate.setHours(0, 0, 0, 0)
      groupFn = (d) => d.toISOString().slice(0, 10) // YYYY-MM-DD
    } else if (period === 'weekly') {
      // Last 12 weeks
      startDate = new Date(now)
      startDate.setDate(now.getDate() - 12 * 7)
      startDate.setHours(0, 0, 0, 0)
      groupFn = (d) => {
        // Get ISO week: YYYY-Www
        const tmp = new Date(d)
        tmp.setHours(0, 0, 0, 0)
        tmp.setDate(tmp.getDate() + 3 - ((tmp.getDay() + 6) % 7))
        const week1 = new Date(tmp.getFullYear(), 0, 4)
        const weekNum = 1 + Math.round(((tmp.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7)
        return `${tmp.getFullYear()}-W${String(weekNum).padStart(2, '0')}`
      }
    } else if (period === 'yearly') {
      // Last 5 years
      startDate = new Date(now)
      startDate.setFullYear(now.getFullYear() - 4)
      startDate.setMonth(0, 1)
      startDate.setHours(0, 0, 0, 0)
      groupFn = (d) => `${d.getFullYear()}`
    } else {
      // monthly – default: last 12 months
      startDate = new Date(now)
      startDate.setMonth(now.getMonth() - 11)
      startDate.setDate(1)
      startDate.setHours(0, 0, 0, 0)
      groupFn = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    }

    // Fetch all order items for this freelancer since startDate
    const orderItems = await (prisma as any).orderItem.findMany({
      where: {
        freelancerId: profile.id,
        order: { createdAt: { gte: startDate } }
      },
      select: {
        orderId: true,
        freelancerEarning: true,
        order: { select: { status: true, createdAt: true } }
      }
    })

    // Group by period bucket
    const buckets: Record<string, {
      earnings: number
      orders: number
      completed: number
      _orderIds: Set<string>
      _completedOrderIds: Set<string>
    }> = {}

    // Initialize all buckets in the range with zero values
    const tempDate = new Date(startDate)
    while (tempDate <= now) {
      const key = groupFn(tempDate)
      if (!buckets[key]) {
        buckets[key] = {
          earnings: 0,
          orders: 0,
          completed: 0,
          _orderIds: new Set<string>(),
          _completedOrderIds: new Set<string>(),
        }
      }
      
      // Advance tempDate based on period
      if (period === 'daily') tempDate.setDate(tempDate.getDate() + 1)
      else if (period === 'weekly') tempDate.setDate(tempDate.getDate() + 7)
      else if (period === 'yearly') tempDate.setFullYear(tempDate.getFullYear() + 1)
      else tempDate.setMonth(tempDate.getMonth() + 1) // monthly
    }

    let totalEarnings = 0
    let completedOrders = 0
    let pendingOrders = 0
    let cancelledOrders = 0

    for (const item of orderItems) {
      const date = new Date(item.order.createdAt)
      const key = groupFn(date)
      // Only process if it falls within our range (safety check)
      if (buckets[key]) {
        const earning = Number(item.freelancerEarning || 0)
        buckets[key]._orderIds.add(item.orderId)
        if (item.order.status === 'DELIVERED') {
          buckets[key].earnings += earning
          totalEarnings += earning
          buckets[key]._completedOrderIds.add(item.orderId)
        }
      }
    }

    for (const key of Object.keys(buckets)) {
      buckets[key].orders = buckets[key]._orderIds.size
      buckets[key].completed = buckets[key]._completedOrderIds.size
    }

    // Aggregate order-level stats (avoiding double-counting)
    const allOrders = await (prisma as any).orderItem.findMany({
      where: { freelancerId: profile.id },
      select: { orderId: true, order: { select: { status: true } } },
      distinct: ['orderId']
    })
    for (const item of allOrders) {
      const status = item.order.status
      if (status === 'DELIVERED' || status === 'COMPLETED') completedOrders++
      else if (status === 'CANCELLED') cancelledOrders++
      else pendingOrders++
    }

    // Build sorted chart data array
    const chartData = Object.entries(buckets)
      .sort(([a], [b]) => (a > b ? 1 : -1))
      .map(([label, val]) => ({
        label,
        earnings: val.earnings,
        orders: val.orders,
        completed: val.completed,
      }))

    const result = {
      period,
      chartData,
      summary: {
        totalEarnings,
        completedOrders,
        pendingOrders,
        cancelledOrders,
        allOrders: completedOrders + pendingOrders + cancelledOrders,
      }
    }

    setCache(cacheKey, result, 300).catch(() => {})
    return c.json({ success: true, data: result })
  } catch (error: any) {
    console.error('Get Freelancer Earnings Analytics Error:', error)
    return c.json({ success: false, message: 'Failed to fetch analytics' }, 500)
  }
}
/**
 * GET /freelancer/analytics/inventory
 * Returns inventory intelligence (low stock items, health stats) for the freelancer
 */
export const getInventoryIntelligence = async (c: Context) => {
  try {
    const user = c.get('user') as any
    const cacheKey = `freelancer:inventory:intel:${user.id}`
    
    const cached = await getCache(cacheKey)
    if (cached) return c.json({ success: true, data: cached, fromCache: true })

    const profile = await (prisma as any).freelancer.findUnique({
      where: { userId: user.id },
      select: { id: true }
    })

    if (!profile) {
      return c.json({ success: false, message: 'Freelancer profile not found' }, 404)
    }

    const products = await (prisma as any).product.findMany({
      where: { freelancerId: profile.id, isActive: true },
      select: {
        id: true,
        name: true,
        stock: true,
        category: true,
        images: true
      }
    })

    const lowStockThreshold = 5
    const lowStockItems = products.filter((p: any) => p.stock <= lowStockThreshold)
    const outOfStockItems = products.filter((p: any) => p.stock === 0)
    
    const totalProducts = products.length
    const healthyProducts = totalProducts - lowStockItems.length
    const healthPercentage = totalProducts > 0 ? (healthyProducts / totalProducts) * 100 : 100

    const result = {
      summary: {
        totalActiveProducts: totalProducts,
        lowStockCount: lowStockItems.length,
        outOfStockCount: outOfStockItems.length,
        healthPercentage: Math.round(healthPercentage),
        status: healthPercentage < 50 ? 'CRITICAL' : (healthPercentage < 80 ? 'ATTENTION' : 'HEALTHY')
      },
      lowStockItems: lowStockItems.sort((a: any, b: any) => a.stock - b.stock),
    }

    // Cache for 15 minutes
    setCache(cacheKey, result, 900).catch(() => {})

    return c.json({ success: true, data: result })
  } catch (error: any) {
    console.error('Get Inventory Intelligence Error:', error)
    return c.json({ success: false, message: 'Failed to fetch inventory intelligence' }, 500)
  }
}

/**
 * DELETE /freelancer/profile
 * Deletes the freelancer profile and resets the user role to USER.
 * Only allowed if there are no pending orders.
 */
export const deleteFreelancerProfile = async (c: Context) => {
  try {
    const user = c.get('user') as any
    const userId = user.id

    // 1. Find the freelancer profile
    const profile = await (prisma as any).freelancer.findUnique({
      where: { userId }
    })

    if (!profile) {
      return c.json({ success: false, message: 'Freelancer profile not found' }, 404)
    }

    // 2. Check for pending orders manually
    const pendingOrdersCount = await (prisma as any).orderItem.count({
      where: {
        freelancerId: profile.id,
        order: {
          status: { notIn: ['DELIVERED', 'CANCELLED'] }
        }
      }
    })

    if (pendingOrdersCount > 0) {
      return c.json({
        success: false,
        message: 'Cannot delete profile. You have pending orders. Please fulfill or cancel them first.'
      }, 400)
    }

    // 3. Wipe all data and delete user using the central UserService
    const { UserService } = await import('../user/user.service.js')
    await UserService.deleteAccount(userId)

    // 4. Clear caches
    deleteCache(`freelancer:profile:${userId}`).catch(() => {})
    deleteCachePattern(`freelancer:products:${userId}`).catch(() => {})
    deleteCachePattern(`freelancer:orders:${userId}`).catch(() => {})
    deleteCache(`user_profile:${userId}`).catch(() => {})

    return c.json({ 
      success: true, 
      message: 'Freelancer profile has been permanently deleted.' 
    })
  } catch (error: any) {
    console.error('Delete Freelancer Profile Error:', error)
    return c.json({ success: false, message: 'Failed to delete freelancer profile' }, 500)
  }
}

/**
 * GET /freelancer/reviews
 * Returns all active reviews for products belonging to the logged-in freelancer
 */
export const getFreelancerReviews = async (c: Context) => {
  try {
    const user = c.get('user') as any
    const profile = await (prisma as any).freelancer.findUnique({
      where: { userId: user.id },
      select: { id: true }
    })

    if (!profile) {
      return c.json({ success: false, message: 'Freelancer profile not found' }, 404)
    }

    const reviews = await (prisma as any).review.findMany({
      where: {
        product: { freelancerId: profile.id },
        isActive: true
      },
      include: {
        user: {
          select: {
            name: true,
            avatar: true
          }
        },
        product: {
          select: {
            name: true,
            images: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    return c.json({
      success: true,
      data: reviews
    })
  } catch (error: any) {
    console.error('Fetch Freelancer Reviews Error:', error)
    return c.json({ success: false, message: 'Failed to fetch reviews' }, 500)
  }
}
