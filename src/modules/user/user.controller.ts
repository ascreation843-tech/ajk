import { Context } from 'hono';
import { UserService } from './user.service.js';
import cloudinary, { getOptimizedUrl } from '../../lib/cloudinary.js';
import { getCache, setCache, deleteCache, CACHE_TTL } from '../../lib/redis.js';
import fs from 'fs';
import path from 'path';

import os from 'os';
const UPLOADS_DIR = os.tmpdir();

export class UserController {
  static async getProfile(c: Context) {
    const user = c.get('user') as any;
    const cacheKey = `user:profile:${user.id}`;
    const cachedProfile = await getCache(cacheKey);
    if (cachedProfile) {
      return c.json({
        success: true,
        data: { user: cachedProfile },
        cached: true,
      });
    }

    const profile = await UserService.getProfile(user.id);
    await setCache(cacheKey, profile, CACHE_TTL.USER_PROFILE);

    return c.json({
      success: true,
      data: { user: profile },
      cached: false,
    });
  }

  static async updateProfile(c: Context) {
    const user = c.get('user') as any;
    const body = await c.req.json();

    const updatedUser = await UserService.updateProfile(user.id, body);

    const cacheKey = `user:profile:${user.id}`;
    await deleteCache(cacheKey);

    return c.json({
      success: true,
      message: 'Profile updated successfully',
      data: { user: updatedUser },
    });
  }

  static async deleteAccount(c: Context) {
    try {
      const user = c.get('user') as any;
      
      // 1. Delete from database
      await UserService.deleteAccount(user.id);

      // 2. Invalidate cache
      const cacheKey = `user:profile:${user.id}`;
      await deleteCache(cacheKey);

      return c.json({
        success: true,
        message: 'Account deleted successfully'
      });
    } catch (error: any) {
      console.error('Account deletion error:', error);
      return c.json({ success: false, message: 'Failed to delete account' }, 500);
    }
  }
}
