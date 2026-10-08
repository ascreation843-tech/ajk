import { Resend } from 'resend'

const resendApiKey = process.env.RESEND_API_KEY
const fromEmail = process.env.RESEND_FROM_EMAIL

let resendClient: Resend | null = null

const getResendClient = () => {
  if (!resendApiKey) return null
  if (!resendClient) {
    resendClient = new Resend(resendApiKey)
  }
  return resendClient
}

export const sendPasswordResetOtpEmail = async (email: string, otp: string) => {
  const client = getResendClient()
  if (!client) {
    throw new Error('Email service is not configured. Missing RESEND_API_KEY.')
  }
  if (!fromEmail) {
    throw new Error('Email service is not configured. Missing RESEND_FROM_EMAIL.')
  }

  const result = await client.emails.send({
    from: fromEmail,
    to: email,
    subject: 'Your AJK Shop password reset code',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 20px;">
        <h2 style="margin: 0 0 12px; color: #111827;">Reset your password</h2>
        <p style="margin: 0 0 12px; color: #374151; line-height: 1.5;">
          Use the verification code below to reset your password. This code expires in 10 minutes.
        </p>
        <div style="margin: 18px 0; text-align: center;">
          <span style="display: inline-block; font-size: 28px; letter-spacing: 8px; font-weight: 700; color: #111827; background: #F3F4F6; border-radius: 10px; padding: 12px 20px;">
            ${otp}
          </span>
        </div>
        <p style="margin: 0; color: #6B7280; font-size: 13px;">
          If you did not request this code, you can safely ignore this email.
        </p>
      </div>
    `,
  })

  if ((result as any)?.error) {
    throw new Error((result as any).error?.message || 'Failed to send password reset OTP email.')
  }
}

export const sendSignupOtpEmail = async (email: string, otp: string) => {
  const client = getResendClient()
  if (!client) {
    throw new Error('Email service is not configured. Missing RESEND_API_KEY.')
  }
  if (!fromEmail) {
    throw new Error('Email service is not configured. Missing RESEND_FROM_EMAIL.')
  }

  const result = await client.emails.send({
    from: fromEmail,
    to: email,
    subject: 'Verify your AJK Shop account',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 20px;">
        <h2 style="margin: 0 0 12px; color: #111827;">Welcome to AJK Shop</h2>
        <p style="margin: 0 0 12px; color: #374151; line-height: 1.5;">
          Use this 6-digit code to verify your email and activate your account. This code expires in 10 minutes.
        </p>
        <div style="margin: 18px 0; text-align: center;">
          <span style="display: inline-block; font-size: 28px; letter-spacing: 8px; font-weight: 700; color: #111827; background: #F3F4F6; border-radius: 10px; padding: 12px 20px;">
            ${otp}
          </span>
        </div>
        <p style="margin: 0; color: #6B7280; font-size: 13px;">
          If you did not create this account, you can safely ignore this email.
        </p>
      </div>
    `,
  })

  if ((result as any)?.error) {
    throw new Error((result as any).error?.message || 'Failed to send signup OTP email.')
  }
}
