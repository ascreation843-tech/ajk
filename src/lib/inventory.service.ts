import prisma from './prisma.js'
import { NotificationEvents } from './notification.events.js'

export const STOCK_THRESHOLD = 5

/**
 * Checks if a product's stock is low and notifies the associated freelancer.
 * @param productId The ID of the product to check.
 */
export async function checkAndNotifyLowStock(productId: string) {
  try {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: {
        freelancer: {
          select: {
            userId: true,
            shopName: true
          }
        }
      }
    })

    if (!product || !product.freelancerId || !product.freelancer) {
      return
    }

    if (product.stock <= STOCK_THRESHOLD) {
      console.log(`[InventoryIntel] Low stock detected for "${product.name}" (Stock: ${product.stock}). Triggering alert for freelancer ${product.freelancer.userId}.`)
      
      await NotificationEvents.onLowStock(
        product.freelancer.userId,
        product.id,
        product.name,
        product.stock
      )
    }
  } catch (error) {
    console.error('[InventoryIntel] Error checking low stock:', error)
  }
}

export const inventoryService = {
  checkAndNotifyLowStock
}
