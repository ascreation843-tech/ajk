import { Context } from 'hono'
import prisma from '../../lib/prisma.js'

export const getNotifications = async (c: Context) => {
  try {
    const user = c.get('user') as any
    const notifications = await (prisma as any).notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 50 // Keep it snappy
    })
    return c.json({ success: true, data: notifications })
  } catch (error: any) {
    console.error('[NotificationController] Fetch error:', error)
    return c.json({ success: false, message: 'Failed to fetch notifications' }, 500)
  }
}

export const markAsRead = async (c: Context) => {
  try {
    const user = c.get('user') as any
    const id = c.req.param('id')
    
    await (prisma as any).notification.update({
      where: { id, userId: user.id },
      data: { isRead: true }
    })
    
    return c.json({ success: true, message: 'Notification marked as read' })
  } catch (error: any) {
    console.error('[NotificationController] Update error:', error)
    return c.json({ success: false, message: 'Failed to update notification' }, 500)
  }
}

export const markAllAsRead = async (c: Context) => {
  try {
    const user = c.get('user') as any
    
    await (prisma as any).notification.updateMany({
      where: { userId: user.id, isRead: false },
      data: { isRead: true }
    })
    
    return c.json({ success: true, message: 'All notifications marked as read' })
  } catch (error: any) {
    console.error('[NotificationController] Update all error:', error)
    return c.json({ success: false, message: 'Failed to update notifications' }, 500)
  }
}

export const deleteAll = async (c: Context) => {
  try {
    const user = c.get('user') as any
    
    await (prisma as any).notification.deleteMany({
      where: { userId: user.id }
    })
    
    return c.json({ success: true, message: 'All notifications deleted' })
  } catch (error: any) {
    console.error('[NotificationController] Delete all error:', error)
    return c.json({ success: false, message: 'Failed to delete notifications' }, 500)
  }
}

export const getPreferences = async (c: Context) => {
  try {
    const user = c.get('user') as any
    const profile = await prisma.user.findUnique({
      where: { id: user.id },
      select: { notificationPreferences: true }
    })
    return c.json({ success: true, data: profile?.notificationPreferences || {} })
  } catch (error: any) {
    return c.json({ success: false, message: 'Failed to fetch preferences' }, 500)
  }
}

export const updatePreferences = async (c: Context) => {
  try {
    const user = c.get('user') as any
    const body = await c.req.json()
    
    // Use upsert to handle both creation and update of the relation
    await (prisma as any).notificationPreferences.upsert({
      where: { userId: user.id },
      update: body,
      create: { ...body, userId: user.id }
    })
    
    return c.json({ success: true, message: 'Preferences updated' })
  } catch (error: any) {
    console.error('[NotificationController] Update preferences error:', error)
    return c.json({ success: false, message: 'Failed to update preferences' }, 500)
  }
}

export const registerToken = async (c: Context) => {
  try {
    const user = c.get('user') as any
    const { token, platform } = await c.req.json()
    
    if (!token) return c.json({ success: false, message: 'Token is required' }, 400)

    await (prisma as any).pushToken.upsert({
      where: { token },
      update: { userId: user.id, platform, isActive: true, updatedAt: new Date() },
      create: { userId: user.id, token, platform, isActive: true }
    })

    return c.json({ success: true, message: 'Token registered successfully' })
  } catch (error: any) {
    console.error('[NotificationController] Register token error:', error)
    return c.json({ success: false, message: 'Failed to register token' }, 500)
  }
}

export const unregisterToken = async (c: Context) => {
  try {
    const { token } = await c.req.json()
    if (!token) return c.json({ success: false, message: 'Token is required' }, 400)

    await (prisma as any).pushToken.update({
      where: { token },
      data: { isActive: false }
    })

    return c.json({ success: true, message: 'Token unregistered successfully' })
  } catch (error: any) {
    return c.json({ success: false, message: 'Failed to unregister token' }, 500)
  }
}

export const testPush = async (c: Context) => {
  try {
    const user = c.get('user') as any
    const { notificationService } = await import('../../lib/notification.service.js')
    
    const result = await notificationService.createAndSend(user.id, {
      type: 'TEST_PUSH',
      title: 'Test Notification 🔔',
      body: 'If you see this, your notification system is working perfectly!',
      data: { test: 'true', timestamp: new Date().toISOString() }
    })

    return c.json({ 
      success: true, 
      message: 'Test notification sent',
      data: {
        success: true,
        successCount: (result as any)?.successCount || 1,
        userId: user.id
      }
    })
  } catch (error: any) {
    console.error('[NotificationController] Test push error:', error)
    return c.json({ 
      success: false, 
      message: 'Failed to send test notification', 
      data: { success: false, message: error.message, userId: (c.get('user') as any)?.id }
    }, 500)
  }
}
