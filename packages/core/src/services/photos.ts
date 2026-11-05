import { and, eq } from 'drizzle-orm';

import type { Db } from '../db';
import { photos } from '../db/schema';
import { HttpError } from '../errors';
import { newId } from '../ids';

export type PhotoMime = 'image/jpeg' | 'image/png' | 'image/webp';

const MAX_BYTES = 8 * 1024 * 1024;

/** A photo as the app sends it: base64 without its data-URL prefix, its type and its size in bytes. */
export interface DecodedPhoto {
  base64: string;
  mime: PhotoMime;
  size: number;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** The first bytes of a base64 string, enough to recognise a file type. */
function head(base64: string, bytes: number): Uint8Array {
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of base64.slice(0, Math.ceil(bytes / 3) * 4)) {
    const value = ALPHABET.indexOf(char);
    if (value < 0) break;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out.slice(0, bytes));
}

export function detectMime(bytes: Uint8Array): PhotoMime | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, i) => bytes[i] === byte)) return 'image/png';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export function decodePhoto(input: string): DecodedPhoto {
  const base64 = input.replace(/^data:image\/\w+;base64,/, '').replace(/\s+/g, '');
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  const size = Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
  if (size === 0 || size > MAX_BYTES) throw new HttpError(413, 'photo_too_large', 'Photo is empty or larger than 8 MB');
  const mime = detectMime(head(base64, 12));
  if (!mime) throw new HttpError(415, 'photo_unsupported', 'Only JPEG, PNG and WebP photos are supported');
  return { base64, mime, size };
}

/**
 * Where a host keeps the photo files: a folder on the server's disk, the
 * app's documents on the phone. The core keeps the `photos` table.
 */
export interface PhotoFiles {
  write(id: string, photo: DecodedPhoto): Promise<void>;
  /** A photo coming back from a backup, under its own id. */
  writeBytes(id: string, bytes: Uint8Array): Promise<void>;
  /** The file in base64, or null when it is missing. */
  readBase64(id: string): Promise<string | null>;
  /** The file's bytes, for `GET /api/photos/:id`, or null when it is missing. */
  readBytes(id: string): Promise<Uint8Array | null>;
  remove(id: string): Promise<void>;
}

export class PhotoStore {
  constructor(
    private readonly db: Db,
    private readonly files: PhotoFiles,
  ) {}

  private row(userId: string, id: string) {
    return this.db.select().from(photos).where(and(eq(photos.id, id), eq(photos.userId, userId))).get();
  }

  async save(userId: string, photo: DecodedPhoto): Promise<string> {
    const id = newId();
    await this.files.write(id, photo);
    this.db.insert(photos).values({ id, userId, mime: photo.mime, size: photo.size, createdAt: new Date().toISOString() }).run();
    return id;
  }

  /** The user's photo in base64 (to send it to the AI again), or null. */
  async read(userId: string, id: string): Promise<{ base64: string; mime: string } | null> {
    const row = this.row(userId, id);
    const base64 = row ? await this.files.readBase64(id) : null;
    return row && base64 ? { base64, mime: row.mime } : null;
  }

  async readBytes(userId: string, id: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
    const row = this.row(userId, id);
    const bytes = row ? await this.files.readBytes(id) : null;
    return row && bytes ? { bytes, mime: row.mime } : null;
  }

  /** Puts a backup's photo file back (its row comes with the backup's rows). */
  async restoreFile(id: string, bytes: Uint8Array): Promise<void> {
    await this.files.writeBytes(id, bytes);
  }

  async remove(userId: string, id: string): Promise<void> {
    const deleted = this.db.delete(photos).where(and(eq(photos.id, id), eq(photos.userId, userId))).returning().get();
    if (deleted) await this.files.remove(id).catch(() => undefined);
  }
}
