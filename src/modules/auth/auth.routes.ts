import { Hono } from 'hono'
import * as authController from './auth.controller.js'
import {
  signupSchema,
  loginSchema,
  forgotPasswordSchema,
  resendSignupOtpSchema,
  verifyResetOtpSchema,
  verifySignupOtpSchema,
  resetPasswordSchema,
  validateRequest,
} from '../../middlewares/validation.middleware.js'

const authRoutes = new Hono()

authRoutes.post('/signup', validateRequest(signupSchema), authController.signup)
authRoutes.post('/login', validateRequest(loginSchema), authController.login)
authRoutes.post('/forgot-password', validateRequest(forgotPasswordSchema), authController.forgotPassword)
authRoutes.post('/resend-signup-otp', validateRequest(resendSignupOtpSchema), authController.resendSignupOtp)
authRoutes.post('/verify-signup-otp', validateRequest(verifySignupOtpSchema), authController.verifySignupOtp)
authRoutes.post('/verify-reset-otp', validateRequest(verifyResetOtpSchema), authController.verifyResetOtp)
authRoutes.post('/reset-password', validateRequest(resetPasswordSchema), authController.resetPassword)
authRoutes.post('/refresh', authController.refreshTokenHandler)
authRoutes.post('/logout', authController.logout)

export default authRoutes

