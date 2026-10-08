import { Hono } from 'hono';
import { UserController } from './user.controller.js';
import { authMiddleware } from '../../middlewares/auth.js';

const userRoutes = new Hono();

// All user routes require authentication
userRoutes.use('*', authMiddleware);

userRoutes.get('/profile', UserController.getProfile);
userRoutes.put('/profile', UserController.updateProfile);
userRoutes.delete('/profile', UserController.deleteAccount);

export default userRoutes;
