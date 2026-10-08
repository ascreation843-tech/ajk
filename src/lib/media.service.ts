import { v2 as cloudinary } from 'cloudinary';

// Configure cloudinary (assuming it's already configured in cloudinary.ts, 
// but we'll use the same config to ensure consistency)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export class MediaService {
  /**
   * Deletes a single image from Cloudinary by its public_id.
   * Idempotent: Does not throw if the image is already deleted.
   */
  static async deleteImage(publicId: string | null | undefined): Promise<boolean> {
    if (!publicId) return false;

    try {
      const result = await cloudinary.uploader.destroy(publicId);
      if (result.result === 'ok' || result.result === 'not found') {
        console.log(`[MediaService] Purged: ${publicId}`);
        return true;
      }
      console.warn(`[MediaService] Delete failed for ${publicId}:`, result);
      return false;
    } catch (error) {
      console.error(`[MediaService] Exception during delete for ${publicId}:`, error);
      // Implement retry logic or queue here if needed
      return false;
    }
  }

  /**
   * Deletes multiple images from Cloudinary.
   */
  static async deleteMany(publicIds: (string | null | undefined)[]): Promise<void> {
    const validIds = publicIds.filter((id): id is string => !!id);
    if (validIds.length === 0) return;

    try {
      // Cloudinary supports batch deletion up to 100 resources
      const result = await cloudinary.api.delete_resources(validIds);
      console.log(`[MediaService] Batch delete results:`, result.deleted);
    } catch (error) {
      console.error(`[MediaService] Batch delete failed:`, error);
      // Fallback to individual deletes if batch fails
      await Promise.all(validIds.map(id => this.deleteImage(id)));
    }
  }

  /**
   * Handles image synchronization during an update.
   * Compares old and new public IDs and deletes those no longer needed.
   */
  static async syncImages(oldIds: string[], newIds: string[]): Promise<void> {
    const idsToDelete = oldIds.filter(id => !newIds.includes(id));
    if (idsToDelete.length > 0) {
      await this.deleteMany(idsToDelete);
    }
  }
}
