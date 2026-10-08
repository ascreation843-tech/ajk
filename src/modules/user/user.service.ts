import prisma from '../../lib/prisma.js';
import { MediaService } from '../../lib/media.service.js';

export class UserService {
  static async getProfile(userId: string) {
    const user = await (prisma as any).user.findUnique({
      where: { id: userId },
      include: { freelancerProfile: true }
    });

    if (!user) {
      throw new Error('User not found');
    }

    const { password: _, points: __, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }

  static async updateProfile(userId: string, data: any) {
    const updateData: any = {};

    if (data.name !== undefined) updateData.name = data.name;
    if (data.phone !== undefined) updateData.phone = data.phone;
    if (data.region !== undefined) updateData.region = data.region;
    if (data.shopName !== undefined) updateData.shopName = data.shopName;
    if (data.avatar !== undefined) updateData.avatar = data.avatar;
    if (data.avatarPublicId !== undefined) updateData.avatarPublicId = data.avatarPublicId;
    const freelancerData: any = {};
    let hasFreelancerUpdates = false;
    
    if (data.bankName !== undefined) { freelancerData.bankName = data.bankName; hasFreelancerUpdates = true; }
    if (data.accountTitle !== undefined) { freelancerData.accountTitle = data.accountTitle; hasFreelancerUpdates = true; }
    if (data.accountNumber !== undefined) { freelancerData.accountNumber = data.accountNumber; hasFreelancerUpdates = true; }
    if (data.phone !== undefined) { freelancerData.phone = data.phone; hasFreelancerUpdates = true; }
    if (data.region !== undefined) { freelancerData.region = data.region; hasFreelancerUpdates = true; }
    if (data.shopName !== undefined) { freelancerData.shopName = data.shopName; hasFreelancerUpdates = true; }

    const existingUser = await (prisma as any).user.findUnique({
      where: { id: userId },
      include: { freelancerProfile: true }
    });

    if (!existingUser) {
      throw new Error('User not found');
    }

    const hasProfile = !!existingUser.freelancerProfile;

    const user = await (prisma as any).user.update({
      where: { id: userId },
      data: {
        ...updateData,
        freelancerProfile: (hasFreelancerUpdates && hasProfile) ? {
          update: freelancerData
        } : undefined
      },
      include: { freelancerProfile: true }
    });

    // Production-Safe Lifecycle: Purge old avatar AFTER successful DB update
    if (data.avatarPublicId && existingUser?.avatarPublicId && existingUser.avatarPublicId !== data.avatarPublicId) {
      MediaService.deleteImage(existingUser.avatarPublicId).catch(err => 
        console.error(`[UserService] Failed to purge old avatar ${existingUser.avatarPublicId}:`, err)
      );
    }

    const { password: _, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }

  static async deleteAccount(userId: string) {
    return await (prisma as any).$transaction(async (tx: any) => {
      // 1. Check for pending orders as a BUYER
      const pendingBuyerOrders = await tx.order.count({
        where: {
          userId,
          status: { notIn: ['DELIVERED', 'CANCELLED'] }
        }
      });

      if (pendingBuyerOrders > 0) {
        throw new Error('Cannot delete account. you have pending orders as a buyer.');
      }

      // 2. Check for pending orders as a FREELANCER (if applicable)
      const freelancer = await tx.freelancer.findUnique({ where: { userId } });
      if (freelancer) {
        const pendingFreelancerOrders = await tx.orderItem.count({
          where: {
            freelancerId: freelancer.id,
            order: {
              status: { notIn: ['DELIVERED', 'CANCELLED'] }
            }
          }
        });

        if (pendingFreelancerOrders > 0) {
          throw new Error('Cannot delete account. you have pending orders in your shop.');
        }

        // Deactivate/Orphan products before freelancer deletion
        await tx.product.updateMany({
          where: { freelancerId: freelancer.id },
          data: { freelancerId: null, isActive: false, stock: 0 }
        });

        await tx.freelancer.delete({ where: { id: freelancer.id } });
      }

      // 3. Delete reviews
      await tx.review.deleteMany({ where: { userId } });

      // 4. Delete orders (only after confirming none are pending)
      const userOrders = await tx.order.findMany({ where: { userId } });
      const orderIds = userOrders.map((o: any) => o.id);

      if (orderIds.length > 0) {
        await tx.orderItem.deleteMany({
          where: { orderId: { in: orderIds } }
        });
        await tx.order.deleteMany({ where: { userId } });
      }

      // 5. Finally delete user
      const deletedUser = await tx.user.delete({
        where: { id: userId }
      });

      // Purge media assets
      if (deletedUser.avatarPublicId) {
        MediaService.deleteImage(deletedUser.avatarPublicId).catch(err => 
          console.error(`[UserService] Failed to purge avatar during account deletion:`, err)
        );
      }

      return deletedUser;
    }, {
      maxWait: 10000,
      timeout: 15000
    });
  }
}
