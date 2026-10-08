import { Hono } from 'hono'
import * as reviewsController from './reviews.controller.js'
import { authMiddleware, roleMiddleware } from '../../middlewares/auth.js'

const reviewsRoutes = new Hono<{ Variables: { user: any } }>()

// Public routes
reviewsRoutes.get('/product/:productId', reviewsController.getProductReviews)

// User routes
reviewsRoutes.post('/', authMiddleware, reviewsController.createReview)


// Admin routes
reviewsRoutes.get('/admin/all', authMiddleware, roleMiddleware(['ADMIN']), reviewsController.getAllReviews)
reviewsRoutes.put('/admin/:id/status', authMiddleware, roleMiddleware(['ADMIN']), reviewsController.toggleReviewStatus)
reviewsRoutes.delete('/admin/:id', authMiddleware, roleMiddleware(['ADMIN']), reviewsController.deleteReview)

export default reviewsRoutes
