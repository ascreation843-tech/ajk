import { Context } from 'hono'
import prisma from '../../lib/prisma.js'
import { MediaService } from '../../lib/media.service.js'
import { NotificationEvents } from '../../lib/notification.events.js'
import { invalidateProductCache } from '../../lib/redis.js'

export const getAllProducts = async (c: Context) => {
  try {
    const products = await prisma.product.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        freelancer: {
          include: {
            user: {
              select: {
                name: true,
                email: true,
                phone: true,
                avatar: true
              }
            }
          }
        }
      }
    })
    return c.json({ success: true, data: products })
  } catch (error: any) {
    console.error('Error fetching admin products:', error)
    return c.json({ success: false, message: 'Failed to fetch products', details: error.message }, 500)
  }
}

export const createProduct = async (c: Context) => {
  return c.json({ 
    success: false, 
    message: 'Admins are restricted from adding products directly. Only freelancers can add products from their side.' 
  }, 403)
}

export const updateProduct = async (c: Context) => {
  try {
    const id = c.req.param('id')
    const body = await c.req.json()
    const currentProduct = await prisma.product.findUnique({ where: { id } })
    if (!currentProduct) return c.json({ success: false, message: 'Product not found' }, 404)

    const { name, category, description, originalPrice, discountPrice, stock, images, imagePublicIds, isActive, isNew, isBanner } = body

    const updateData: any = {
      name,
      category,
      description,
      originalPrice,
      discountPrice,
      stock: parseInt(stock),
      images,
      imagePublicIds,
      isActive,
      isApproved: true,
      freelancerId: body.freelancerId !== undefined ? body.freelancerId : currentProduct.freelancerId,
    }

    if (body.isNew !== undefined) updateData.isNew = !!body.isNew
    if (body.isBanner !== undefined) updateData.isBanner = !!body.isBanner

  
    if (currentProduct.freelancerId) {
      return c.json({ 
        success: false, 
        message: 'This product belongs to a freelancer. Admins are restricted from editing freelancer-owned products. Please contact the vendor or use the approval/rejection tools.' 
      }, 403)
    }

    const product = await prisma.product.update({ where: { id }, data: updateData })

    // Production-Safe Lifecycle: Purge removed images AFTER successful DB update
    if (imagePublicIds) {
      await MediaService.syncImages(currentProduct.imagePublicIds || [], imagePublicIds);
    }

    try {
      // Notify if product is active (either just activated or was already active)
      if (product.isActive) {
        const title = (isActive && !currentProduct.isActive) ? 'New Product Available' : 'Product Updated'
        const body = (isActive && !currentProduct.isActive) 
          ? `A new product "${product.name}" is now available in ${product.category || 'the shop'}.`
          : `"${product.name}" has been updated with new details.`

        const { notificationService } = await import('../../lib/notification.service.js')
        await notificationService.sendToRole('USER', {
          type: 'PRODUCT_UPDATE',
          title: title,
          body: body,
          data: { productId: product.id, screen: 'ProductDetails' }
        }).catch(err => console.error('[AdminProducts] Failed to send update notification:', err))
      }
    } catch (pushError) {
      console.error('[AdminProducts] Failed to send update notification:', pushError)
    }

    await invalidateProductCache(id);

    // Also invalidate the freelancer's specific list if available
    try {
      const p = await prisma.product.findUnique({
        where: { id },
        include: { freelancer: { select: { userId: true } } }
      })
      if (p?.freelancer?.userId) {
        const { deleteCachePattern } = await import('../../lib/redis.js');
        await deleteCachePattern(`freelancer:products:${p.freelancer.userId}`)
      }
    } catch (err) {
      console.warn('[Admin] Cache invalidation failed for freelancer list:', err)
    }

    return c.json({ success: true, data: product })
  } catch (error: any) {
    console.error('Error updating product:', error)
    return c.json({ success: false, message: 'Failed to update product', details: error.message }, 500)
  }
}

export const approveProduct = async (c: Context) => {
  try {
    const id = c.req.param('id')
    const product = await prisma.product.findUnique({ where: { id } })
    if (!product) return c.json({ success: false, message: 'Product not found' }, 404)

    const updated = await prisma.product.update({
      where: { id },
      data: { isApproved: true, isActive: true } as any,
      include: {
        freelancer: {
          include: {
            user: {
              select: {
                name: true,
                email: true,
                phone: true,
                avatar: true
              }
            }
          }
        }
      }
    })

    try {
      const productWithFreelancer = await prisma.product.findUnique({
        where: { id },
        include: { freelancer: { select: { userId: true, shopName: true } } }
      })
      
      if (productWithFreelancer?.freelancer?.userId) {
        await NotificationEvents.onProductApproved(productWithFreelancer.freelancer.userId, id, product.name).catch(() => {})
      }

      const { notificationService } = await import('../../lib/notification.service.js')
      await notificationService.sendToRole('USER', { 
          type: 'NEW_PRODUCT', 
          title: 'New Arrival!',
          body: `${productWithFreelancer?.freelancer?.shopName || 'A seller'} just added "${product.name}" to their collection.`,
          data: { productId: product.id }
      }).catch(err => console.error('[AdminProducts] Failed to broadcast approved product:', err))

    } catch (notifErr) {
      console.warn('[Admin] Could not send approval notification:', notifErr)
    }

    await invalidateProductCache(id);
    
    try {
      const p = await prisma.product.findUnique({
        where: { id },
        include: { freelancer: { select: { userId: true } } }
      })
      if (p?.freelancer?.userId) {
        const { deleteCachePattern } = await import('../../lib/redis.js');
        await deleteCachePattern(`freelancer:products:${p.freelancer.userId}`)
      }
    } catch (err) {
      console.warn('[Admin] Cache invalidation failed for freelancer list:', err)
    }

    return c.json({ success: true, data: updated })
  } catch (error: any) {
    console.error('Error approving product:', error)
    return c.json({ success: false, message: 'Failed to approve product', details: error.message }, 500)
  }
}

export const rejectProduct = async (c: Context) => {
  try {
    const id = c.req.param('id')
    const body = await c.req.json().catch(() => ({}))
    const product = await prisma.product.findUnique({ where: { id } })
    if (!product) return c.json({ success: false, message: 'Product not found' }, 404)

    const updated = await prisma.product.update({
      where: { id },
      data: { 
        isApproved: false, 
        isActive: false,
        rejectionReason: body.reason || null 
      } as any,
      include: {
        freelancer: {
          include: {
            user: {
              select: {
                name: true,
                email: true,
                phone: true,
                avatar: true
              }
            }
          }
        }
      }
    })

    // Notify the freelancer
    try {
      const productWithFreelancer = await prisma.product.findUnique({
        where: { id },
        include: { freelancer: { select: { userId: true } } }
      })
      
      if (productWithFreelancer?.freelancer?.userId) {
        await NotificationEvents.onProductRejected(
          productWithFreelancer.freelancer.userId, 
          id, 
          product.name, 
          body.reason || 'No reason provided'
        ).catch(() => {})
      }
    } catch (notifErr) {
      console.warn('[Admin] Could not send rejection notification:', notifErr)
    }

    // Invalidate caches
    await invalidateProductCache(id);

    // Also invalidate the freelancer's specific list if available
    try {
      const p = await prisma.product.findUnique({
        where: { id },
        include: { freelancer: { select: { userId: true } } }
      })
      if (p?.freelancer?.userId) {
        const { deleteCachePattern } = await import('../../lib/redis.js');
        await deleteCachePattern(`freelancer:products:${p.freelancer.userId}`)
      }
    } catch (err) {
      console.warn('[Admin] Cache invalidation failed for freelancer list:', err)
    }

    return c.json({ success: true, data: updated })
  } catch (error: any) {
    console.error('Error rejecting product:', error)
    return c.json({ success: false, message: 'Failed to reject product', details: error.message }, 500)
  }
}

export const deleteProduct = async (c: Context) => {
  try {
    const id = c.req.param('id')
    
    const product = await prisma.product.findUnique({ where: { id } })
    if (!product) return c.json({ success: false, message: 'Product not found' }, 404)

    if (product.imagePublicIds?.length) {
      await MediaService.deleteMany(product.imagePublicIds)
    }

    // Invalidate caches (Do it before deletion to get the relation if needed)
    try {
      const p = await prisma.product.findUnique({
        where: { id },
        include: { freelancer: { select: { userId: true } } }
      })
      
      await invalidateProductCache(id);
      
      if (p?.freelancer?.userId) {
        const { deleteCachePattern } = await import('../../lib/redis.js');
        await deleteCachePattern(`freelancer:products:${p.freelancer.userId}`)
      }
    } catch (err) {
      console.warn('[Admin] Cache invalidation failed during deletion:', err)
    }

    // Delete associated reviews first to bypass foreign key constraint
    await prisma.review.deleteMany({
      where: { productId: id }
    })

    // Delete associated order items first to bypass the foreign key constraint
    await prisma.orderItem.deleteMany({
      where: { productId: id }
    })

    await prisma.product.delete({ where: { id } })

    return c.json({ success: true, message: 'Product and associated assets deleted successfully' })
  } catch (error: any) {
    console.error('Error deleting product:', error)
    return c.json({ success: false, message: 'Failed to delete product', details: error.message }, 500)
  }
}

export const toggleFeatured = async (c: Context) => {
  try {
    const id = c.req.param('id')
    const product = await prisma.product.findUnique({ where: { id } })
    if (!product) return c.json({ success: false, message: 'Product not found' }, 404)

    const updated = await prisma.product.update({
      where: { id },
      data: { isBanner: !product.isBanner } as any
    })

    await invalidateProductCache(id);

    return c.json({ success: true, data: updated })
  } catch (error: any) {
    console.error('Error toggling featured status:', error)
    return c.json({ success: false, message: 'Failed to update featured status', details: error.message }, 500)
  }
}
