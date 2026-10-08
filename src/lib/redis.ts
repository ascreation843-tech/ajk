import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';

let _redis: Redis | null = null;
let _initialized = false;
let _redisDisabledReason: string | null = null;

function errorChainText(error: unknown): string {
  if (!error || typeof error !== 'object') return String(error)
  const e = error as Error & { cause?: unknown }
  let s = e.message || String(error)
  let c: unknown = e.cause
  let depth = 0
  while (c && depth < 5) {
    if (c instanceof Error) {
      s += ` ${c.message} ${(c as NodeJS.ErrnoException).code || ''}`
      c = (c as Error & { cause?: unknown }).cause
    } else {
      s += ` ${String(c)}`
      break
    }
    depth++
  }
  return s
}

function isUnreachableRedisError(error: unknown): boolean {
  const text = errorChainText(error).toLowerCase()
  const code =
    (error as NodeJS.ErrnoException)?.code ||
    ((error as Error & { cause?: NodeJS.ErrnoException })?.cause as NodeJS.ErrnoException)?.code
  return (
    code === 'ENOTFOUND' ||
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    code === 'EAI_AGAIN' ||
    text.includes('enotfound') ||
    text.includes('econnrefused') ||
    text.includes('fetch failed') ||
    text.includes('network error') ||
    text.includes('getaddrinfo')
  )
}

function disableRedisForProcess(reason: string) {
  if (!_redisDisabledReason) {
    console.warn(
      `[Redis] Caching disabled for this process (${reason}). ` +
        'Fix UPSTASH_REDIS_REST_URL / token or network, then restart the server.',
    )
  }
  _redisDisabledReason = reason
  _redis = null
}

function getRedis() {
  if (_initialized) return _redis

  const disabled = process.env.REDIS_DISABLED?.toLowerCase()
  if (disabled === '1' || disabled === 'true' || disabled === 'yes') {
    console.warn('[Redis] Caching disabled (REDIS_DISABLED env).')
    _redisDisabledReason = 'REDIS_DISABLED'
    _initialized = true
    return null
  }

  try {
    const url = process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.UPSTASH_REDIS_REST_TOKEN

    if (url && token && !url.includes('-vector.')) {
      const customFetch = async (input: any, init?: any) => {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000);
          
          const response = await fetch(input, {
            ...init,
            signal: controller.signal
          });
          
          clearTimeout(timeoutId);
          return response;
        } catch (error: any) {
          if (error.name === 'AbortError') {
            throw new Error('Upstash connection timeout (10000ms)');
          }
          throw error;
        }
      };

      _redis = new Redis({
        url,
        token,
        enableAutoPipelining: false,
        fetch: customFetch as any,
      } as any)
      console.log('Redis client configured (Upstash REST); timeout set to 10s')
    }
  } catch (error) {
    console.error('Redis initialization failed:', error)
    _redisDisabledReason = 'Initialization Error'
  }

  _initialized = true
  return _redis
}

// Proxy to keep existing usage
const redisProxy = new Proxy({} as Redis, {
  get: (target, prop) => {
    const client = getRedis();
    if (!client) return undefined;
    const val = (client as any)[prop];
    return typeof val === 'function' ? val.bind(client) : val;
  }
});

/**
 * Get the underlying Redis client
 */
export function getRedisClient(): Redis | null {
  return getRedis();
}

// Cache TTL defaults (in seconds)
export const CACHE_TTL = {
  USER_PROFILE: 3600,     // 1 hour
  PRODUCT: 300,           // 5 minutes
  PRODUCT_DETAILS: 300,   // 5 minutes
  PRODUCT_LIST: 120,      // 2 minutes
  RATE_LIMIT: 900,        // 15 minutes
} as const;

/**
 * Get cached value
 */
export async function getCache<T>(key: string): Promise<T | null> {
  const redis = getRedis();
  if (!redis) return null;
  
  try {
    const value = await redis.get<T>(key);
    return value;
  } catch (error) {
    if (isUnreachableRedisError(error)) {
      console.warn(`[Redis] Cache unreachable for ${key}: ${errorChainText(error)}. Failing open...`)
    } else {
      console.error(`Cache get error for ${key}:`, error);
    }
    return null;
  }
}

/**
 * Set cache value with TTL
 */
export async function setCache(key: string, value: any, ttl: number): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  
  try {
    await redis.set(key, value, { ex: ttl });
  } catch (error) {
    if (isUnreachableRedisError(error)) {
        console.warn(`[Redis] Cache unreachable on set: ${errorChainText(error)}. Failing open...`)
    } else {
      console.error(`Cache set error for ${key}:`, error);
    }
  }
}

/**
 * Delete a single cache key
 */
export async function deleteCache(key: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  
  try {
    await redis.del(key);
  } catch (error) {
    if (isUnreachableRedisError(error)) {
      disableRedisForProcess('Upstash unreachable')
    } else {
      console.error(`Cache delete error for ${key}:`, error);
    }
  }
}

/**
 * Delete multiple cache keys matching a pattern
 */
export async function deleteCachePattern(pattern: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  
  try {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch (error) {
    if (isUnreachableRedisError(error)) {
      disableRedisForProcess('Upstash unreachable')
    } else {
      console.error(`Cache delete pattern error for ${pattern}:`, error);
    }
  }
}

/**
 * Invalidate all product-related caches (lists and specific details)
 */
export async function invalidateProductCache(productId?: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  try {
    // 1. Invalidate all paginated/filtered product lists
    await deleteCachePattern('products:list:*');
    
    // 2. Invalidate specific product details if ID provided
    if (productId) {
      await deleteCachePattern(`product:details:${productId}:*`);
    }
    
    console.log(`[Redis] Product cache invalidated ${productId ? `for ${productId}` : 'globally'}`);
  } catch (error) {
    console.error('[Redis] Failed to invalidate product cache:', error);
  }
}

/**
 * Rate limiting check (Legacy)
 * @deprecated Use the new rate-limiter middleware with @upstash/ratelimit
 */
export async function checkRateLimit(
  identifier: string,
  limit: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remaining: number }> {
  const redis = getRedis();
  if (!redis) return { allowed: true, remaining: limit };
  
  try {
    const key = `ratelimit:${identifier}`;
    const currentValue = await redis.get<number>(key);
    const current = currentValue ? parseInt(String(currentValue)) : 0;
    
    if (current >= limit) {
      console.log(`🚫 Rate limit exceeded for ${identifier}`);
      return { allowed: false, remaining: 0 };
    }
    
    const newCount = current + 1;
    await redis.set(key, newCount, { ex: windowSeconds });
    return { allowed: true, remaining: Math.max(0, limit - newCount) };
  } catch (error) {
    if (isUnreachableRedisError(error)) {
      disableRedisForProcess('Upstash unreachable')
    } else {
      console.error(`Rate limit check error for ${identifier}:`, error);
    }
    return { allowed: true, remaining: limit };
  }
}

export default redisProxy;
