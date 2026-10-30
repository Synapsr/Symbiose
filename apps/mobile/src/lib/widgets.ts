import type { GlanceContext } from '@/lib/glance';

/** Home and Lock Screen widgets exist on iOS only (see widgets.ios.ts); nothing to do elsewhere. */
export function syncWidgets(_context: GlanceContext | null) {}
