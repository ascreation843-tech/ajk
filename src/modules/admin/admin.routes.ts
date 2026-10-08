import { Hono } from 'hono'
import * as adminProductsController from './products.controller.js'
import * as adminOrdersController from './orders.controller.js'
import * as adminUsersController from './users.controller.js'
import * as adminAnalyticsController from './analytics.controller.js'
import * as adminNotificationsController from './notifications.controller.js'
import { authMiddleware, roleMiddleware } from '../../middlewares/auth.js'

const adminRoutes = new Hono()

// Apply Admin-only middleware to all routes
adminRoutes.use('*', authMiddleware, roleMiddleware(['ADMIN']))

// Dashboard Analytics
adminRoutes.get('/analytics/dashboard', adminAnalyticsController.getDashboardStats)

// Admin User Stats & Active Directory
adminRoutes.get('/stats/users', adminUsersController.getUserStats)
adminRoutes.get('/users', adminUsersController.getAllUsers)
adminRoutes.get('/users/freelancers', adminUsersController.getAllFreelancers)
adminRoutes.put('/users/:id/toggle-status', adminUsersController.toggleUserStatus)
adminRoutes.patch('/users/:id', adminUsersController.updateUser)
adminRoutes.delete('/users/:id', adminUsersController.deleteUser)

// Admin Product Routes
adminRoutes.get('/products', adminProductsController.getAllProducts)
adminRoutes.post('/products', adminProductsController.createProduct)
adminRoutes.put('/products/:id', adminProductsController.updateProduct)
adminRoutes.post('/products/:id/approve', adminProductsController.approveProduct)
adminRoutes.post('/products/:id/reject', adminProductsController.rejectProduct)
adminRoutes.post('/products/:id/toggle-featured', adminProductsController.toggleFeatured)
adminRoutes.delete('/products/:id', adminProductsController.deleteProduct)

// Admin Order Routes
adminRoutes.get('/orders', adminOrdersController.getAllOrders)
adminRoutes.put('/orders/:id/status', adminOrdersController.updateOrderStatus)

// Admin Notification Routes
adminRoutes.post('/notifications/bulk', adminNotificationsController.sendBulkNotification)

export default adminRoutes
