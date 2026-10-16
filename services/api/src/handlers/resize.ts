import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { S3Event } from 'aws-lambda';
import sharp from 'sharp';
import { VARIANTS, originalId, variantKey } from '../lib/gallery-media.js';

let s3 = new S3Client({});
/** Test hook. */
export function setS3Client(client: S3Client): void {
  s3 = client;
}

/**
 * Fires for every object created under `gallery/originals/`: writes a 1600-wide display copy
 * and a 480-wide thumbnail as WebP under `gallery/derived/{id}/`, turned upright from the
 * photo's EXIF orientation and never enlarged. Originals are left as they are.
 */
export async function handler(event: S3Event): Promise<{ resized: string[] }> {
  const resized: string[] = [];
  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
    const id = originalId(key);
    if (!id) continue; // not an original (the trigger is filtered, but be safe)
    const got = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const input = Buffer.from(await got.Body!.transformToByteArray());
    for (const v of VARIANTS) {
      const body = await sharp(input)
        .rotate()
        .resize({ width: v.width, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: variantKey(id, v.name),
          Body: body,
          ContentType: 'image/webp',
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
      resized.push(variantKey(id, v.name));
    }
  }
  return { resized };
}
