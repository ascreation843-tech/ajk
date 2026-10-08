import { Context } from 'hono'
import prisma from '../../lib/prisma.js'
import { getOptimizedUrl } from '../../lib/cloudinary.js'
import { getCache, setCache, CACHE_TTL } from '../../lib/redis.js'

export const getAllProducts = async (c: Context) => {
  try {
    const userBuffer = c.get('user') as any;
    const role = userBuffer?.role || 'GUEST'

    const q = c.req.query('q')?.trim()
    const categoryId = c.req.query('category')
    const page = Math.max(1, parseInt(c.req.query('page') || '1'))
    const limit = Math.max(1, Math.min(100, parseInt(c.req.query('limit') || '10')))
    const skip = (page - 1) * limit

    const cacheKey = `products:list:${role}:${q || 'all'}:${categoryId || 'all'}:${page}:${limit}`;

    const cachedData = await getCache(cacheKey);
    if (cachedData) {
      return c.json({
        ...(cachedData as any),
        cached: true,
      });
    }

    const where: any = { 
      isActive: true,
      isApproved: true 
    }

    if (categoryId && categoryId !== 'all') {
      const categoryTerms = categoryId.split('-').filter(t => t.length >= 3);
      where.AND = where.AND || [];
      where.AND.push({
        OR: [
          { category: { equals: categoryId, mode: 'insensitive' } },
          ...categoryTerms.map(term => ({
            category: { contains: term, mode: 'insensitive' }
          }))
        ]
      });
    }

    where.OR = [
      { freelancerId: null },
      { 
        freelancer: {
          isActive: true,
          isSubscriptionActive: true
        }
      }
    ]

    if (q) {
      const searchTerms = q.split(/\s+/).filter(term => term.length >= 2);
      if (searchTerms.length > 0) {
        where.AND = where.AND || [];
        searchTerms.forEach(term => {
          where.AND.push({
            OR: [
              { name: { contains: term, mode: 'insensitive' } },
              { description: { contains: term, mode: 'insensitive' } },
              { category: { contains: term, mode: 'insensitive' } }
            ]
          });
        });
      }
    }

    const [allProducts, total] = await Promise.all([
      prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { 
          freelancer: { select: { shopName: true } },
          reviews: { select: { rating: true } }
        }
      }),
      prisma.product.count({ where })
    ])

    const processedProducts = allProducts.map((p: any) => {
      let displayPrice = p.originalPrice
      if (p.discountPrice) {
        displayPrice = p.discountPrice
      }

      const reviews = p.reviews || []
      const totalReviews = reviews.length
      const averageRating = totalReviews > 0 
        ? reviews.reduce((acc: number, r: any) => acc + r.rating, 0) / totalReviews 
        : 0

      return {
        ...p,
        price: displayPrice,
        images: p.images?.map((url: string) => getOptimizedUrl(url)) || [],
        shopName: p.freelancer?.shopName || 'Saman Official',
        ratingSummary: {
          average: Number(averageRating.toFixed(1)),
          count: totalReviews
        }
      }
    })

    const response = { 
      success: true, 
      data: processedProducts,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      },
      cached: false,
    };

    // Cache the response to speed up subsequent identical searches
    const ttl = q ? CACHE_TTL.PRODUCT_LIST : (role === 'GUEST' ? CACHE_TTL.PRODUCT_LIST * 2 : CACHE_TTL.PRODUCT_LIST);
    await setCache(cacheKey, response, ttl);

    return c.json(response)
  } catch (error: any) {
    console.error('Error fetching products:', error)
    return c.json({ success: false, message: 'Failed to fetch products', details: error.message }, 500)
  }
}

export const getProductById = async (c: Context) => {
  try {
    const id = c.req.param('id')
    const user = c.get('user') as any
    const role = user?.role || 'GUEST'

    const cacheKey = `product:details:${id}:${role}`
    const cachedData = await getCache(cacheKey)
    if (cachedData) {
      return c.json({ ...(cachedData as any), cached: true })
    }

    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        freelancer: { 
          include: {
            user: {
              select: {
                name: true,
                avatar: true
              }
            }
          }
        },
        reviews: {
          where: { isActive: true },
          include: {
            user: { select: { name: true, avatar: true } }
          },
          orderBy: { createdAt: 'desc' },
          take: 10 
        }
      }
    })

    if (!product) {
      return c.json({ success: false, message: 'Product not found' }, 404)
    }

    let displayPrice = product.originalPrice
    if (product.discountPrice) {
      displayPrice = product.discountPrice
    }

    const reviews = (product as any).reviews || []
    const totalReviews = reviews.length
    const averageRating = totalReviews > 0 
      ? reviews.reduce((acc: number, r: any) => acc + r.rating, 0) / totalReviews 
      : 0

    const processedProduct = {
      ...product,
      price: displayPrice,
      images: product.images?.map((url: string) => getOptimizedUrl(url)) || [],
      ratingSummary: {
        average: Number(averageRating.toFixed(1)),
        count: totalReviews
      }
    }

    const response = { success: true, data: processedProduct, cached: false }
    await setCache(cacheKey, response, CACHE_TTL.PRODUCT_DETAILS)

    return c.json(response)
  } catch (error: any) {
    console.error(`Error fetching product ${c.req.param('id')}:`, error)
    return c.json({ success: false, message: 'Failed to fetch product details' }, 500)
  }
}

export const getCategories = async (c: Context) => {
  try {
    const cacheKey = 'products:categories'
    const cachedData = await getCache(cacheKey)
    if (cachedData) {
      return c.json({ data: cachedData, cached: true })
    }

    const categories = await prisma.product.groupBy({
      by: ['category'],
      _count: {
        _all: true
      },
      where: {
        isActive: true,
        isApproved: true
      }
    })

    const processedCategories = (categories as any[])
      .filter(cat => cat.category)
      .map(cat => ({
        id: cat.category,
        count: cat._count._all
      }))

    await setCache(cacheKey, processedCategories, CACHE_TTL.PRODUCT_LIST)
    return c.json({ success: true, data: processedCategories })
  } catch (error: any) {
    console.error('Error fetching categories:', error)
    return c.json({ success: false, message: 'Failed to fetch categories' }, 500)
  }
}
