import { initializeApp, cert, getApps, App } from 'firebase-admin/app'
import { getMessaging, MulticastMessage } from 'firebase-admin/messaging'
import prisma from './prisma.js'

let app: App | undefined

// Initialize Firebase Admin SDK
if (!getApps().length) {
  try {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    let rawKey = process.env.FIREBASE_PRIVATE_KEY || '';

    if (projectId && clientEmail && rawKey) {
      if ((rawKey.startsWith('"') && rawKey.endsWith('"')) || (rawKey.startsWith("'") && rawKey.endsWith("'"))) {
        rawKey = rawKey.substring(1, rawKey.length - 1);
      }
      const cleanPrivateKey = rawKey.replace(/\\n/g, '\n').trim();
      app = initializeApp({
        credential: cert({
          projectId,
          clientEmail,
          privateKey: cleanPrivateKey,
        }),
      })
      console.log('✅ Firebase Admin initialized successfully');
    } else {
      console.warn('⚠️ Firebase Admin credentials missing. Push notifications will be disabled.');
    }
  } catch (error: any) {
    console.error('❌ Firebase Admin initialization error:', error.message);
  }
} else {
  app = getApps()[0]
}

/**
 * Standard Notification Payload Structure
 */
export interface NotificationPayload {
  type: string;
  title: string;
  body: string;
  data?: Record<string, any>;
}

/**
 * Core function to send FCM notifications in batches of 500
 */
async function sendTokensInBatches(tokens: string[], title: string, body: string, data?: Record<string, any>) {
  if (!getApps().length || tokens.length === 0) {
    return { success: false, message: 'Service not configured or no tokens.' }
  }

  const messaging = getMessaging();
  const BATCH_SIZE = 500;
  
  // Sanitize data for FCM (all values must be strings)
  const sanitizedData: Record<string, string> = {};
  if (data) {
    Object.entries(data).forEach(([key, value]) => {
      sanitizedData[key] = String(value);
    });
  }

  for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
    const batch = tokens.slice(i, i + BATCH_SIZE);
    const message: MulticastMessage = {
      tokens: batch,
      notification: { title, body },
      data: sanitizedData,
      android: {
        priority: 'high',
        notification: {
          channelId: (data?.type?.toLowerCase().includes('order') ? 'orders_v1' : 
                     (data?.type?.toLowerCase().includes('product') || data?.type?.toLowerCase().includes('marketing') ? 'marketing_v1' : 'default_v1')),
          sound: 'default',
        },
      },
      apns: {
        payload: { 
          aps: { 
            contentAvailable: true, 
            sound: 'default'
          } 
        },
      },
    }

    try {
      const response = await messaging.sendEachForMulticast(message);
      
      // Cleanup invalid tokens
      const failedTokens: string[] = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const errorCode = resp.error?.code;
          if (errorCode === 'messaging/invalid-registration-token' || errorCode === 'messaging/registration-token-not-registered') {
            failedTokens.push(batch[idx]);
          }
        }
      });

      if (failedTokens.length > 0) {
        await (prisma as any).pushToken.updateMany({
          where: { token: { in: failedTokens } },
          data: { isActive: false },
        });
      }
    } catch (err: any) {
      console.error(`[NotificationService] Batch send failed:`, err.message);
    }
  }
}

/**
 * 1. Save notification to Database
 */
export async function createNotification(userId: string, payload: NotificationPayload) {
  try {
    return await (prisma as any).notification.create({
      data: {
        userId,
        type: payload.type,
        title: payload.title,
        body: payload.body,
        data: payload.data || {},
      }
    });
  } catch (error) {
    console.error('[NotificationService] Database persistence failed:', error);
    return null;
  }
}

/**
 * 2. Send Push Notification only
 */
export async function sendPushNotification(userId: string, payload: NotificationPayload) {
  try {
    const preferences = await (prisma as any).notificationPreferences.findUnique({
      where: { userId },
    });

    if (preferences && !preferences.pushEnabled) return { success: false, message: 'Disabled by user' };

    const tokens = await (prisma as any).pushToken.findMany({
      where: { userId, isActive: true },
      select: { token: true }
    });

    if (tokens.length === 0) return { success: false, message: 'No active tokens' };

    const registrationTokens = tokens.map((t: any) => t.token);
    await sendTokensInBatches(registrationTokens, payload.title, payload.body, payload.data);
    return { success: true };
  } catch (error: any) {
    console.error('[NotificationService] Push delivery failed:', error);
    return { success: false, message: error.message };
  }
}

/**
 * 3. Save + Send (Standard Flow)
 */
export async function createAndSend(userId: string, payload: NotificationPayload) {
  console.log(`[Notification] Processing ${payload.type} for user ${userId}`);
  
  // Always persist first
  await createNotification(userId, payload);
  
  // Then try to send push (awaiting ensures serverless execution context stays alive)
  try {
    await sendPushNotification(userId, payload);
  } catch (err: any) {
    console.error('[NotificationService] Async push failed:', err);
  }
}

/**
 * Bulk send to multiple users in parallel (optimized for serverless environments)
 */
export async function sendToUsers(userIds: string[], payload: NotificationPayload) {
  const promises = userIds.map(userId => createAndSend(userId, payload));
  await Promise.all(promises);
}

/**
 * Send to role
 */
export async function sendToRole(role: string, payload: NotificationPayload) {
  const users = await (prisma as any).user.findMany({
    where: { role: role as any, isActive: true },
    select: { id: true }
  });
  
  const userIds = users.map((u: any) => u.id);
  await sendToUsers(userIds, payload);
}

export async function broadcast(payload: NotificationPayload) {
  const users = await (prisma as any).user.findMany({
    where: {
      isActive: true,
      role: { not: 'ADMIN' }
    },
    select: { id: true }
  });
  
  const userIds = users.map((u: any) => u.id);
  await sendToUsers(userIds, payload);
}

export const notificationService = {
  createNotification,
  sendPushNotification,
  createAndSend,
  sendToUsers,
  sendToRole,
  broadcast
};
