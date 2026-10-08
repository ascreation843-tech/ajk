import { Context } from 'hono';
import { generateSignature, ALLOWED_FOLDERS, FolderType } from '../../lib/cloudinary.js';

export class UploadController {
  /**
   * Generates a signed signature for direct Cloudinary uploads.
   * This allows the client to upload directly to Cloudinary without
   * the backend ever seeing the image bytes.
   */
  static async getSignature(c: Context) {
    try {
      const type = c.req.query('type');

      if (!type || !Object.keys(ALLOWED_FOLDERS).includes(type)) {
        return c.json({ 
          success: false, 
          message: `Invalid upload type. Allowed types: ${Object.keys(ALLOWED_FOLDERS).join(', ')}` 
        }, 400);
      }

      const folder = ALLOWED_FOLDERS[type as FolderType];
      const timestamp = Math.round(new Date().getTime() / 1000);
      
      /**
       * Params required by Cloudinary for a signed upload.
       * IMPORTANT: The client must send exactly these parameters 
       * along with the signature for the upload to succeed.
       */
      const paramsToSign = {
        timestamp,
        folder,
      };

      const signature = generateSignature(paramsToSign);

      return c.json({
        success: true,
        data: {
          signature,
          timestamp,
          folder,
          api_key: process.env.CLOUDINARY_API_KEY,
          cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        },
      });
    } catch (error: any) {
      console.error('[UploadController] Signature generation failed:', error);
      return c.json({ success: false, message: 'Failed to generate upload signature' }, 500);
    }
  }
}
