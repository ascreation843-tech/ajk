import { Hono } from 'hono'
import { authMiddleware, roleMiddleware } from '../../middlewares/auth.js'
import {
  createFreelancerProduct,
  deleteFreelancerProduct,
  getFreelancerOrders,
  getFreelancerProductById,
  getFreelancerProducts,
  getFreelancerProfile,
  updateFreelancerProduct,
  updateFreelancerProfile,
  updateFreelancerOrderStatus,
  verifyFreelancerPayment,
  getFreelancerEarningsAnalytics,
  getInventoryIntelligence,
  deleteFreelancerProfile,
  getFreelancerReviews
} from './freelancer.controller.js'

const freelancerRoutes = new Hono()

// All routes require authentication
freelancerRoutes.use('*', authMiddleware)
// All routes require FREELANCER or BUSINESS_PARTNER role
freelancerRoutes.use('*', roleMiddleware(['FREELANCER', 'BUSINESS_PARTNER']))

// Profile
freelancerRoutes.get('/profile', getFreelancerProfile)
freelancerRoutes.put('/profile', updateFreelancerProfile)
freelancerRoutes.delete('/profile', deleteFreelancerProfile)

// Products
freelancerRoutes.get('/products', getFreelancerProducts)
freelancerRoutes.get('/products/:id', getFreelancerProductById)
freelancerRoutes.post('/products', createFreelancerProduct)
freelancerRoutes.put('/products/:id', updateFreelancerProduct)
freelancerRoutes.delete('/products/:id', deleteFreelancerProduct)

// Orders
freelancerRoutes.get('/orders', getFreelancerOrders)
freelancerRoutes.put('/orders/:id/status', updateFreelancerOrderStatus)
freelancerRoutes.put('/orders/:orderId/items/:itemId/verify-payment', verifyFreelancerPayment)

// Analytics
freelancerRoutes.get('/analytics/earnings', getFreelancerEarningsAnalytics)
freelancerRoutes.get('/analytics/inventory', getInventoryIntelligence)

export default freelancerRoutes
