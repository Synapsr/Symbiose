import { existsSync } from 'node:fs';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Db } from '@symbiose/core';
import { PhotoStore as CorePhotoStore, type PhotoFiles } from '@symbiose/core/services/photos';

/** Photo files in a folder (DATA_DIR/photos), one file per id. */
export function folderPhotoFiles(dir: string): PhotoFiles {
  const path = (id: string) => join(dir, id);
  return {
    async write(id, photo) {
      await writeFile(path(id), Buffer.from(photo.base64, 'base64'));
    },
    async writeBytes(id, bytes) {
      await writeFile(path(id), bytes);
    },
    async readBase64(id) {
      return existsSync(path(id)) ? (await readFile(path(id))).toString('base64') : null;
    },
    async readBytes(id) {
      return existsSync(path(id)) ? new Uint8Array(await readFile(path(id))) : null;
    },
    async remove(id) {
      await unlink(path(id));
    },
  };
}

/** The server's photos: rows in the database, files in `dir`. */
export class PhotoStore extends CorePhotoStore {
  constructor(db: Db, dir: string) {
    super(db, folderPhotoFiles(dir));
  }
}
