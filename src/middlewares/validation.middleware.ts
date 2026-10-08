import { z } from 'zod';
import { Context, Next } from 'hono';

export const signupSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  name: z.string().min(2, 'Name is required'),
  role: z.preprocess((val) => {
    if (!val || typeof val !== 'string') return val;
    const v = val.toUpperCase();
    if (v === 'PARTNER' || v === 'BUSINESS_PARTNER') return 'FREELANCER';
    return v;
  }, z.enum(['BUYER', 'SELLER', 'FREELANCER', 'USER'])).optional(),
  shopName: z.string().optional(),
  phone: z.string().optional(),
  region: z.string().optional(),
});

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export const resendSignupOtpSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export const verifySignupOtpSchema = z.object({
  email: z.string().email('Invalid email address'),
  otp: z.string().trim().regex(/^\d{6}$/, 'OTP must be a 6-digit code'),
});

export const verifyResetOtpSchema = z.object({
  email: z.string().email('Invalid email address'),
  otp: z.string().trim().regex(/^\d{6}$/, 'OTP must be a 6-digit code'),
});

export const resetPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
  resetToken: z.string().min(16, 'Invalid reset token'),
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
});

export const validateRequest = (schema: z.ZodSchema) => {
  return async (c: Context, next: Next) => {
    try {
      const body = await c.req.json();
      schema.parse(body);
      await next();
    } catch (error: any) {
      return c.json({
        success: false,
        message: 'Validation failed',
        errors: error.errors || error.message,
      }, 400);
    }
  };
};
