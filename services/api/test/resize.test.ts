import { describe, expect, it } from 'vitest';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import sharp from 'sharp';
import type { S3Event } from 'aws-lambda';

process.env.MEDIA_BASE_URL = 'https://media.test';
const { handler, setS3Client } = await import('../src/handlers/resize.js');
const { galleryPhotoUrls } = await import('../src/lib/gallery-media.js');

const event = (key: string): S3Event =>
  ({ Records: [{ s3: { bucket: { name: 'media' }, object: { key } } }] }) as unknown as S3Event;

describe('gallery resize', () => {
  it('writes a display copy and a thumbnail as WebP, never enlarged', async () => {
    // A 2000×1000 photo.
    const photo = await sharp({
      create: { width: 2000, height: 1000, channels: 3, background: '#ff66aa' },
    })
      .jpeg()
      .toBuffer();
    const s3 = mockClient(S3Client);
    // The handler only reads the body as bytes.
    s3.on(GetObjectCommand).resolves({
      Body: { transformToByteArray: async () => new Uint8Array(photo) },
    } as never);
    const puts: { key: string; type: string; width: number }[] = [];
    s3.on(PutObjectCommand).callsFake(
      async (input: { Key: string; ContentType: string; Body: Buffer }) => {
        puts.push({
          key: input.Key,
          type: input.ContentType,
          width: (await sharp(input.Body).metadata()).width!,
        });
        return {};
      },
    );
    setS3Client(new S3Client({}));

    const res = await handler(event('gallery/originals/01abc.jpg'));
    expect(res.resized).toEqual([
      'gallery/derived/01abc/display.webp',
      'gallery/derived/01abc/thumb.webp',
    ]);
    expect(puts).toEqual([
      { key: 'gallery/derived/01abc/display.webp', type: 'image/webp', width: 1600 },
      { key: 'gallery/derived/01abc/thumb.webp', type: 'image/webp', width: 480 },
    ]);

    // Anything outside the originals prefix is ignored (its own copies, the seeded posters).
    expect((await handler(event('gallery/derived/01abc/thumb.webp'))).resized).toEqual([]);
    s3.restore();
  });

  it('serves resized copies for uploaded photos and the file itself for seeded ones', () => {
    expect(galleryPhotoUrls('gallery/originals/01abc.jpg')).toEqual({
      url: 'https://media.test/gallery/derived/01abc/display.webp',
      thumbUrl: 'https://media.test/gallery/derived/01abc/thumb.webp',
    });
    expect(galleryPhotoUrls('gallery/harbor-fest-2026/poster.jpg')).toEqual({
      url: 'https://media.test/gallery/harbor-fest-2026/poster.jpg',
      thumbUrl: 'https://media.test/gallery/harbor-fest-2026/poster.jpg',
    });
  });
});
