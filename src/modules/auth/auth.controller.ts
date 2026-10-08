import { Context } from 'hono'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { hash, compare } from 'bcryptjs'
import prisma from '../../lib/prisma.js'
import { setCache, deleteCache } from '../../lib/redis.js'
import { sendPasswordResetOtpEmail, sendSignupOtpEmail } from '../../lib/email.service.js'

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'
const REFRESH_SECRET = process.env.REFRESH_TOKEN_SECRET || process.env.JWT_SECRET || 'your-refresh-secret-key'
const ACCESS_TOKEN_EXPIRY = '15m'   
const REFRESH_TOKEN_DAYS = 30       
const OTP_EXPIRY_MINUTES = 10
const RESET_TOKEN_EXPIRY_MINUTES = 15
const MAX_OTP_ATTEMPTS = 5
const MAX_OTP_RESENDS = 3
const OTP_RESEND_WINDOW_MS = 60 * 60 * 1000
const SIGNUP_OTP_EXPIRY_MINUTES = 10

/**
 * Generate an access token (short-lived, stateless)
 */
const generateAccessToken = (user: { id: string; email: string; role: string }) => {
  return jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY })
}

/**
 * Generate a refresh token and persist it in the database
 */
const generateRefreshToken = async (userId: string): Promise<string> => {
  const token = crypto.randomBytes(64).toString('hex')
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000)

  await prisma.refreshToken.create({
    data: {
      token,
      userId,
      expiresAt,
    },
  })

  return token
}

/**
 * Clean up expired tokens for a user (housekeeping)
 */
const cleanExpiredTokens = async (userId: string) => {
  await prisma.refreshToken.deleteMany({
    where: {
      userId,
      expiresAt: { lt: new Date() },
    },
  }).catch(() => {})
}

const hashOtpCode = (otp: string) => crypto.createHash('sha256').update(otp).digest('hex')
const generateOtpCode = () => `${Math.floor(100000 + Math.random() * 900000)}`

const createSignupOtp = async (userId: string, email: string, isResend = false) => {
  let resendCount = 0
  if (isResend) {
    const oneHourAgo = new Date(Date.now() - OTP_RESEND_WINDOW_MS)
    const latestOtp = await (prisma as any).emailVerificationOtp.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    })
    const isWithinWindow = latestOtp?.createdAt && latestOtp.createdAt >= oneHourAgo
    resendCount = isWithinWindow ? (latestOtp?.resendCount ?? 0) : 0
    if (resendCount >= MAX_OTP_RESENDS) {
      throw new Error('OTP_RESEND_LIMIT_REACHED')
    }
  }

  const otp = generateOtpCode()
  const otpHash = hashOtpCode(otp)
  const expiresAt = new Date(Date.now() + SIGNUP_OTP_EXPIRY_MINUTES * 60 * 1000)

  await (prisma as any).emailVerificationOtp.updateMany({
    where: { userId, usedAt: null },
    data: { usedAt: new Date() },
  })

  await (prisma as any).emailVerificationOtp.create({
    data: {
      userId,
      otpHash,
      expiresAt,
      resendCount: isResend ? resendCount + 1 : 0,
    },
  })

  await sendSignupOtpEmail(email, otp)
}

const createPasswordResetOtp = async (userId: string, email: string, isResend = false) => {
  let resendCount = 0
  if (isResend) {
    const oneHourAgo = new Date(Date.now() - OTP_RESEND_WINDOW_MS)
    const latestOtp = await (prisma as any).passwordResetOtp.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    })
    const isWithinWindow = latestOtp?.createdAt && latestOtp.createdAt >= oneHourAgo
    resendCount = isWithinWindow ? (latestOtp?.resendCount ?? 0) : 0
    if (resendCount >= MAX_OTP_RESENDS) {
      throw new Error('OTP_RESEND_LIMIT_REACHED')
    }
  }

  const otp = generateOtpCode()
  const otpHash = hashOtpCode(otp)
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000)

  await (prisma as any).passwordResetOtp.updateMany({
    where: { userId, usedAt: null },
    data: { usedAt: new Date() },
  })

  await (prisma as any).passwordResetOtp.create({
    data: {
      userId,
      otpHash,
      expiresAt,
      resendCount: isResend ? resendCount + 1 : 0,
    },
  })

  await sendPasswordResetOtpEmail(email, otp)
}

export const signup = async (c: Context) => {
  try {
    const body = await c.req.json()
    const normalizedEmail = body?.email?.toLowerCase().trim()
    const { password, name, shopName, phone, region } = body
    let { role } = body

    if (!normalizedEmail) {
      return c.json({ success: false, message: 'Email is required' }, 400)
    }

    // Map frontend roles to backend enum
    if (role) {
      role = role.toUpperCase()
      // Backward compatibility mapping
      if (role === 'PARTNER' || role === 'BUSINESS_PARTNER') role = 'FREELANCER'
      if (role === 'USER') role = 'BUYER'
    }

    // Security: Prevent unauthorized ADMIN role creation
    if (role === 'ADMIN') {
      return c.json({ success: false, message: 'Unauthorized role assignment' }, 403)
    }

    // Validation for Freelancers
    if (role === 'FREELANCER') {
      if (!phone) {
        return c.json({ success: false, message: 'Phone number is required for freelancers' }, 400)
      }
    }

    const userName = name || 'Friend'
    const finalShopName = shopName || `${userName}'s Shop`
    const finalRegion = region || 'General'

    const existingUserByEmail = await prisma.user.findUnique({ where: { email: normalizedEmail } })
    if (existingUserByEmail) {
      return c.json({ success: false, message: 'Email already in use' }, 409)
    }

    // Phone check - only if provided (mainly for freelncers)
    if (phone) {
      const existingFreelancerByPhone = await prisma.freelancer.findFirst({ 
        where: { phone } 
      })
      if (existingFreelancerByPhone) {
        return c.json({ success: false, message: 'Phone number already in use' }, 409)
      }
    }

    const hashedPassword = await hash(password, 10)

    // Transaction to create User + (Optional) Freelancer Profile
    const user = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email: normalizedEmail,
          password: hashedPassword,
          name,
          role: (role as any) || 'BUYER', 
          avatar: body.avatar,
          isActive: true, // Default active
          notificationPreferences: {
            create: {
              pushEnabled: true,
              emailEnabled: true,
              orderUpdates: true,
              newProducts: true
            }
          }
        }
      })

      // If role is FREELANCER, create profile
      if (role === 'FREELANCER') {
        await tx.freelancer.create({
          data: {
            userId: newUser.id,
            shopName: finalShopName,
            phone,
            region: finalRegion,
            isActive: true,
            isSubscriptionActive: true,
          }
        })
      }

      return newUser
    })

    await createSignupOtp(user.id, normalizedEmail)

    // Invalidate Admin Stats Cache
    deleteCache('admin:user:stats').catch(err => console.error('[Signup] Stats cache invalidation failed:', err))
    
    // Pre-cache user status
    setCache(`user:status:${user.id}`, true, 86400).catch(err => console.error('[Signup] User status caching failed:', err))
    
    return c.json({ 
      success: true, 
      message: 'Signup successful. Please verify your email with the OTP code sent to your inbox.',
      data: { 
        requiresEmailVerification: true,
        user: { 
          id: user.id, 
          email: user.email, 
          role: user.role,
          name: user.name,
          // Return generic or specific fields as needed by frontend
          shopName: finalShopName, 
          phone: phone,
          avatar: user.avatar,
          emailVerified: false
        } 
      } 
    }, 201)
  } catch (error: any) {
    console.error('Signup error:', error)
    return c.json({ success: false, message: 'Signup failed', details: error.message }, 500)
  }
}

export const login = async (c: Context) => {
  try {
    const { email, password } = await c.req.json()
    const normalizedEmail = email?.toLowerCase().trim()

    if (!normalizedEmail) {
      return c.json({ success: false, message: 'Email is required.' }, 400)
    }

    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } })
    
    if (!user) {
      return c.json({ success: false, message: 'Account not found.' }, 404)
    }

    const validPassword = await compare(password, user.password)
    
    if (!validPassword) {
      return c.json({ success: false, message: 'Incorrect password.' }, 403)
    }

    if (!(user as any).isActive) {
      return c.json({ 
        success: false, 
        message: 'Your account has been suspended. Please contact support for assistance.' 
      }, 403)
    }
    if (!(user as any).emailVerified && user.role !== 'ADMIN') {
      let otpDispatched = false
      let otpResendLimited = false
      try {
        await createSignupOtp(user.id, user.email, true)
        otpDispatched = true
      } catch (otpError: any) {
        if (otpError?.message === 'OTP_RESEND_LIMIT_REACHED') {
          otpResendLimited = true
        } else {
          console.error('[Login] Failed to dispatch signup OTP:', otpError)
        }
      }

      return c.json({
        success: false,
        message: otpDispatched
          ? 'Please verify your email before signing in. We just sent a fresh OTP to your inbox.'
          : otpResendLimited
            ? 'Please verify your email before signing in. OTP resend limit reached, please try again in 1 hour.'
            : 'Please verify your email before signing in.',
        code: 'EMAIL_NOT_VERIFIED',
        data: { email: user.email, otpDispatched, otpResendLimited },
      }, 403)
    }

    const accessToken = generateAccessToken(user)
    const refreshToken = await generateRefreshToken(user.id)

    cleanExpiredTokens(user.id)
    setCache(`user:status:${user.id}`, true, 86400)
      .catch(err => console.error('[Login] User status caching failed:', err))

    let freelancerProfile = null
    if ((user.role as string) === 'FREELANCER' || (user.role as string) === 'BUSINESS_PARTNER') {
      freelancerProfile = await prisma.freelancer.findUnique({
        where: { userId: user.id }
      })
    }

    return c.json({ 
      success: true, 
      data: { 
        token: accessToken,
        refreshToken,
        user: { 
          id: user.id, 
          email: user.email, 
          role: user.role,
          name: user.name,
          
          // Legacy support: map Freelancer fields to top level if needed, or put inside 'freelancer' object
          shopName: freelancerProfile?.shopName || user.shopName,
          phone: freelancerProfile?.phone || user.phone,
          region: freelancerProfile?.region || user.region,
          
          avatar: user.avatar,
          emailVerified: (user as any).emailVerified === true,
          freelancer: freelancerProfile 
        } 
      } 
    })
  } catch (error: any) {
    console.error('Login error:', error)
    return c.json({ success: false, message: 'Login failed', details: error.message }, 500)
  }
}

export const forgotPassword = async (c: Context) => {
  try {
    const { email } = await c.req.json()
    const normalizedEmail = email?.toLowerCase().trim()

    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } })
    if (!user) {
      return c.json({
        success: true,
        message: 'If this email exists, a verification code has been sent.',
      })
    }

    const oneHourAgo = new Date(Date.now() - OTP_RESEND_WINDOW_MS)
    const latestOtpInWindow = await (prisma as any).passwordResetOtp.findFirst({
      where: { userId: user.id, createdAt: { gte: oneHourAgo } },
      orderBy: { createdAt: 'desc' },
    })
    const isResend = !!latestOtpInWindow
    await createPasswordResetOtp(user.id, normalizedEmail, isResend)

    return c.json({
      success: true,
      message: 'Verification code sent successfully. Please check your email inbox.',
    })
  } catch (error: any) {
    if (error?.message === 'OTP_RESEND_LIMIT_REACHED') {
      return c.json({
        success: false,
        message: 'You can resend the OTP only 2 times. Please wait and try again later.',
      }, 429)
    }
    console.error('Forgot password error:', error)
    return c.json({
      success: false,
      message: 'We could not send the verification code email right now. Please try again.',
    }, 500)
  }
}

export const resendSignupOtp = async (c: Context) => {
  try {
    const { email } = await c.req.json()
    const normalizedEmail = email?.toLowerCase().trim()

    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } })
    if (!user) {
      return c.json({
        success: true,
        message: 'If this email exists, a verification code has been sent.',
      })
    }

    if ((user as any).emailVerified) {
      return c.json({
        success: true,
        message: 'Your email is already verified. Please sign in.',
      })
    }

    await createSignupOtp(user.id, normalizedEmail, true)
    return c.json({
      success: true,
      message: 'Verification code sent successfully. Please check your email inbox.',
    })
  } catch (error: any) {
    if (error?.message === 'OTP_RESEND_LIMIT_REACHED') {
      return c.json({
        success: false,
        message: 'You can resend the OTP only 2 times. Please wait and try again later.',
      }, 429)
    }
    console.error('Resend signup OTP error:', error)
    return c.json({
      success: false,
      message: 'We could not send the verification code email right now. Please try again.',
    }, 500)
  }
}

export const verifySignupOtp = async (c: Context) => {
  try {
    const { email, otp } = await c.req.json()
    const normalizedEmail = email?.toLowerCase().trim()
    const normalizedOtp = `${otp}`.trim()

    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } })
    if (!user) {
      return c.json({ success: false, message: 'Invalid verification code.' }, 400)
    }

    if ((user as any).emailVerified) {
      return c.json({ success: true, message: 'Email already verified. Please sign in.' })
    }

    const otpRecord = await (prisma as any).emailVerificationOtp.findFirst({
      where: {
        userId: user.id,
        usedAt: null,
        verifiedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    })

    if (!otpRecord || otpRecord.expiresAt < new Date()) {
      return c.json({ success: false, message: 'Verification code has expired. Request a new one.' }, 400)
    }

    const incomingOtpHash = hashOtpCode(normalizedOtp)
    if (incomingOtpHash !== otpRecord.otpHash) {
      const nextAttempts = otpRecord.attempts + 1
      await (prisma as any).emailVerificationOtp.update({
        where: { id: otpRecord.id },
        data: {
          attempts: nextAttempts,
          ...(nextAttempts >= MAX_OTP_ATTEMPTS ? { usedAt: new Date() } : {}),
        },
      })
      return c.json({ success: false, message: 'Invalid verification code.' }, 400)
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { emailVerified: true } as any,
      })
      await (tx as any).emailVerificationOtp.update({
        where: { id: otpRecord.id },
        data: {
          verifiedAt: new Date(),
          usedAt: new Date(),
        },
      })
    })

    const accessToken = generateAccessToken(user)
    const refreshToken = await generateRefreshToken(user.id)

    let freelancerProfile = null
    if ((user.role as string) === 'FREELANCER' || (user.role as string) === 'BUSINESS_PARTNER') {
      freelancerProfile = await prisma.freelancer.findUnique({
        where: { userId: user.id },
      })
    }

    return c.json({
      success: true,
      message: 'Email verified successfully.',
      data: {
        token: accessToken,
        refreshToken,
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          name: user.name,
          shopName: freelancerProfile?.shopName || user.shopName,
          phone: freelancerProfile?.phone || user.phone,
          region: freelancerProfile?.region || user.region,
          avatar: user.avatar,
          emailVerified: true,
          freelancer: freelancerProfile,
        },
      },
    })
  } catch (error: any) {
    console.error('Verify signup OTP error:', error)
    return c.json({ success: false, message: 'Unable to verify code' }, 500)
  }
}

export const verifyResetOtp = async (c: Context) => {
  try {
    const { email, otp } = await c.req.json()
    const normalizedEmail = email?.toLowerCase().trim()
    const normalizedOtp = `${otp}`.trim()

    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } })
    if (!user) {
      return c.json({ success: false, message: 'Invalid verification code.' }, 400)
    }

    const otpRecord = await (prisma as any).passwordResetOtp.findFirst({
      where: {
        userId: user.id,
        usedAt: null,
        verifiedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    })

    if (!otpRecord || otpRecord.expiresAt < new Date()) {
      return c.json({ success: false, message: 'Verification code has expired. Request a new one.' }, 400)
    }

    const incomingOtpHash = hashOtpCode(normalizedOtp)
    if (incomingOtpHash !== otpRecord.otpHash) {
      const nextAttempts = otpRecord.attempts + 1
      await (prisma as any).passwordResetOtp.update({
        where: { id: otpRecord.id },
        data: {
          attempts: nextAttempts,
          ...(nextAttempts >= MAX_OTP_ATTEMPTS ? { usedAt: new Date() } : {}),
        },
      })

      return c.json({ success: false, message: 'Invalid verification code.' }, 400)
    }

    const resetToken = crypto.randomBytes(32).toString('hex')
    const resetTokenExpiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_MINUTES * 60 * 1000)

    await (prisma as any).passwordResetOtp.update({
      where: { id: otpRecord.id },
      data: {
        verifiedAt: new Date(),
        resetToken,
        resetTokenExpiresAt,
      },
    })

    return c.json({
      success: true,
      message: 'Verification successful. You can now set a new password.',
      data: { resetToken },
    })
  } catch (error: any) {
    console.error('Verify reset OTP error:', error)
    return c.json({ success: false, message: 'Unable to verify code' }, 500)
  }
}

export const resetPassword = async (c: Context) => {
  try {
    const { email, resetToken, newPassword } = await c.req.json()
    const normalizedEmail = email?.toLowerCase().trim()

    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } })
    if (!user) {
      return c.json({ success: false, message: 'Invalid reset request.' }, 400)
    }

    const otpRecord = await (prisma as any).passwordResetOtp.findFirst({
      where: {
        userId: user.id,
        resetToken,
        verifiedAt: { not: null },
        usedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    })

    if (!otpRecord || !otpRecord.resetTokenExpiresAt || otpRecord.resetTokenExpiresAt < new Date()) {
      return c.json({ success: false, message: 'Reset session expired. Please verify again.' }, 400)
    }

    const hashedPassword = await hash(newPassword, 10)

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { password: hashedPassword },
      })

      await (tx as any).passwordResetOtp.update({
        where: { id: otpRecord.id },
        data: { usedAt: new Date() },
      })

      await tx.refreshToken.deleteMany({
        where: { userId: user.id },
      })
    })

    return c.json({
      success: true,
      message: 'Password updated successfully. Please sign in with your new password.',
    })
  } catch (error: any) {
    console.error('Reset password error:', error)
    return c.json({ success: false, message: 'Unable to reset password' }, 500)
  }
}

export const refreshTokenHandler = async (c: Context) => {
  try {
    const { refreshToken } = await c.req.json()

    if (!refreshToken) {
      return c.json({ success: false, message: 'Refresh token is required' }, 400)
    }

    // Find the refresh token in DB
    const storedToken = await prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: true },
    })

    if (!storedToken) {
      return c.json({ success: false, message: 'Session expired.' }, 401)
    }

    if (storedToken.expiresAt < new Date()) {
      await prisma.refreshToken.delete({ where: { id: storedToken.id } }).catch(() => {})
      return c.json({ success: false, message: 'Refresh token expired, please login again' }, 401)
    }

    // Check if user is still active
    if (!(storedToken.user as any).isActive) {
      return c.json({ 
        success: false, 
        message: 'Your account has been suspended. Please contact support for assistance.' 
      }, 403)
    }

    // Token rotation: Delete old token, create new one
    await prisma.refreshToken.delete({ where: { id: storedToken.id } })

    // Issue new tokens
    const newAccessToken = generateAccessToken(storedToken.user)
    const newRefreshToken = await generateRefreshToken(storedToken.user.id)

    return c.json({
      success: true,
      data: {
        token: newAccessToken,
        refreshToken: newRefreshToken,
      },
    })
  } catch (error: any) {
    console.error('Refresh token error:', error)
    return c.json({ success: false, message: 'Token refresh failed', details: error.message }, 500)
  }
}

export const logout = async (c: Context) => {
  try {
    const user = c.get('user')
    if (user?.id) {
      await deleteCache(`user:status:${user.id}`)
      await prisma.refreshToken.deleteMany({
        where: { userId: user.id },
      }).catch((err: any) => console.error('[Logout] Failed to delete refresh tokens:', err))
    }
    return c.json({ success: true, message: 'Logged out successfully' })
  } catch (error: any) {
    console.error('Logout error:', error)
    return c.json({ success: false, message: 'Logout failed' }, 500)
  }
}
