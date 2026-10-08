import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

function createPrismaClient() {
  const pool = new pg.Pool({ 
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

const prisma = createPrismaClient();

async function main() {
  console.log('--- Checking Notification Data ---');
  
  try {
    const users = await prisma.user.findMany({
      select: { id: true, name: true, email: true }
    });
    console.log('Users in DB:', users.map(u => ({ id: u.id, name: u.name })));
    
    const prefs = await (prisma as any).notificationPreferences.findMany();
    console.log('Preferences:', prefs.map((p: any) => ({ userId: p.userId, newProducts: p.newProducts, pushEnabled: p.pushEnabled })));
    
    const tokens = await (prisma as any).pushToken.findMany({
      where: { isActive: true }
    });
    console.log('Active Tokens:', tokens.map((t: any) => ({ userId: t.userId, platform: t.platform })));

    // Find intersection
    const subscribedUserIds = prefs
      .filter((p: any) => p.newProducts && p.pushEnabled)
      .map((p: any) => p.userId);
      
    console.log('User IDs subscribed to "newProducts":', subscribedUserIds);
    
    const targetUsers = subscribedUserIds.filter((id: string) => tokens.some((t: any) => t.userId === id));
    console.log('Users who SHOULD receive notifications (Subscribed + Active Token):', targetUsers);

  } catch (error: any) {
    console.error('Error during diagnostics:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
