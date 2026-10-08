import { Context, Next } from 'hono';
import { Ratelimit } from '@upstash/ratelimit';
import { getRedisClient } from '../lib/redis.js';

interface RateLimiterOptions {
  limit: number;
  window: `${number} s` | `${number} m` | `${number} h` | `${number} d`;
  message?: string;
  prefix?: string;
}

let ratelimitInstances: Record<string, Ratelimit> = {};

export function createRateLimiter(options: RateLimiterOptions) {
  const { limit, window, message = 'Too many requests. Please try again later.', prefix = 'ratelimit' } = options;

  return async (c: Context, next: Next) => {
    const redis = getRedisClient();
    if (!redis) {
      // If redis is disabled, allow the request
      return await next();
    }

    // Lazy initialization of Ratelimit instance
    const instanceKey = `${prefix}:${limit}:${window}`;
    if (!ratelimitInstances[instanceKey]) {
      ratelimitInstances[instanceKey] = new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(limit, window as any),
        analytics: true,
        prefix: `@upstash/ratelimit/${prefix}`,
      });
    }

    const ratelimit = ratelimitInstances[instanceKey];
    
    // Use IP or User ID as identifier
    const ip = c.req.header('x-forwarded-for') || 
               c.req.header('x-real-ip') || 
               'anonymous';
    
    // If user is authenticated, use their ID for more accurate limiting
    const user = (c as any).var?.user;
    const identifier = user?.id || ip.split(',')[0].trim();

    try {
      const { success, limit: totalLimit, remaining, reset } = await ratelimit.limit(identifier);

      c.header('X-RateLimit-Limit', totalLimit.toString());
      c.header('X-RateLimit-Remaining', remaining.toString());
      c.header('X-RateLimit-Reset', reset.toString());

      if (!success) {
        const waitSeconds = Math.ceil((reset - Date.now()) / 1000);
        let finalMessage = message;
        
        if (waitSeconds > 0) {
          if (message.endsWith('.')) {
            finalMessage = `${message.slice(0, -1)}: please try again in ${waitSeconds} seconds.`;
          } else {
            finalMessage = `${message}: please try again in ${waitSeconds} seconds.`;
          }
        }

        console.log(`🚫 Rate limit exceeded for ${identifier} on ${c.req.path}. Wait: ${waitSeconds}s`);
        return c.json(
          {
            success: false,
            message: finalMessage,
            retryAfterSeconds: waitSeconds,
          },
          429
        );
      }
    } catch (error) {
      console.error('Rate limit error (fail-open):', error);
    }

    await next();
  };
}

/**
 * Strict limiter for authentication routes
 */
export const authRateLimiter = createRateLimiter({
  limit: 5,
  window: '15 m',
  message: 'Too many login attempts',
  prefix: 'auth',
});

/**
 * General limiter for all other API endpoints
 */
export const generalRateLimiter = createRateLimiter({
  limit: 100,
  window: '15 m',
  message: 'Daily request limit reached',
  prefix: 'general',
});

/**
 * Rate limiter for wishlist/favourite API
 * 4 requests per 2 minutes per user
 */
export const wishlistRateLimiter = createRateLimiter({
  limit: 4,
  window: '2 m',
  message: 'Wishlist limit reached (max 4 requests per 2 minutes)',
  prefix: 'wishlist',
});
