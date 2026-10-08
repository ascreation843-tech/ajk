import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

declare global {
  var prisma: PrismaClient | undefined;
}

let prismaInstance: PrismaClient | null = null;

function createPrismaClient(): PrismaClient {
  console.log('--- Creating fresh Prisma Client (Lazy) ---');
  
  const pool = new pg.Pool({ 
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  const adapter = new PrismaPg(pool);
  return new PrismaClient({ 
    adapter,
    log: ['warn', 'error']
  }) as unknown as PrismaClient;
}

/**
 * Robust Lazy Prisma Getter
 * This ensures the client is only created when first accessed,
 * preserving all prototype methods and bindings.
 */
const prismaProxy = new Proxy({} as PrismaClient, {
  get: (target, prop) => {
    if (!prismaInstance) {
      prismaInstance = createPrismaClient();
    }
    
    const value = (prismaInstance as any)[prop];
    if (typeof value === 'function') {
      return value.bind(prismaInstance);
    }
    return value;
  }
});

export default prismaProxy;
