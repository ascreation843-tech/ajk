import { Context } from 'hono';
import { CartService } from './cart.service.js';

export class CartController {
  static async getCart(c: Context) {
    const user = c.get('user') as any;
    try {
      const cart = await CartService.getCart(user.id);
      return c.json({
        success: true,
        data: cart
      });
    } catch (error: any) {
      return c.json({ success: false, message: error.message }, 500);
    }
  }

  static async syncCart(c: Context) {
    const user = c.get('user') as any;
    const { items } = await c.req.json();
    try {
      await CartService.syncCart(user.id, items);
      const updatedCart = await CartService.getCart(user.id);
      return c.json({
        success: true,
        message: 'Cart synced successfully',
        data: updatedCart
      });
    } catch (error: any) {
      return c.json({ success: false, message: error.message }, 500);
    }
  }

  static async updateItem(c: Context) {
    const user = c.get('user') as any;
    const productId = c.req.param('productId');
    const { quantity } = await c.req.json();
    try {
      await CartService.updateItem(user.id, productId, quantity);
      return c.json({
        success: true,
        message: 'Item updated'
      });
    } catch (error: any) {
      return c.json({ success: false, message: error.message }, 500);
    }
  }

  static async removeItem(c: Context) {
    const user = c.get('user') as any;
    const productId = c.req.param('productId');
    try {
      await CartService.removeItem(user.id, productId);
      return c.json({
        success: true,
        message: 'Item removed'
      });
    } catch (error: any) {
      return c.json({ success: false, message: error.message }, 500);
    }
  }
}
