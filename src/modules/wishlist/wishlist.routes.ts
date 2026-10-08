import { Hono } from 'hono';
import { WishlistController } from './wishlist.controller.js';
import { authMiddleware } from '../../middlewares/auth.js';

const wishlistRoutes = new Hono();

// All wishlist routes require authentication
wishlistRoutes.use('*', authMiddleware);

wishlistRoutes.get('/', WishlistController.getWishlist);
wishlistRoutes.post('/toggle/:productId', WishlistController.toggleItem);
wishlistRoutes.delete('/:productId', WishlistController.removeItem);

export default wishlistRoutes;
