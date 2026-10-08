import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export const ALLOWED_FOLDERS = {
  avatar: 'avatars',
  product: 'products',
  freelancer_product: 'freelancer_products',
  receipt: 'payment_proofs',
} as const;

export type FolderType = keyof typeof ALLOWED_FOLDERS;

/**
 * Generates a signature for Cloudinary direct uploads.
 */
export const generateSignature = (paramsToSign: Record<string, any>) => {
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!apiSecret) throw new Error('CLOUDINARY_API_SECRET is not defined');
  
  return cloudinary.utils.api_sign_request(paramsToSign, apiSecret);
};

export const getOptimizedUrl = (url: string, width?: number) => {
  if (!url || !url.includes('cloudinary.com')) return url;
  
  // Standard transformation string
  const baseTransform = 'f_auto,q_auto';
  const widthTransform = width ? `,w_${width}` : '';
  const fullTransform = `${baseTransform}${widthTransform}`;

  // If already transformed with these exact params, return as is
  if (url.includes(fullTransform)) return url;

  // Find the /upload/ segment and insert or replace transformation
  const uploadSegment = '/upload/';
  const uploadIndex = url.indexOf(uploadSegment);
  
  if (uploadIndex === -1) return url;

  const baseUrl = url.substring(0, uploadIndex + uploadSegment.length);
  const remainingUrl = url.substring(uploadIndex + uploadSegment.length);

  // Check if there's already a transformation segment (doesn't start with 'v' followed by numbers which is the version)
  const segments = remainingUrl.split('/');
  const firstSegment = segments[0];
  
  // Pattern to detect if first segment is a transformation or a version tag (vNNNNN)
  const isVersion = /^v\d+$/.test(firstSegment);
  
  if (isVersion || firstSegment.includes('.')) {
    // No transformation segment, just insert ours
    return `${baseUrl}${fullTransform}/${remainingUrl}`;
  } else {
    // Existing transformation segment, replace it with ours
    segments[0] = fullTransform;
    return `${baseUrl}${segments.join('/')}`;
  }
};

export const deleteImage = async (url: string) => {
  if (!url || !url.includes('cloudinary.com')) return;
  
  try {
    const parts = url.split('/');
    const filenameWithExt = parts.pop();
    const folder = parts.pop();
    const publicId = `${folder}/${filenameWithExt?.split('.')[0]}`;
    
    if (publicId) {
      await cloudinary.uploader.destroy(publicId);
      console.log(`Cloudinary asset purged: ${publicId}`);
    }
  } catch (err) {
    console.warn('Cloudinary delete failed:', err);
  }
};

export default cloudinary;
