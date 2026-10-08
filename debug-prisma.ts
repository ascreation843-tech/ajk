import { PrismaClient } from '@prisma/client';
import pkg from 'pg';
const { Pool } = pkg;
import { PrismaPg } from '@prisma/adapter-pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function main() {
  console.log('--- Debugging Prisma Client models ---');
  
  const pool = new Pool({ 
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  console.log('Available models in Prisma Client:');
  const keys = Object.keys(prisma).filter(k => !k.startsWith('_') && !k.startsWith('$'));
  console.log(keys);
  
  if (keys.includes('notificationPreferences')) {
    console.log('SUCCESS: notificationPreferences found!');
  } else {
    console.log('FAILURE: notificationPreferences NOT found!');
  }

  try {
    console.log('Testing connection...');
    await prisma.$connect();
    console.log('Connected successfully!');
    
    const userCount = await prisma.user.count();
    console.log('User count:', userCount);
    
  } catch (error: any) {
    console.error('Connection/Query failed:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
