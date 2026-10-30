import type { GlanceContext } from '@/lib/glance';

/** The watch app exists on iOS only (see watch.ios.ts); nothing to do elsewhere. */
export function syncWatch(_context: GlanceContext | null) {}
