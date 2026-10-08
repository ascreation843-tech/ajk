import { Context } from 'hono'
import prisma from '../../lib/prisma.js'
import { getCache, setCache, deleteCache } from '../../lib/redis.js'

const SETTINGS_ID = 'global'
const CACHE_KEY = 'app:settings'

export const getSettings = async (c: Context) => {
  try {
    // Try cache first
    const cached = await getCache(CACHE_KEY)
    if (cached) {
      return c.json({ success: true, data: cached, cached: true })
    }

    let settings = await (prisma as any).settings.findUnique({
      where: { id: SETTINGS_ID }
    })

    // Create default settings if not exists
    if (!settings) {
      settings = await (prisma as any).settings.create({
        data: {
          id: SETTINGS_ID,
          shopTitle: 'AJK Collective',
          shippingPolicy: '# Shipping Policy\n\nStandard delivery: 3-5 business days across AJK.',
          returnPolicy: '# Return Policy\n\n7-day return policy for unused items.',
          warrantyPolicy: '# Warranty Policy\n\n1-year limited warranty on premium electronics.'
        }
      })
    }

    await setCache(CACHE_KEY, settings, 3600)
    return c.json({ success: true, data: settings, cached: false })
  } catch (error) {
    console.error('Get Settings Error:', error)
    return c.json({ success: false, message: 'Failed to fetch settings' }, 500)
  }
}

export const updateSettings = async (c: Context) => {
  try {
    const body = await c.req.json()
    
    console.log('Prisma keys:', Object.keys(prisma).filter(k => !k.startsWith('_')));
    console.log('Prisma settings model:', (prisma as any).settings ? 'Defined' : 'Undefined');

    const settings = await (prisma as any).settings.upsert({
      where: { id: SETTINGS_ID },
      update: body,
      create: { ...body, id: SETTINGS_ID }
    })

    // Invalidate cache
    await deleteCache(CACHE_KEY)
    
    return c.json({ success: true, message: 'Settings updated successfully', data: settings })
  } catch (error) {
    console.error('Update Settings Error:', error)
    return c.json({ success: false, message: 'Failed to update settings' }, 500)
  }
}
