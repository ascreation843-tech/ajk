import prisma from '../../lib/prisma.js'

export const FreelancerService = {
  /**
   * Create a freelancer profile for a user
   */
  async createProfile(userId: string, data: { shopName?: string; phone?: string; region?: string }) {
    return prisma.freelancer.create({
      data: {
        userId,
        shopName: data.shopName,
        phone: data.phone,
        region: data.region,
        isActive: true,
        isSubscriptionActive: true,
      }
    })
  },

  /**
   * Get freelancer profile by user ID
   */
  async getProfile(userId: string) {
    return prisma.freelancer.findUnique({
      where: { userId }
    })
  },

  /**
   * Check if a user is an active freelancer
   */
  async isFreelancerActive(userId: string) {
    const profile = await prisma.freelancer.findUnique({
      where: { userId },
      select: { isSubscriptionActive: true, isActive: true }
    })
    return profile?.isActive && profile?.isSubscriptionActive
  }
}
