/** On the web there's no document directory: waiting photos stay in localStorage (a few hundred KB each). */
const key = (id: string) => `symbiose.outbox.photo.${id}`;

function get(id: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key(id)) ?? null;
  } catch {
    return null;
  }
}

export const outboxPhotos = {
  async save(id: string, base64: string): Promise<void> {
    globalThis.localStorage?.setItem(key(id), base64);
  },
  async read(id: string): Promise<string | null> {
    return get(id);
  },
  uri(id: string): string | null {
    const base64 = get(id);
    return base64 ? `data:image/jpeg;base64,${base64}` : null;
  },
  remove(id: string): void {
    try {
      globalThis.localStorage?.removeItem(key(id));
    } catch {
      // Already gone.
    }
  },
};
