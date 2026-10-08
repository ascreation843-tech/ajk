import { Hono } from 'hono'
import * as ordersController from './orders.controller.js'
import { authMiddleware } from '../../middlewares/auth.js'

const orderRoutes = new Hono<{ Variables: { user: any } }>()

orderRoutes.post('/', authMiddleware, ordersController.createOrder)
orderRoutes.get('/', authMiddleware, ordersController.getMyOrders)
orderRoutes.get('/stats', authMiddleware, ordersController.getOrderStats)
orderRoutes.get('/:id', authMiddleware, ordersController.getOrderById)
orderRoutes.put('/:id/cancel', authMiddleware, ordersController.cancelOrder)

export default orderRoutes
