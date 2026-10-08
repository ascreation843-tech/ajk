import { Context } from 'hono'
import prisma from '../../lib/prisma.js'
import { z } from 'zod'
import { MediaService } from '../../lib/media.service.js'
import { invalidateProductCache } from '../../lib/redis.js'
import { NotificationEvents } from '../../lib/notification.events.js'

const createReviewSchema = z.object({
  productId: z.string().uuid(),
  orderId: z.string().uuid().optional(),
  rating: z.number().min(1).max(5),
  comment: z.string().optional(),
  images: z.array(z.object({ url: z.string(), publicId: z.string() })).optional(),
})

export const createReview = async (c: Context) => {
  try {
    const user = c.get('user') as any
    const body = await c.req.json()

    const validation = createReviewSchema.safeParse(body)
    if (!validation.success) {
      return c.json({ success: false, message: 'Invalid data', errors: validation.error.flatten() }, 400)
    }

    const { productId, orderId, rating, comment, images } = validation.data

    if (!orderId) {
      return c.json({ success: false, message: 'orderId is required to submit a review' }, 400)
    }

    // Optional: Verify if user actually bought the product if orderId is provided
    if (orderId) {
      const order = await prisma.order.findUnique({
        where: { id: orderId, userId: user.id },
        include: { items: true }
      })

      if (!order) {
        return c.json({ success: false, message: 'Order not found or access denied' }, 404)
      }

      const hasProduct = order.items.some((item: any) => item.productId === productId)
      if (!hasProduct) {
        return c.json({ success: false, message: 'You can only review products you have purchased in this order' }, 403)
      }
    }

    // Enforce one review per user per product per order
    const existingReview = await (prisma as any).review.findFirst({
      where: {
        userId: user.id,
        productId,
        orderId,
      },
      select: { id: true },
    })

    if (existingReview) {
      return c.json(
        {
          success: false,
          message: 'You already submitted a review for this product in this order',
        },
        409,
      )
    }

    const review = await (prisma as any).review.create({
      data: {
        userId: user.id,
        productId,
        orderId,
        rating,
        comment,
        images: images?.map((i: any) => i.url) || [],
        imagePublicIds: images?.map((i: any) => i.publicId) || [],
      },
      include: {
        user: {
          select: {
            name: true,
            avatar: true
          }
        }
      }
    })

    // Notify Freelancer (Non-blocking)
    const product = await (prisma as any).product.findUnique({
      where: { id: productId },
      include: { 
        freelancer: {
          select: { userId: true, shopName: true }
        }
      }
    });

    if (product?.freelancer?.userId) {
      await NotificationEvents.onNewReview(product.freelancer.userId, productId, rating).catch(err => 
        console.error('[ReviewNotif] Freelancer notification failed:', err)
      )
    }

    // Invalidate product caches
    await invalidateProductCache(productId);

    return c.json({
      success: true,
      message: 'Review submitted successfully',
      data: review
    })
  } catch (error: any) {
    console.error('Create Review Error:', error)
    return c.json({ success: false, message: 'Failed to submit review' }, 500)
  }
}

export const getProductReviews = async (c: Context) => {
  try {
    const productId = c.req.param('productId')

    const reviews = await (prisma as any).review.findMany({
      where: { productId, isActive: true },
      include: {
        user: {
          select: {
            name: true,
            avatar: true
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
    console.error('Fetch Reviews Error:', error)
    return c.json({ success: false, message: 'Failed to fetch reviews' }, 500)
  }
}

// Admin Controllers
export const getAllReviews = async (c: Context) => {
  try {
    const reviews = await (prisma as any).review.findMany({
      include: {
        user: { select: { name: true, email: true } },
        product: { select: { name: true, images: true } }
      },
      orderBy: { createdAt: 'desc' }
    })

    return c.json({ success: true, data: reviews })
  } catch (error) {
    return c.json({ success: false, message: 'Failed to fetch all reviews' }, 500)
  }
}

export const toggleReviewStatus = async (c: Context) => {
  try {
    const id = c.req.param('id')
    const { isActive } = await c.req.json()

    const review = await (prisma as any).review.update({
      where: { id },
      data: { isActive }
    })

    // Invalidate product details cache
    await invalidateProductCache(review.productId);

    return c.json({ success: true, message: `Review ${isActive ? 'activated' : 'hidden'}`, data: review })
  } catch (error) {
    return c.json({ success: false, message: 'Failed to update review status' }, 500)
  }
}

export const deleteReview = async (c: Context) => {
  try {
    const id = c.req.param('id')
    const review = await (prisma as any).review.findUnique({ where: { id } })
    
    if (review) {
       await invalidateProductCache(review.productId);
    }

    const deletedReview = await (prisma as any).review.delete({ where: { id } })
    
    // Purge media assets
    if (deletedReview.imagePublicIds?.length) {
      MediaService.deleteMany(deletedReview.imagePublicIds).catch(err => 
        console.error(`[ReviewsController] Failed to purge images for review ${id}:`, err)
      );
    }

    return c.json({ success: true, message: 'Review deleted permanently' })
  } catch (error) {
    return c.json({ success: false, message: 'Failed to delete review' }, 500)
  }
}
