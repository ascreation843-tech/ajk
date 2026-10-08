import { notificationService } from './notification.service.js'

/**
 * Event-based Notification Triggers
 * Centralizes what notification is sent for each business event.
 */
export const NotificationEvents = {
  // --- Orders ---
  
  onOrderCreated: async (orderId: string, buyerId: string, freelancerIds: string[]) => {
    // Notify Buyer
    await notificationService.createAndSend(buyerId, {
      type: 'ORDER_CREATED',
      title: 'Order Confirmed!',
      body: `Your order #${orderId.substring(0, 8)} has been placed successfully.`,
      data: { orderId, screen: 'OrderDetails' }
    });

    // Notify Freelancers
    await notificationService.sendToUsers(freelancerIds, {
      type: 'NEW_FREELANCER_ORDER',
      title: 'New Order Received!',
      body: 'You have a new order to fulfill. Check the details now.',
      data: { orderId, screen: 'FreelancerOrderDetails' }
    });
  },

  onOrderStatusUpdated: async (userId: string, orderId: string, status: string) => {
    await notificationService.createAndSend(userId, {
      type: 'ORDER_UPDATE',
      title: 'Order Status Updated',
      body: `Your order #${orderId.substring(0, 8)} is now ${status.toLowerCase()}.`,
      data: { orderId, status, screen: 'OrderDetails' }
    });
  },

  onPaymentProofSubmitted: async (freelancerIds: string[], orderId: string) => {
    await notificationService.sendToUsers(freelancerIds, {
      type: 'PAYMENT_PROOF_SUBMITTED',
      title: 'Payment Proof Received',
      body: `A buyer has uploaded payment proof for order #${orderId.substring(0, 8)}.`,
      data: { orderId, screen: 'FreelancerOrderDetails' }
    });
  },

  onPaymentVerified: async (buyerId: string, orderId: string) => {
    await notificationService.createAndSend(buyerId, {
      type: 'PAYMENT_VERIFIED',
      title: 'Payment Verified ✅',
      body: `Your payment for order #${orderId.substring(0, 8)} has been verified.`,
      data: { orderId, screen: 'OrderDetails' }
    });
  },

  // --- Products ---

  onProductApproved: async (freelancerId: string, productId: string, productName: string) => {
    await notificationService.createAndSend(freelancerId, {
      type: 'PRODUCT_APPROVED',
      title: 'Product Approved! 🚀',
      body: `Your product "${productName}" has been approved and is now live.`,
      data: { productId, screen: 'FreelancerProductDetails' }
    });
  },

  onProductRejected: async (freelancerId: string, productId: string, productName: string, reason: string) => {
    await notificationService.createAndSend(freelancerId, {
      type: 'PRODUCT_REJECTED',
      title: 'Product Action Required',
      body: `Your product "${productName}" was not approved. Reason: ${reason}`,
      data: { productId, screen: 'FreelancerProductDetails' }
    });
  },

  onLowStock: async (freelancerId: string, productId: string, productName: string, stock: number) => {
    await notificationService.createAndSend(freelancerId, {
      type: 'LOW_STOCK_ALERT',
      title: 'Low Stock Alert ⚠️',
      body: `"${productName}" is running low on stock (${stock} left).`,
      data: { productId, stock, screen: 'FreelancerProductDetails' }
    });
  },

  // --- Reviews ---

  onNewReview: async (freelancerId: string, productId: string, rating: number) => {
    await notificationService.createAndSend(freelancerId, {
      type: 'NEW_REVIEW',
      title: 'New Review Received ⭐',
      body: `You received a ${rating}-star review on your product.`,
      data: { productId, screen: 'FreelancerProductReviews' }
    });
  }
};
