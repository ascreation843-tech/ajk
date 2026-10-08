import prisma from '../../lib/prisma.js';

export class CartService {
  static async getCart(userId: string) {
    return prisma.cartItem.findMany({
      where: { userId },
      include: {
        product: {
          include: {
            freelancer: {
              select: {
                id: true,
                shopName: true,
                bankName: true,
                accountTitle: true,
                accountNumber: true,
              },
            },
          },
        },
      }
    });
  }

  static async syncCart(userId: string, items: { productId: string, quantity: number }[]) {
    // Basic sync: Clear existing and replace with new ones
    // A more advanced sync would merge, but since the client is the source of truth for current session:
    await prisma.cartItem.deleteMany({
      where: { userId }
    });

    if (items.length === 0) return [];

    return prisma.cartItem.createMany({
      data: items.map(item => ({
        userId,
        productId: item.productId,
        quantity: item.quantity
      }))
    });
  }

  static async updateItem(userId: string, productId: string, quantity: number) {
    if (quantity <= 0) {
      return prisma.cartItem.delete({
        where: {
          userId_productId: { userId, productId }
        }
      });
    }

    return prisma.cartItem.upsert({
      where: {
        userId_productId: { userId, productId }
      },
      update: { quantity },
      create: { userId, productId, quantity }
    });
  }

  static async removeItem(userId: string, productId: string) {
    return prisma.cartItem.delete({
      where: {
        userId_productId: { userId, productId }
      }
    });
  }

  static async clearCart(userId: string) {
    return prisma.cartItem.deleteMany({
      where: { userId }
    });
  }
}
