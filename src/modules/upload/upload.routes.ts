import { Hono } from 'hono';
import { UploadController } from './upload.controller.js';
import { authMiddleware } from '../../middlewares/auth.js';
import { createRateLimiter } from '../../middlewares/rate-limiter.js';

const uploadRoutes = new Hono();

/**
 * Rate limit signature requests to prevent abuse.
 * Allows 10 signature requests every 5 minutes per user.
 */
const signatureRateLimiter = createRateLimiter({
  limit: 10,
  window: '5 m',
  message: 'Too many upload signature requests. Please wait a few minutes.',
  prefix: 'upload-sign',
});

/**
 * GET /upload/sign?type=avatar|product|freelancer_product|receipt
 * Returns credentials needed for direct client-side upload to Cloudinary.
 */
uploadRoutes.get('/sign', authMiddleware, signatureRateLimiter, UploadController.getSignature);

export { uploadRoutes };
