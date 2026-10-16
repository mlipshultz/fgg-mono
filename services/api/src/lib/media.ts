import { DeleteObjectsCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** Resolve S3 object keys to public URLs on the media CloudFront distribution. */
const BASE = (process.env.MEDIA_BASE_URL ?? 'https://media.invalid').replace(/\/$/, '');
const BUCKET = process.env.MEDIA_BUCKET ?? '';

export function mediaUrl(key: string): string {
  return `${BASE}/${key.split('/').map(encodeURIComponent).join('/')}`;
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

export type MediaDeleter = (keys: string[]) => Promise<void>;
let deleter: MediaDeleter | undefined;

/** Remove objects from the media bucket (missing keys are fine). */
export async function deleteMedia(keys: string[]): Promise<void> {
  if (!keys.length) return;
  if (deleter) return deleter(keys);
  if (!BUCKET) throw new Error('MEDIA_BUCKET is not set');
  s3 ??= new S3Client({});
  await s3.send(
    new DeleteObjectsCommand({
      Bucket: BUCKET,
      Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
    }),
  );
}

/** Test hook. */
export function setMediaDeleter(d: MediaDeleter | undefined): void {
  deleter = d;
}
