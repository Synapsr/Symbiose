import type { PhotoFiles } from '@symbiose/core';
import { Directory, File, Paths } from 'expo-file-system';

/**
 * Meal photos on the phone, in the app's documents: the system never clears
 * them, and iCloud backs them up with the rest of the phone. Found again from
 * `Paths.document` each time (the container path changes with app updates).
 */
const folder = () => new Directory(Paths.document, 'photos');
const fileFor = (id: string) => new File(Paths.document, 'photos', `${id}.jpg`);

export const phonePhotoFiles: PhotoFiles = {
  async write(id, photo) {
    folder().create({ intermediates: true, idempotent: true });
    await fileFor(id).write(photo.base64, { encoding: 'base64' });
  },
  async writeBytes(id, bytes) {
    folder().create({ intermediates: true, idempotent: true });
    fileFor(id).write(bytes);
  },
  async readBase64(id) {
    const file = fileFor(id);
    return file.exists ? file.base64() : null;
  },
  async readBytes(id) {
    const file = fileFor(id);
    return file.exists ? file.bytes() : null;
  },
  async remove(id) {
    const file = fileFor(id);
    if (file.exists) file.delete();
  },
};

/** What an image component shows for a meal photo; the file's type is read from its bytes. */
export function photoUri(id: string): string {
  return fileFor(id).uri;
}

/** Every photo file, for a backup. */
export function photoFolder(): Directory {
  return folder();
}
