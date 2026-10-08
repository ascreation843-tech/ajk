import { Context } from 'hono';

export const errorHandler = (err: any, c: Context) => {
  console.error('🚨 [ERROR HANDLER]:', err);

  const status = err.status || 500;
  const message = err.message || 'Internal Server Error';

  return c.json({
    success: false,
    message,
    errors: err.errors || undefined,
  }, status);
};
