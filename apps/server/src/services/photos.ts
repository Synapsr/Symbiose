import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { and, eq } from 'drizzle-orm';

import type { Db } from '../db';
import { photos } from '../db/schema';
import { HttpError } from '../errors';

export type PhotoMime = 'image/jpeg' | 'image/png' | 'image/webp';

const MAX_BYTES = 8 * 1024 * 1024;

export function detectMime(buffer: Buffer): PhotoMime | null {
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

export function decodePhoto(base64: string): { buffer: Buffer; mime: PhotoMime } {
  const clean = base64.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(clean, 'base64');
  if (buffer.length === 0 || buffer.length > MAX_BYTES) throw new HttpError(413, 'photo_too_large', 'Photo is empty or larger than 8 MB');
  const mime = detectMime(buffer);
  if (!mime) throw new HttpError(415, 'photo_unsupported', 'Only JPEG, PNG and WebP photos are supported');
  return { buffer, mime };
}

export class PhotoStore {
  constructor(
    private readonly db: Db,
    private readonly dir: string,
  ) {}

  private path(id: string) {
    return join(this.dir, id);
  }

  async save(userId: string, buffer: Buffer, mime: PhotoMime): Promise<string> {
    const id = randomUUID();
    await writeFile(this.path(id), buffer);
    this.db.insert(photos).values({ id, userId, mime, size: buffer.length, createdAt: new Date().toISOString() }).run();
    return id;
  }

  async read(userId: string, id: string): Promise<{ buffer: Buffer; mime: string } | null> {
    const row = this.db.select().from(photos).where(and(eq(photos.id, id), eq(photos.userId, userId))).get();
    if (!row || !existsSync(this.path(id))) return null;
    return { buffer: await readFile(this.path(id)), mime: row.mime };
  }

  async remove(userId: string, id: string): Promise<void> {
    const deleted = this.db.delete(photos).where(and(eq(photos.id, id), eq(photos.userId, userId))).returning().get();
    if (deleted) await unlink(this.path(id)).catch(() => undefined);
  }
}
