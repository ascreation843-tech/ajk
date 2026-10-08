import prisma from '../../lib/prisma.js';

export class WishlistService {
  static async getWishlist(userId: string) {
    return prisma.wishlistItem.findMany({
      where: { userId },
      include: {
        product: true
      }
    });
  }

  static async toggleItem(userId: string, productId: string) {
    try {
      const exists = await prisma.wishlistItem.findUnique({
        where: {
          userId_productId: { userId, productId }
        }
      });

      if (exists) {
        return await prisma.wishlistItem.delete({
          where: {
            userId_productId: { userId, productId }
          }
        });
      }

      return await prisma.wishlistItem.create({
        data: { userId, productId }
      });
    } catch (error: any) {
      if (error.code === 'P2002') {
        return await prisma.wishlistItem.delete({
          where: {
            userId_productId: { userId, productId }
          }
        });
      }
      throw error;
    }
  }

  static async removeItem(userId: string, productId: string) {
    return prisma.wishlistItem.delete({
      where: {
        userId_productId: { userId, productId }
      }
    });
  }

  static async clearWishlist(userId: string) {
    return prisma.wishlistItem.deleteMany({
      where: { userId }
    });
  }
}
