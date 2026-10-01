/** Resolve S3 object keys to public URLs on the media CloudFront distribution. */
const BASE = (process.env.MEDIA_BASE_URL ?? 'https://media.invalid').replace(/\/$/, '');

export function mediaUrl(key: string): string {
  return `${BASE}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

/** Resize variants arrive in Phase 4; until then the thumb is the original. */
export function thumbUrl(key: string): string {
  return mediaUrl(key);
}
