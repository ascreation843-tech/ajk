
import 'dotenv/config';
import { PrismaClient, Role } from '@prisma/client';

import prisma from '../lib/prisma.js';

async function migrateFreelancers() {
  console.log('Starting migration from BUSINESS_PARTNER to FREELANCER...');

  // 1. Find all users with BUSINESS_PARTNER role (or those with shopName set who are generic users)
  // Note: Since we updated the enum in schema but maybe not in DB data yet if we used db push, 
  // we might need to cast or handle carefully. 
  // However, Prisma client uses the generated types.
  
  // existing users might still have 'BUSINESS_PARTNER' string in the DB column even if Prisma type expects 'FREELANCER' or 'BUSINESS_PARTNER'.
  // Since we kept BUSINESS_PARTNER in the enum, this findMany should work.
  const partners = await prisma.user.findMany({
    where: {
      role: 'BUSINESS_PARTNER' as Role // Explicit cast if types are strictly checking against new enum
    }
  });

  console.log(`Found ${partners.length} partners to migrate.`);

  let migratedCount = 0;
  let errorCount = 0;

  for (const partner of partners) {
    try {
      // Check if freelancer profile already exists
      const existingProfile = await prisma.freelancer.findUnique({
        where: { userId: partner.id }
      });

      if (existingProfile) {
        console.log(`Skipping user ${partner.email} (Profile already exists)`);
        continue;
      }

      // Create Freelancer profile
      await prisma.freelancer.create({
        data: {
          userId: partner.id,
          // Map legacy fields
          shopName: partner.shopName || `Shop-${partner.id.slice(0, 8)}`,
          phone: partner.phone,
          region: partner.region,
          
          // Set defaults for new system
          isActive: partner.isActive,
          isSubscriptionActive: true,
        }
      });

      // Update User role to FREELANCER
      await prisma.user.update({
        where: { id: partner.id },
        data: { role: 'FREELANCER' as Role }
      });

      console.log(`Migrated user ${partner.email}`);
      migratedCount++;
    } catch (error) {
      console.error(`Failed to migrate user ${partner.email}:`, error);
      errorCount++;
    }
  }

  console.log('Migration finished.');
  console.log(`Success: ${migratedCount}`);
  console.log(`Errors: ${errorCount}`);
}

migrateFreelancers()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
