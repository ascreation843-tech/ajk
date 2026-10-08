import { Context } from 'hono'
import prisma from '../../lib/prisma.js'
import { getCache, setCache, deleteCache, CACHE_TTL } from '../../lib/redis.js'
import { NotificationEvents } from '../../lib/notification.events.js'
import { inventoryService } from '../../lib/inventory.service.js'
import { MediaService } from '../../lib/media.service.js'

const DIRECT_PAY_PENDING_STATUS = 'PENDING_FREELANCER_VERIFICATION'
const PAYMENT_PROOF_RETENTION_MS = 10 * 24 * 60 * 60 * 1000

const isProofExpired = (proofAt?: Date | string | null) => {
  if (!proofAt) return false
  const ts = new Date(proofAt).getTime()
  return Number.isFinite(ts) && Date.now() - ts > PAYMENT_PROOF_RETENTION_MS
}

const purgeExpiredPaymentProofs = async (items: any[] = []) => {
  const expiredItems = items.filter(
    (item) => item?.paymentProofUrl && isProofExpired(item?.paymentProofAt),
  )

  if (!expiredItems.length) return items

  await Promise.all(
    expiredItems.map(async (item) => {
      await (prisma as any).orderItem.update({
        where: { id: item.id },
        data: {
          paymentProofUrl: null,
          paymentProofPublicId: null,
          paymentProofNote: null,
          paymentProofAt: null,
        },
      })
      if (item.paymentProofPublicId) {
        await MediaService.deleteImage(item.paymentProofPublicId).catch(() => {})
      }
    }),
  ).catch(() => {})

  return items.map((item) =>
    expiredItems.some((e) => e.id === item.id)
      ? { ...item, paymentProofUrl: null, paymentProofNote: null, paymentProofAt: null }
      : item,
  )
}

export const createOrder = async (c: Context) => {
  try {
    const user = c.get('user') as any
    const { items, shippingAddress, paymentMethod, directPaymentProofs } = await c.req.json() // items: [{ productId, quantity }]

    if (!items || items.length === 0) {
      return c.json({ success: false, message: 'Cart is empty' }, 400)
    }

    // Fetch Global Settings
    const settings = await (prisma as any).settings.findUnique({
      where: { id: 'global' }
    })
    const minOrderValue = settings?.minOrderValue ? Number(settings.minOrderValue) : 1500

    let total = 0
    let totalMargin = 0
    const orderItemsData: any[] = []
    const directProofMap = (directPaymentProofs && typeof directPaymentProofs === 'object')
      ? directPaymentProofs
      : {}

    for (const item of items) {
      const product: any = await prisma.product.findUnique({
        where: { id: item.productId },
        include: { freelancer: true }
      })

      if (!product) {
        return c.json({ success: false, message: `Product not found: ${item.productId}` }, 404)
      }


      if (product.stock < item.quantity) {
        return c.json({ success: false, message: `Insufficient stock for product: ${product.name}` }, 400)
      }

      let price = product.discountPrice || product.originalPrice
      let itemMargin = 0

      // 3. Payment Instructions Logic
      let paymentInstructions = null
      let paymentStatus = 'PENDING'
      let freelancerEarning = 0
      let adminEarning = 0
      let commissionPercent = 0

      if (product.freelancerId) {
        commissionPercent = 0 
        freelancerEarning = Number(price) * item.quantity
        adminEarning = 0
        const proofPayload = directProofMap?.[product.freelancerId]
        const proofUrl = typeof proofPayload?.imageUrl === 'string' ? proofPayload.imageUrl : null
        const proofPublicId = typeof proofPayload?.publicId === 'string' ? proofPayload.publicId : null
        const proofNote = typeof proofPayload?.note === 'string' ? proofPayload.note : null
        
        const freelancer = product.freelancer as any
        if (freelancer?.bankName && freelancer?.accountNumber) {
          if (proofUrl) {
            paymentInstructions = `PAY DIRECTLY TO SELLER: ${freelancer.bankName} (A/C: ${freelancer.accountNumber}, Title: ${freelancer.accountTitle || 'N/A'})`
            paymentStatus = DIRECT_PAY_PENDING_STATUS
          } else {
            paymentInstructions = "Cash on Delivery"
            paymentStatus = "COD"
          }
          if (proofUrl) {
            orderItemsData.push({
              productId: product.id,
              quantity: item.quantity,
              price: price,
              margin: itemMargin,
              freelancerId: product.freelancerId,
              commissionPercent: commissionPercent,
              freelancerEarning: freelancerEarning,
              adminEarning: adminEarning,
              paymentInstructions: paymentInstructions,
              paymentStatus: paymentStatus,
              paymentProofUrl: proofUrl,
              paymentProofPublicId: proofPublicId,
              paymentProofNote: proofNote || null,
              paymentProofAt: new Date(),
            })
            total += Number(price) * item.quantity
            totalMargin += itemMargin
            continue
          }
        } else {
          paymentInstructions = "Cash on Delivery"
          paymentStatus = "COD"
        }
      } else {
        // Admin product
        adminEarning = Number(price) * item.quantity
        paymentInstructions = "Payment to Saman Official"
        paymentStatus = paymentMethod === 'COD' ? "COD" : "PENDING_VERIFICATION"
      }

      total += Number(price) * item.quantity 
      totalMargin += itemMargin

      orderItemsData.push({
        productId: product.id,
        quantity: item.quantity,
        price: price,
        margin: itemMargin,
        freelancerId: product.freelancerId,
        commissionPercent: commissionPercent,
        freelancerEarning: freelancerEarning,
        adminEarning: adminEarning,
        paymentInstructions: paymentInstructions,
        paymentStatus: paymentStatus
      })
    }

    // Enforce Min Order Value
    if (total < minOrderValue) {
      return c.json({ 
        success: false, 
        message: `Minimum order value is PKR ${minOrderValue.toLocaleString()}. Your current total is PKR ${total.toLocaleString()}.` 
      }, 400)
    }

    // Create Order Transaction
    const order = await prisma.$transaction(async (tx: any): Promise<{ newOrder: any, freelancerUserIds: string[] }> => {
      for (const item of items) {
        const product = await tx.product.findUnique({
          where: { id: item.productId },
          select: { stock: true, name: true }
        })

        if (!product) throw new Error(`Product not found: ${item.productId}`)
        if (product.stock < item.quantity) {
          throw new Error(`Insufficient stock for: ${product.name}. Required: ${item.quantity}, Available: ${product.stock}`)
        }
      }

      // 2. Update Stock (Decrement)
      for (const item of orderItemsData) {
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { decrement: item.quantity } }
        })
        
        // Trigger Inventory Intelligence Check (Async but tracked)
        inventoryService.checkAndNotifyLowStock(item.productId).catch(err => 
          console.error(`[InventoryIntel] Error for product ${item.productId}:`, err)
        )
      }

      // 3. Create Order
      const newOrder = await tx.order.create({
        data: {
          userId: user.id,
          total: total,
          margin: totalMargin,
          status: 'PENDING',
          shippingAddress: shippingAddress,
          paymentMethod: paymentMethod,
          items: {
            create: orderItemsData
          }
        },
        include: { items: { include: { product: { select: { name: true, images: true } } } } }
      })

      /* Removed point awarding on creation - will be awarded on delivery */
      
      // 5. Notify Parties via Event Layer
      const freelancerRecordIds = [...new Set(orderItemsData.map(i => i.freelancerId).filter(Boolean))] as string[]
      
      let freelancerUserIds: string[] = []
      if (freelancerRecordIds.length > 0) {
        const freelancers = await tx.freelancer.findMany({
          where: { id: { in: freelancerRecordIds } },
          select: { userId: true }
        })
        freelancerUserIds = freelancers.map((f: any) => f.userId)
      }

      // We pass the buyerId and freelancerUserIds to the event handler
      await NotificationEvents.onOrderCreated(newOrder.id, user.id, freelancerUserIds).catch(err => 
        console.error('[NotificationEvent] onOrderCreated failed:', err)
      )

      // Handle direct payment specific notification
      const hasDirectPayment = orderItemsData.some(i => i.paymentStatus === DIRECT_PAY_PENDING_STATUS)
      if (hasDirectPayment) {
        await NotificationEvents.onPaymentProofSubmitted(freelancerUserIds, newOrder.id).catch(err =>
          console.error('[NotificationEvent] onPaymentProofSubmitted failed:', err)
        )
      }
      
      return { newOrder, freelancerUserIds }
    })

    const newOrder = (order as any).newOrder
    const freelancerUserIds = (order as any).freelancerUserIds
    const hasPaymentProof = orderItemsData.some((i) => i.paymentStatus === DIRECT_PAY_PENDING_STATUS)

    // Invalidate caches (Non-blocking)
    const { deleteCache, deleteCachePattern } = await import('../../lib/redis.js')
    const productIds = orderItemsData.map(item => item.productId)
    const hasAdminItems = orderItemsData.some(item => !item.freelancerId)
    
    await Promise.all([
      deleteCache(`orders:my:${user.id}`),
      hasAdminItems && deleteCache('admin:orders:all'),
      ...freelancerUserIds.map((fId: string) => deleteCache(`freelancer:orders:${fId}`)),
      deleteCachePattern('products:list:*'),
      ...productIds.map(id => deleteCachePattern(`product:details:${id}:*`))
    ].filter(Boolean)).catch(() => {})

    // Cache invalidation and cleanup handled above

    return c.json({ 
      success: true, 
      message: 'Order created successfully',
      data: newOrder 
    }, 201)

  } catch (error: any) {
    console.error('Order creation error:', error)
    return c.json({ 
      success: false, 
      message: error.message.includes('stock') ? error.message : 'Failed to create order' 
    }, error.message.includes('stock') ? 400 : 500)
  }
}

export const getMyOrders = async (c: Context) => {
  try {
    const user = c.get('user') as any
    const { getCache, setCache } = await import('../../lib/redis.js')
    const cacheKey = `orders:my:${user.id}`

    const cached = await getCache(cacheKey)
    if (cached) return c.json({ success: true, data: cached, fromCache: true })

    const orders = await prisma.order.findMany({
      where: { userId: user.id },
      include: {
        items: {
          include: {
            product: {
              select: { name: true, images: true }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    })
    const sanitizedOrders = await Promise.all(
      orders.map(async (order: any) => ({
        ...order,
        items: await purgeExpiredPaymentProofs(order.items || []),
      })),
    )

    setCache(cacheKey, sanitizedOrders, 300).catch(() => {}) // 5 min cache
    return c.json({
      success: true,
      data: sanitizedOrders
    })
  } catch (error: any) {
    console.error('Error fetching my orders:', error)
    return c.json({ success: false, message: 'Failed to fetch order history' }, 500)
  }
}

export const getOrderStats = async (c: Context) => {
  try {
    const userPayload = c.get('user') as any
    const cacheKey = `order:stats:${userPayload.id}`;
    
    const cachedStats = await getCache(cacheKey);
    if (cachedStats) {
      return c.json({
        success: true,
        data: cachedStats,
        cached: true,
      });
    }

    const [user, orderCount] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userPayload.id },
        select: { totalMargin: true, role: true }
      }),
      prisma.order.count({
        where: { userId: userPayload.id }
      })
    ])

    const stats = {
      totalOrders: orderCount,
      lifetimeMargin: Number(user?.totalMargin || 0),
      role: user?.role
    };

    // Cache stats for 10 minutes (Non-blocking)
    setCache(cacheKey, stats, 600).catch(() => {});

    return c.json({
      success: true,
      data: stats,
      cached: false
    })
  } catch (error: any) {
    console.error('Error fetching stats:', error)
    return c.json({ success: false, message: 'Failed to fetch stats' }, 500)
  }
}

export const getOrderById = async (c: Context) => {
  try {
    const user = c.get('user') as any
    const id = c.req.param('id')

    // Find the order first without strict userId check to verify roles
    const baseOrder = await prisma.order.findUnique({
      where: { id },
      include: { items: true }
    })

    if (!baseOrder) {
      return c.json({ success: false, message: 'Order not found' }, 404)
    }

    // Determine access level
    const isOwner = baseOrder.userId === user.id
    const isAdmin = user.role === 'ADMIN'
    
    // Check if user is a freelancer/business partner who owns items in this order
    const canActAsFreelancer = user.role === 'FREELANCER' || user.role === 'BUSINESS_PARTNER'
    const freelancerOwnedItemsCount = canActAsFreelancer
      ? await (prisma as any).orderItem.count({
          where: {
            orderId: id,
            product: {
              freelancer: {
                userId: user.id,
              },
            },
          },
        })
      : 0
    const isRelatedFreelancer = freelancerOwnedItemsCount > 0

    if (!isOwner && !isAdmin && !isRelatedFreelancer) {
      return c.json({ success: false, message: 'Unauthorized access to order' }, 403)
    }

    // Build item filter based on role
    let itemFilter = {}
    if (isAdmin) {
      itemFilter = { freelancerId: null }
    } else if (isRelatedFreelancer) {
      itemFilter = {
        product: {
          freelancer: {
            userId: user.id,
          },
        },
      }
    }

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        user: { select: { name: true, phone: true, email: true, shopName: true, region: true } },
        items: {
          where: itemFilter as any,
          include: {
            product: {
              select: { 
                id: true,
                name: true, 
                images: true, 
                originalPrice: true,
                discountPrice: true,
                category: true
              }
            }
          }
        }
      }
    } as any)

    if (!order) {
      return c.json({ success: false, message: 'Order not found' }, 404)
    }
    const sanitizedItems = await purgeExpiredPaymentProofs((order as any).items || [])
    ;(order as any).items = sanitizedItems

    return c.json({
      success: true,
      data: order
    })
  } catch (error: any) {
    console.error('Error fetching order by ID:', error)
    return c.json({ success: false, message: 'Failed to fetch order details' }, 500)
  }
}

export const cancelOrder = async (c: Context) => {
  try {
    const user = c.get('user') as any
    const id = c.req.param('id')

    // 1. Fetch order and verify ownership/status
    const order = await prisma.order.findUnique({
      where: { id, userId: user.id },
      include: { items: { include: { product: true } } }
    })

    if (!order) {
      return c.json({ success: false, message: 'Order not found' }, 404)
    }

    if (order.status !== 'PENDING') {
      return c.json({ success: false, message: 'Only pending orders can be cancelled' }, 400)
    }

    // 2. Perform cancellation in a transaction
    await prisma.$transaction(async (tx: any) => {
      // Update order status
      await tx.order.update({
        where: { id },
        data: { status: 'CANCELLED' }
      })

      // Restore stock for all items
      for (const item of order.items) {
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { increment: item.quantity } }
        })
      }

      /* Removed point deduction on cancellation - will only be awarded if delivered */

      // 3. Notify Parties via Event Layer
      const freelancerRecordIds = [...new Set(order.items.map(i => i.freelancerId).filter(Boolean))] as string[]
      
      if (freelancerRecordIds.length > 0) {
        const freelancers = await tx.freelancer.findMany({
          where: { id: { in: freelancerRecordIds } },
          select: { userId: true }
        })
        const freelancerUserIds = freelancers.map((f: any) => f.userId)
        
        // Notify each freelancer about cancellation in parallel
        await Promise.all(
          freelancerUserIds.map((fUid: string) => 
            NotificationEvents.onOrderStatusUpdated(fUid, order.id, 'CANCELLED_BY_CUSTOMER').catch(() => {})
          )
        )
      }
      
      await NotificationEvents.onOrderStatusUpdated(user.id, order.id, 'CANCELLED').catch(() => {})
    })

    // Production-Safe Lifecycle: Purge payment proofs AFTER successful cancellation
    const proofIds = order.items.map((i: any) => i.paymentProofPublicId).filter(Boolean) as string[]
    if (proofIds.length > 0) {
      MediaService.deleteMany(proofIds).catch(err => 
        console.error(`[OrdersController] Failed to purge proofs for cancelled order ${id}:`, err)
      )
    }

    // 4. Invalidate caches
    const { deleteCache, deleteCachePattern } = await import('../../lib/redis.js')
    const hasAdminItems = order.items.some(item => !item.freelancerId)

    await Promise.all([
      deleteCache(`orders:my:${user.id}`),
      deleteCache(`order:stats:${user.id}`),
      hasAdminItems && deleteCache('admin:orders:all'),
      deleteCachePattern('products:list:*'),
      ...order.items.map(item => deleteCachePattern(`product:details:${item.productId}:*`))
    ].filter(Boolean)).catch(() => {})

    return c.json({
      success: true,
      message: 'Order cancelled successfully'
    })

  } catch (error: any) {
    console.error('Order cancellation error:', error)
    return c.json({ success: false, message: 'Failed to cancel order' }, 500)
  }
}
