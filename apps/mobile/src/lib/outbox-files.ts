import { Directory, File, Paths } from 'expo-file-system';

/**
 * Photos waiting for the network, one JPEG per capture in the app's documents
 * (the system never clears them, unlike the cache). Only the capture id is
 * stored: on iOS the container path changes with app updates, so the file is
 * found again from `Paths.document` each time.
 */
const fileFor = (id: string) => new File(Paths.document, 'outbox', `${id}.jpg`);

export const outboxPhotos = {
  async save(id: string, base64: string): Promise<void> {
    new Directory(Paths.document, 'outbox').create({ intermediates: true, idempotent: true });
    await fileFor(id).write(base64, { encoding: 'base64' });
  },
  async read(id: string): Promise<string | null> {
    const file = fileFor(id);
    return file.exists ? file.base64() : null;
  },
  /** For the waiting card's thumbnail. */
  uri(id: string): string | null {
    const file = fileFor(id);
    return file.exists ? file.uri : null;
  },
  remove(id: string): void {
    try {
      const file = fileFor(id);
      if (file.exists) file.delete();
    } catch {
      // Already gone.
    }
  },
};
