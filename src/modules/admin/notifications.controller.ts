import { Context } from 'hono'
import { z } from 'zod'
import { notificationService } from '../../lib/notification.service.js'
import prisma from '../../lib/prisma.js'

const bulkNotificationSchema = z.object({
  target: z.string(),
  title: z.string().min(1),
  body: z.string().min(1),
  data: z.record(z.string(), z.string()).optional(),
})

export const sendBulkNotification = async (c: Context) => {
  try {
    const body = await c.req.json()
    const validationResult = bulkNotificationSchema.safeParse(body)

    if (!validationResult.success) {
      return c.json({
        success: false,
        message: 'Invalid notification data provided.',
        errors: validationResult.error.flatten(),
      }, 400)
    }

    const { target, title, body: messageBody, data } = validationResult.data

    let result
    if (target === 'all') {
      console.log(`[AdminBulk] Starting global broadcast: "${title}"`)
      result = await notificationService.broadcast({ type: 'MARKETING', title, body: messageBody, data })
    } else {
      console.log(`[AdminBulk] Starting role-specific broadcast to ${target}: "${title}"`)
      result = await notificationService.sendToRole(target, { type: 'SYSTEM', title, body: messageBody, data })
    }

    return c.json({
      success: true,
      data: result,
      message: `Bulk notification processing complete. Target: ${target}`,
    })
  } catch (error: any) {
    console.error('Admin Bulk Notification Error:', error)
    return c.json({
      success: false,
      message: 'Failed to send bulk notifications.',
      details: error.message,
    }, 500)
  }
}
