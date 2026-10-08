import { Context } from 'hono';
import { WishlistService } from './wishlist.service.js';

export class WishlistController {
  static async getWishlist(c: Context) {
    const user = c.get('user') as any;
    try {
      const wishlist = await WishlistService.getWishlist(user.id);
      return c.json({
        success: true,
        data: wishlist
      });
    } catch (error: any) {
      return c.json({ success: false, message: error.message }, 500);
    }
  }

  static async toggleItem(c: Context) {
    const user = c.get('user') as any;
    const productId = c.req.param('productId');
    try {
      const result = await WishlistService.toggleItem(user.id, productId);
      return c.json({
        success: true,
        message: 'Wishlist updated',
        data: result
      });
    } catch (error: any) {
      return c.json({ success: false, message: error.message }, 500);
    }
  }

  static async removeItem(c: Context) {
    const user = c.get('user') as any;
    const productId = c.req.param('productId');
    try {
      await WishlistService.removeItem(user.id, productId);
      return c.json({
        success: true,
        message: 'Item removed from wishlist'
      });
    } catch (error: any) {
      return c.json({ success: false, message: error.message }, 500);
    }
  }
}
