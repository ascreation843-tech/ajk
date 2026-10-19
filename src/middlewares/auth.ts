import { Context, Next } from 'hono'
import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'

export const authMiddleware = async (c: Context, next: Next) => {
  const authHeader = c.req.header('Authorization')
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.warn(`[AuthMiddleware] Missing or malformed Authorization header on ${c.req.method} ${c.req.path}`)
    return c.json({ success: false, message: 'Unauthorized: No token provided' }, 401)
  }

  const token = authHeader.split(' ')[1]
  if (!token || token === 'null' || token === 'undefined') {
    console.warn(`[AuthMiddleware] Empty or placeholder token on ${c.req.method} ${c.req.path}`)
    return c.json({ success: false, message: 'Unauthorized: No token provided' }, 401)
  }

  let decoded: any
  try {
    decoded = jwt.verify(token, JWT_SECRET)
  } catch (jwtError: any) {
    const errorType = jwtError?.name || 'JsonWebTokenError'
    console.warn(`[AuthMiddleware] JWT verification failed (${errorType}) on ${c.req.method} ${c.req.path}`)
    return c.json({ 
      success: false, 
      message: 'Unauthorized: Invalid or expired token',
      errorType 
    }, 401)
  }

  try {
    const { getCache, setCache } = await import('../lib/redis.js')
    const userId = decoded.id || decoded.userId
    
    let isActive: any = null
    try {
      isActive = await getCache(`user:status:${userId}`)
    } catch (cacheErr: any) {
      console.warn(`[AuthMiddleware] Cache lookup warning:`, cacheErr?.message || cacheErr)
      isActive = null
    }
    
    if (isActive === null) {
      const { default: prisma } = await import('../lib/prisma.js')
      const user = await prisma.user.findUnique({ 
        where: { id: userId },
        select: { isActive: true }
      }) as any
      
      if (!user) {
        return c.json({ success: false, message: 'Account not found.' }, 403)
      }
      
      isActive = user.isActive
      try {
        await setCache(`user:status:${userId}`, isActive, 3600)
      } catch (cacheSetErr: any) {
        console.warn(`[AuthMiddleware] Cache set warning:`, cacheSetErr?.message || cacheSetErr)
      }
    }

    if (isActive === false || isActive === 'false') {
      return c.json({ 
        success: false, 
        message: 'Forbidden: Your account is suspended. Access denied.' 
      }, 403)
    }

    c.set('user', decoded)
    await next()
  } catch (dbError: any) {
    console.error(`[AuthMiddleware] Infrastructure error verifying user status on ${c.req.method} ${c.req.path}:`, dbError?.message || dbError)
    return c.json({ 
      success: false, 
      message: 'Internal server error: Unable to verify account status' 
    }, 500)
  }
}

export const optionalAuthMiddleware = async (c: Context, next: Next) => {
  const authHeader = c.req.header('Authorization')
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return await next()
  }

  const token = authHeader.split(' ')[1]

  try {
    const decoded: any = jwt.verify(token, JWT_SECRET)
    
    const { getCache, setCache } = await import('../lib/redis.js')
    const userId = decoded.id || decoded.userId
    
    let isActive = await getCache(`user:status:${userId}`)
    
    if (isActive === null) {
      const { default: prisma } = await import('../lib/prisma.js')
      const user = await prisma.user.findUnique({ 
        where: { id: userId },
        select: { isActive: true }
      }) as any
      
      if (!user) {
        return await next()
      }
      
      isActive = user.isActive
      await setCache(`user:status:${userId}`, isActive, 3600)
    }

    if (isActive === false || isActive === 'false') {
      return c.json({ 
        success: false, 
        message: 'Forbidden: Your account is suspended. Access denied.' 
      }, 403)
    }

    c.set('user', decoded)
    await next()
  } catch (error) {
    // If token is invalid, treat as guest
    return await next()
  }
}

export const roleMiddleware = (allowedRoles: string[]) => {
  return async (c: Context, next: Next) => {
    const user = c.get('user')
    
    if (!user || !allowedRoles.includes(user.role)) {
      return c.json({ success: false, message: 'Forbidden: Insufficient permissions' }, 403)
    }
    
    await next()
  }
}
