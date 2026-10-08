import { Context } from 'hono'
import prisma from '../../lib/prisma.js'
import { getCache, setCache, CACHE_TTL } from '../../lib/redis.js'

export const getDashboardStats = async (c: Context) => {
  try {
    const cacheKey = 'admin:dashboard:stats'
    const cachedData = await getCache(cacheKey)
    if (cachedData) {
      return c.json({ success: true, data: cachedData })
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(today.getDate() - 30);
    
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(today.getDate() - 7);

    // 1. Stats Calculation
    const [
      totalRevenueResult, 
      activeUsers, 
      newOrders,
      freelancerEarningsResult,
      liveProductsCount,
      cancelledOrdersCount,
      activeFreelancersCount,
    ] = await Promise.all([
      prisma.order.aggregate({
        _sum: { total: true },
        where: { status: 'DELIVERED' }
      }),
      prisma.user.count({
        where: { isActive: true }
      }),
      prisma.order.count({
        where: { createdAt: { gte: thirtyDaysAgo } }
      }),
      prisma.orderItem.aggregate({
        _sum: { freelancerEarning: true }
      }),
      prisma.product.count({
        where: { isApproved: true, isActive: true }
      }),
      prisma.order.count({
        where: { status: 'CANCELLED' }
      }),
      prisma.freelancer.count({
        where: { isSubscriptionActive: true }
      }),
    ]);

    const totalRevenue = totalRevenueResult._sum.total ? Number(totalRevenueResult._sum.total) : 0;
    const freelancerEarnings = freelancerEarningsResult._sum.freelancerEarning ? Number(freelancerEarningsResult._sum.freelancerEarning) : 0;
    
    // Calculate previous 30 days revenue for growth
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(today.getDate() - 60);

    const [currentMonthRevenueResult, previousMonthRevenueResult] = await Promise.all([
      prisma.order.aggregate({
        _sum: { total: true },
        where: { status: 'DELIVERED', createdAt: { gte: thirtyDaysAgo } }
      }),
      prisma.order.aggregate({
        _sum: { total: true },
        where: { status: 'DELIVERED', createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } }
      })
    ]);

    const currentRevenue = currentMonthRevenueResult._sum.total ? Number(currentMonthRevenueResult._sum.total) : 0;
    const previousRevenue = previousMonthRevenueResult._sum.total ? Number(previousMonthRevenueResult._sum.total) : 0;
    
    let growth = 0;
    if (previousRevenue > 0) {
       growth = ((currentRevenue - previousRevenue) / previousRevenue) * 100;
    } else if (currentRevenue > 0) {
       growth = 100; // 100% growth if previous was 0 and current is > 0
    }

    // 2. Chart Data (Last 7 Days Revenue)
    // To do this properly without complex raw SQL, we can fetch orders from last 7 days and group in memory
    const recentDeliveredOrders = await prisma.order.findMany({
        where: { status: 'DELIVERED', createdAt: { gte: sevenDaysAgo } },
        select: { total: true, createdAt: true }
    });

    const revenueMap = new Map();
    // Initialize last 7 days with 0
    for(let i=6; i>=0; i--) {
        const d = new Date();
        d.setDate(today.getDate() - i);
        revenueMap.set(d.toISOString().split('T')[0], 0);
    }

    recentDeliveredOrders.forEach((order: any) => {
        const dateStr = order.createdAt.toISOString().split('T')[0];
        if (revenueMap.has(dateStr)) {
            revenueMap.set(dateStr, revenueMap.get(dateStr) + Number(order.total));
        }
    });

    const chartData = Array.from(revenueMap, ([date, value]) => ({ value }));

    // 3. Low Stock Items
    const lowStockItems = await prisma.product.findMany({
      where: { stock: { lt: 10 } },
      select: { id: true, name: true, stock: true, category: true },
      orderBy: { stock: 'asc' },
      take: 5
    });

    // 4. Recent Activity (Orders)
    const recentOrders = await prisma.order.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: {
        user: { select: { name: true } }
      }
    });

    const formattedRecentOrders = recentOrders.map((order: any) => ({
      id: `#ORD-${order.id.slice(-4).toUpperCase()}`,
      customer: order.user?.name || 'Unknown',
      amount: `PKR ${Number(order.total).toLocaleString()}`,
      status: order.status.charAt(0) + order.status.slice(1).toLowerCase(),
      time: order.createdAt // The frontend can handle distance formatting
    }));

    const responseData = {
      stats: {
        totalRevenue: `PKR ${(totalRevenue / 1000000).toFixed(1)}M`,
        activeUsers: activeUsers.toLocaleString(),
        newOrders: newOrders.toString(),
        growth: `${growth > 0 ? '+' : ''}${growth.toFixed(1)}%`,
        freelancerEarnings: `PKR ${freelancerEarnings.toLocaleString()}`,
        liveProducts: liveProductsCount.toString(),
        cancelledOrders: cancelledOrdersCount.toString(),
        planTracking: {
          activeFreelancers: activeFreelancersCount,
        }
      },
      chartData: chartData.length > 0 ? chartData : [{value:0},{value:0},{value:0},{value:0},{value:0},{value:0},{value:0}],
      lowStockItems: lowStockItems.map(item => ({...item, category: item.category || 'General'})),
      recentOrders: formattedRecentOrders
    };

    // Cache the result for 5 minutes
    await setCache(cacheKey, responseData, 300);

    return c.json({
      success: true,
      data: responseData
    });

  } catch (error: any) {
    console.error('Error fetching dashboard stats:', error);
    return c.json({ success: false, message: 'Failed to fetch dashboard statistics' }, 500);
  }
}
