import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** Resolve S3 object keys to public URLs on the media CloudFront distribution. */
const BASE = (process.env.MEDIA_BASE_URL ?? 'https://media.invalid').replace(/\/$/, '');
const BUCKET = process.env.MEDIA_BUCKET ?? '';

export function mediaUrl(key: string): string {
  return `${BASE}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

/** Resize variants arrive in Phase 4; until then the thumb is the original. */
export function thumbUrl(key: string): string {
  return mediaUrl(key);
}

export type Presigner = (key: string, contentType: string) => Promise<string>;
let presigner: Presigner | undefined;
let s3: S3Client | undefined;

/**
 * Presigned S3 PUT for a browser upload. The caller must send the same content-type header.
 * Keys carry a fresh ULID, so objects are immutable and CloudFront can cache them for good.
 */
export async function presignUpload(
  key: string,
  contentType: string,
  expiresIn = 300,
): Promise<string> {
  if (presigner) return presigner(key, contentType);
  if (!BUCKET) throw new Error('MEDIA_BUCKET is not set');
  s3 ??= new S3Client({});
  return getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType }),
    {
      expiresIn,
    },
  );
}

/** Test hook. */
export function setPresigner(p: Presigner | undefined): void {
  presigner = p;
}
