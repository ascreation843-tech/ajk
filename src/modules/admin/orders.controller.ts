import { Context } from 'hono'
import prisma from '../../lib/prisma.js'
import { NotificationEvents } from '../../lib/notification.events.js'
import { z } from 'zod'

const updateStatusSchema = z.object({
  status: z.enum(['PENDING', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED']),
  trackingNumber: z.string().optional(),
  carrier: z.string().optional(),
})

export const getAllOrders = async (c: Context) => {
  try {
    const { getCache, setCache } = await import('../../lib/redis.js')
    const cacheKey = 'admin:orders:all'
    
    const cached = await getCache(cacheKey)
    if (cached) return c.json({ success: true, data: cached, fromCache: true })

    const orders = await prisma.order.findMany({
      include: {
        user: { select: { name: true, email: true, shopName: true } },
        items: { 
          include: { product: true } 
        }
      },
      orderBy: { createdAt: 'desc' }
    })
    
    setCache(cacheKey, orders, 300).catch(() => {})
    return c.json({ success: true, data: orders })
  } catch (error: any) {
    console.error('Admin Fetch Orders Error:', error)
    return c.json({ success: false, message: 'Failed to fetch orders' }, 500)
  }
}

export const updateOrderStatus = async (c: Context) => {
  try {
    const id = c.req.param('id')
    const user = c.get('user') as any
    const body = await c.req.json()

    const validation = updateStatusSchema.safeParse(body)
    if (!validation.success) {
      return c.json({ success: false, message: 'Invalid status', errors: validation.error.flatten() }, 400)
    }

    const { status, trackingNumber, carrier } = validation.data

    const order = await prisma.order.update({
      where: { id },
      data: { 
        status,
        ...(trackingNumber && { trackingNumber }),
        ...(carrier && { carrier })
      },
      include: { user: true, items: true }
    })

    // Invalidate ALL relevant order caches
    const { deleteCache, deleteCachePattern } = await import('../../lib/redis.js')
    
    // Find item owners to invalidate their caches
    const orderItems = await prisma.orderItem.findMany({
      where: { orderId: order.id },
      select: { freelancerId: true }
    })
    const freelancerIds = [...new Set(orderItems.map(i => i.freelancerId).filter(Boolean))] as string[]
    
    // Get freelancer user IDs
    let fUserIds: string[] = []
    if (freelancerIds.length > 0) {
      const freelancers = await prisma.freelancer.findMany({
        where: { id: { in: freelancerIds } },
        select: { userId: true }
      })
      fUserIds = freelancers.map((f: any) => f.userId)
    }

    await Promise.all([
      deleteCache(`order:stats:${order.userId}`),
      deleteCache(`orders:my:${order.userId}`),
      deleteCache('admin:orders:all'),
      ...fUserIds.map(fId => deleteCache(`freelancer:orders:${fId}`))
    ]).catch(() => {})

    if (order.userId !== user.id) {
      await NotificationEvents.onOrderStatusUpdated(order.userId, order.id, status).catch(err => 
        console.error('[Admin-Notification] Failed to send status update notification:', err)
      )
    }

    return c.json({ success: true, message: `Order status updated to ${status}`, data: order })
  } catch (error: any) {
    console.error('Admin Update Order Error:', error)
    return c.json({ success: false, message: 'Failed to update order status' }, 500)
  }
}
