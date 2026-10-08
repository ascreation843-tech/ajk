import { PrismaClient, Role } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import "dotenv/config"
import { hash } from 'bcryptjs'

const connectionString = process.env.DATABASE_URL

const pool = new pg.Pool({ 
  connectionString,
  ssl: {
    rejectUnauthorized: false
  }
})

const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('🌱 Starting database seed...')

  const adminEmail = process.env.ADMIN_EMAIL || 'admin@ajkshop.com'
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@123'
  const adminName = process.env.ADMIN_NAME || 'Anas Saleem'

  // Check if admin already exists
  const existingAdmin = await prisma.user.findFirst({
    where: { role: (Role as any).ADMIN }
  })

  if (existingAdmin) {
    console.log('Admin account already exists')
    return
  }

  const hashedPassword = await hash(adminPassword, 10)

  const admin = await prisma.user.create({
    data: {
      email: adminEmail,
      password: hashedPassword,
      name: adminName,
      role: (Role as any).ADMIN,
    }
  })

  console.log(`✅ Master Admin created: ${admin.email}`)
  console.log('💡 You can now log in to the admin panel with these credentials.')
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
