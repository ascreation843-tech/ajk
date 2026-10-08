import { Hono } from 'hono'
import { getSettings, updateSettings } from './settings.controller.js'
import { authMiddleware, roleMiddleware } from '../../middlewares/auth.js'

const router = new Hono()

// Public endpoint to get shop configuration
router.get('/', getSettings)

// Admin only: Update global settings
router.patch('/', authMiddleware, roleMiddleware(['ADMIN']), updateSettings)

export default router
