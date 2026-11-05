/**
 * A new random id (UUID v4) for a row or a photo. Web Crypto's `randomUUID`
 * is there on Node and in browsers; the app installs it in its JavaScript
 * engine before the core runs (`apps/mobile/src/local`).
 */
export function newId(): string {
  return crypto.randomUUID();
}
