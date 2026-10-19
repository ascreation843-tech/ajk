import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

declare global {
  var prisma: PrismaClient | undefined;
}

let prismaInstance: PrismaClient | null = null;

function createPrismaClient(): PrismaClient {
  console.log('--- Creating fresh Prisma Client (Lazy) ---');

  if (!process.env.DATABASE_URL) {
    console.error('CRITICAL: DATABASE_URL is missing in environment variables!');
    throw new Error('DATABASE_URL is not set in environment variables');
  }

  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
    max: 5,
  });

  const adapter = new PrismaPg(pool);
  return new PrismaClient({
    adapter,
    log: ['warn', 'error']
  }) as unknown as PrismaClient;
}

function getPrismaClient(): PrismaClient {
  if (globalThis.prisma) {
    return globalThis.prisma;
  }
  if (!prismaInstance) {
    prismaInstance = createPrismaClient();
    if (process.env.NODE_ENV !== 'production' || process.env.VERCEL) {
      globalThis.prisma = prismaInstance;
    }
  }
  return prismaInstance;
}

/**
 * Robust Lazy Prisma Getter
 * This ensures the client is only created when first accessed,
 * preserving all prototype methods and bindings.
 */
const prismaProxy = new Proxy({} as PrismaClient, {
  get: (target, prop) => {
    const instance = getPrismaClient();

    const value = (instance as any)[prop];
    if (typeof value === 'function') {
      return value.bind(instance);
    }
    return value;
  }
});

export default prismaProxy;
