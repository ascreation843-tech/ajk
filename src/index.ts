
import 'dotenv/config'
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import authRoutes from "./modules/auth/auth.routes.js";
import productRoutes from "./modules/products/products.routes.js";
import orderRoutes from "./modules/orders/orders.routes.js";
import notificationRoutes from "./modules/notifications/notifications.routes.js";
import userRoutes from "./modules/user/user.routes.js";
import adminRoutes from "./modules/admin/admin.routes.js";
import freelancerRoutes from "./modules/freelancer/freelancer.routes.js";
import cartRoutes from "./modules/cart/cart.routes.js";
import wishlistRoutes from "./modules/wishlist/wishlist.routes.js";
import reviewsRoutes from "./modules/reviews/reviews.routes.js";
import settingsRoutes from "./modules/settings/settings.routes.js";
import { uploadRoutes } from "./modules/upload/upload.routes.js";
import { getFreelancerReviews } from "./modules/freelancer/freelancer.controller.js";
import { authMiddleware, roleMiddleware } from "./middlewares/auth.js";
import { generalRateLimiter, authRateLimiter, wishlistRateLimiter } from "./middlewares/rate-limiter.js";

const app = new Hono();

// Health check route - Moved to top for diagnostic reliability
app.get("/api/health", (c) => {
  return c.json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    message: "AJK SHOP Backend is running smoothly"
  });
});

app.use("*", secureHeaders());
app.use("*", logger());

// Hardened CORS for iOS/TestFlight support
app.use("*", cors({
  origin: (origin) => origin || "*",
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept"],
  exposeHeaders: ["Content-Length", "X-JSON"],
  credentials: true,
}));

// Temporarily disabling rate limiters to diagnose connection issues
// app.use("*", generalRateLimiter);

if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
  console.warn(
    '[Email] OTP email is disabled. Add RESEND_API_KEY and RESEND_FROM_EMAIL in backend/.env'
  )
}

app.onError((err, c) => {
  console.error("Global Error:", err);
  const status = 'status' in err && typeof err.status === 'number' ? err.status : 500;
  return c.json(
    {
      success: false,
      message: err.message || "Internal Server Error",
      error: process.env.NODE_ENV === "development" ? err.stack : undefined,
    },
    status as any,
  );
});

app.get("/api/reviews/test", (c) => c.json({ success: true, message: "Review system is reachable" }));


// API Routes - Rate limiters disabled for testing
app.use("/auth/*", authRateLimiter);
app.use("/wishlist/*", wishlistRateLimiter);


app.route("/auth", authRoutes);
app.route("/products", productRoutes);
app.route("/orders", orderRoutes);
app.route("/notifications", notificationRoutes);
app.route("/user", userRoutes);
app.route("/admin", adminRoutes);
app.route("/freelancer", freelancerRoutes);
app.route("/cart", cartRoutes);
app.route("/wishlist", wishlistRoutes);
app.route("/reviews", reviewsRoutes);
app.route("/settings", settingsRoutes);
app.route("/upload", uploadRoutes);

// Direct mounting for reliability
app.get("/freelancer/reviews", authMiddleware, roleMiddleware(['FREELANCER', 'BUSINESS_PARTNER']), getFreelancerReviews);

// 404 Handler (MUST be after all routes)
app.notFound((c) => {
  return c.json({ success: false, message: "Route not found" }, 404);
});

// Export for Vercel/Serverless support if needed
export default app;

// Production Server (Hostinger/Node.js Hosting)
const port = Number(process.env.PORT) || 3000;

if (!process.env.VERCEL) {
  console.log(` Server starting on port ${port}`);

  serve({
    fetch: app.fetch,
    port,
    hostname: '0.0.0.0',
  });
}
