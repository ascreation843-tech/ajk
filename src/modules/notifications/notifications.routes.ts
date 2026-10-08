import { Hono } from 'hono'
import * as notificationsController from './notifications.controller.js'
import { authMiddleware } from '../../middlewares/auth.js'

const notificationRoutes = new Hono()

// Public test route
notificationRoutes.get('/ping', (c) => c.json({ success: true, message: 'Notification routes are reachable' }))

// Apply auth middleware to all other notification routes
notificationRoutes.use('/*', authMiddleware)

notificationRoutes.get('/', notificationsController.getNotifications)
notificationRoutes.patch('/:id/read', notificationsController.markAsRead)
notificationRoutes.patch('/read-all', notificationsController.markAllAsRead)
notificationRoutes.get('/preferences', notificationsController.getPreferences)
notificationRoutes.put('/preferences', notificationsController.updatePreferences)
notificationRoutes.post('/register-token', notificationsController.registerToken)
notificationRoutes.delete('/unregister-token', notificationsController.unregisterToken)
notificationRoutes.delete('/', notificationsController.deleteAll)
notificationRoutes.post('/test-push', notificationsController.testPush)

export default notificationRoutes
