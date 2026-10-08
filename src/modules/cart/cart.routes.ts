import { Hono } from 'hono';
import { CartController } from './cart.controller.js';
import { authMiddleware } from '../../middlewares/auth.js';

const cartRoutes = new Hono();

// All cart routes require authentication
cartRoutes.use('*', authMiddleware);

cartRoutes.get('/', CartController.getCart);
cartRoutes.post('/sync', CartController.syncCart);
cartRoutes.put('/:productId', CartController.updateItem);
cartRoutes.delete('/:productId', CartController.removeItem);

export default cartRoutes;
