import 'dotenv/config';
import prisma from '../lib/prisma.js';

async function migrate() {
  console.log('--- Media ID Migration Started ---');

  const extractPublicId = (url: string | null | undefined): string | null => {
    if (!url || typeof url !== 'string') return null;
    if (!url.includes('cloudinary.com')) return null;
    const regex = /\/upload\/(?:v\d+\/)?(.+?)(?:\.[^.]+)?$/;
    const match = url.match(regex);
    if (match && match[1]) {
      return match[1];
    }
    return null;
  };

  try {
    // 1. Migrate Users (Avatars)
    const users = await prisma.user.findMany({
      where: { 
        avatar: { not: null }, 
        avatarPublicId: null 
      }
    });
    console.log(`[User] Found ${users.length} pending records.`);
    for (const user of users) {
      const publicId = extractPublicId(user.avatar);
      if (publicId) {
        await prisma.user.update({
          where: { id: user.id },
          data: { avatarPublicId: publicId }
        });
      }
    }

    // 2. Migrate Products
    const products = await prisma.product.findMany({
      where: { 
        images: { isEmpty: false } as any, 
        imagePublicIds: { equals: [] } as any 
      }
    });
    console.log(`[Product] Found ${products.length} pending records.`);
    for (const product of products) {
      const publicIds = product.images.map(extractPublicId).filter((id): id is string => !!id);
      if (publicIds.length > 0) {
        await prisma.product.update({
          where: { id: product.id },
          data: { imagePublicIds: publicIds }
        });
      }
    }

    // 3. Migrate Reviews
    const reviews = await prisma.review.findMany({
      where: {
        images: { isEmpty: false } as any,
        imagePublicIds: { equals: [] } as any
      }
    });
    console.log(`[Review] Found ${reviews.length} pending records.`);
    for (const review of reviews) {
      const publicIds = review.images.map(extractPublicId).filter((id): id is string => !!id);
      if (publicIds.length > 0) {
        await prisma.review.update({
          where: { id: review.id },
          data: { imagePublicIds: publicIds }
        });
      }
    }

    // 4. Migrate Order Items (Payment Proofs)
    const items = await prisma.orderItem.findMany({
      where: { 
        paymentProofUrl: { not: null }, 
        paymentProofPublicId: null 
      }
    });
    console.log(`[OrderItem] Found ${items.length} pending records.`);
    for (const item of items) {
      const publicId = extractPublicId(item.paymentProofUrl);
      if (publicId) {
        await prisma.orderItem.update({
          where: { id: item.id },
          data: { paymentProofPublicId: publicId }
        });
      }
    }

    console.log('--- Media ID Migration Completed Successfully ---');
  } catch (error) {
    console.error('Migration failed with error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

migrate();
