import type { LogoContentType } from '@fgg/types';

const ALLOWED: LogoContentType[] = ['image/png', 'image/jpeg', 'image/webp'];

/**
 * Shrink an image in the browser so logos upload small and the media bucket never holds a
 * 12MB phone photo. PNGs stay PNG (transparency); everything else becomes WebP when the browser
 * can encode it, else PNG.
 */
export async function resizeImage(
  file: File,
  max = 512,
): Promise<{ blob: Blob; contentType: LogoContentType }> {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file');
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process the image');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const want = file.type === 'image/png' ? 'image/png' : 'image/webp';
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, want, 0.9));
  if (!blob) throw new Error('Could not process the image');
  const contentType = (ALLOWED as string[]).includes(blob.type)
    ? (blob.type as LogoContentType)
    : 'image/png';
  return { blob, contentType };
}
