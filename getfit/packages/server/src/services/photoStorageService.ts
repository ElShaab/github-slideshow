import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { env } from '../config/env';
import { photoRepository, type PhotoRow } from '../repositories/photoRepository';
import { errors } from '../utils/errors';
import { logger } from '../utils/logger';

export interface StoredPhoto {
  id: string;
  contentType: string;
  byteSize: number;
  createdAt: string;
}

const ALLOWED_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp']);

/**
 * PhotoStorageService
 *
 * Photos are private by default and never served from a public URL. Storage
 * keys are opaque random identifiers scoped under the owning user, and every
 * read goes through an ownership-checked database lookup first — there is no
 * code path that resolves a photo without a user id.
 */
export class PhotoStorageService {
  async store(args: {
    userId: string;
    buffer: Buffer;
    contentType: string;
    purpose?: string;
  }): Promise<{ photo: StoredPhoto; buffer: Buffer }> {
    const contentType = normaliseContentType(args.contentType);
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      throw errors.uploadFailed('That file type is not supported. Use a JPEG or PNG photo.');
    }
    if (args.buffer.byteLength === 0) {
      throw errors.uploadFailed();
    }
    if (args.buffer.byteLength > env.maxPhotoBytes) {
      throw errors.uploadFailed('That photo is too large. Please try a smaller one.');
    }

    const checksum = createHash('sha256').update(args.buffer).digest('hex');
    // The key is unguessable and namespaced by user so nothing is enumerable.
    const storageKey = `${args.userId}/${randomUUID()}`;

    try {
      await this.writeObject(storageKey, args.buffer);
    } catch (error) {
      logger.error('Photo write failed', error);
      throw errors.uploadFailed();
    }

    const row = await photoRepository.create({
      userId: args.userId,
      storageKey,
      contentType,
      byteSize: args.buffer.byteLength,
      checksum,
      purpose: args.purpose ?? 'assessment',
    });

    return { photo: mapPhoto(row), buffer: args.buffer };
  }

  /** Reads a photo. The user id is part of the lookup, not a later check. */
  async read(userId: string, photoId: string): Promise<{ buffer: Buffer; contentType: string }> {
    const row = await photoRepository.findOwned(userId, photoId);
    if (!row) throw errors.notFound('That photo is not available.');

    try {
      const buffer = await this.readObject(row.storage_key);
      return { buffer, contentType: row.content_type };
    } catch (error) {
      logger.error('Photo read failed', error);
      throw errors.notFound('That photo is not available.');
    }
  }

  async deleteAllForUser(userId: string): Promise<number> {
    const keys = await photoRepository.softDeleteAll(userId);
    let removed = 0;
    for (const key of keys) {
      try {
        await this.deleteObject(key);
        removed += 1;
      } catch (error) {
        logger.warn('Photo delete failed', { error: String(error) });
      }
    }
    return removed;
  }

  /* --------------------------- storage driver --------------------------- */

  private async writeObject(storageKey: string, buffer: Buffer): Promise<void> {
    if (env.storageDriver === 's3') {
      await s3PutObject(storageKey, buffer);
      return;
    }
    const target = this.localPath(storageKey);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, buffer, { mode: 0o600 });
  }

  private async readObject(storageKey: string): Promise<Buffer> {
    if (env.storageDriver === 's3') return s3GetObject(storageKey);
    return fs.readFile(this.localPath(storageKey));
  }

  private async deleteObject(storageKey: string): Promise<void> {
    if (env.storageDriver === 's3') {
      await s3DeleteObject(storageKey);
      return;
    }
    await fs.rm(this.localPath(storageKey), { force: true });
  }

  /** Resolves inside the storage root and rejects anything that escapes it. */
  private localPath(storageKey: string): string {
    const root = path.resolve(env.storageLocalPath);
    const resolved = path.resolve(root, storageKey);
    if (!resolved.startsWith(`${root}${path.sep}`)) {
      throw new Error('Invalid storage key');
    }
    return resolved;
  }
}

/* ------------------------------ S3 driver ------------------------------ */

/**
 * The bucket is private: objects are written with no ACL and are only ever
 * read back through this service, which has already checked ownership. No
 * presigned URL is ever handed to a client, so a photo cannot outlive the
 * request that fetched it.
 */
type S3Client = import('@aws-sdk/client-s3').S3Client;

let s3Client: S3Client | null = null;

async function getS3(): Promise<{ client: S3Client; sdk: typeof import('@aws-sdk/client-s3') }> {
  const sdk = await import('@aws-sdk/client-s3');
  if (!s3Client) {
    s3Client = new sdk.S3Client({ region: env.storageS3Region || undefined });
  }
  return { client: s3Client, sdk };
}

async function s3PutObject(storageKey: string, buffer: Buffer): Promise<void> {
  const { client, sdk } = await getS3();
  await client.send(
    new sdk.PutObjectCommand({
      Bucket: env.storageS3Bucket,
      Key: storageKey,
      Body: buffer,
      ServerSideEncryption: 'AES256',
    }),
  );
}

async function s3GetObject(storageKey: string): Promise<Buffer> {
  const { client, sdk } = await getS3();
  const result = await client.send(
    new sdk.GetObjectCommand({ Bucket: env.storageS3Bucket, Key: storageKey }),
  );
  if (!result.Body) throw new Error('Empty object body');
  return Buffer.from(await result.Body.transformToByteArray());
}

async function s3DeleteObject(storageKey: string): Promise<void> {
  const { client, sdk } = await getS3();
  await client.send(
    new sdk.DeleteObjectCommand({ Bucket: env.storageS3Bucket, Key: storageKey }),
  );
}

function normaliseContentType(contentType: string): string {
  return contentType.split(';')[0].trim().toLowerCase();
}

function mapPhoto(row: PhotoRow): StoredPhoto {
  return {
    id: row.id,
    contentType: row.content_type,
    byteSize: row.byte_size,
    createdAt: row.created_at.toISOString(),
  };
}

export const photoStorageService = new PhotoStorageService();
