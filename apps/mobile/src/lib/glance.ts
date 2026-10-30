import type { Glance, Locale } from '@symbiose/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useI18n } from '@/i18n';
import { useToday } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { useSettings } from '@/lib/stores';
import { syncWatch } from '@/lib/watch';
import { syncWidgets } from '@/lib/widgets';

/** Everything the watch and the widgets need to render and to call the server on their own. */
export interface GlanceContext {
  glance: Glance;
  serverUrl: string;
  token: string;
  locale: Locale;
  hideCalories: boolean;
}

/**
 * Keeps the watch and the widgets in step with Today. The query lives under
 * ['day', date] so every invalidation of the day refreshes it too.
 */
export function useGlanceSync() {
  const { session, api } = useSession();
  const { locale } = useI18n();
  const today = useToday();
  const hideCalories = useSettings((s) => s.hideCalories);
  const glance = useQuery({
    queryKey: ['day', today, 'glance', hideCalories],
    queryFn: () => api!.glance(today, hideCalories),
    enabled: Boolean(api),
  });

  const data = glance.data ?? null;
  useEffect(() => {
    // Still loading (or offline): keep what the watch and the widgets show. `null` means signed out only.
    if (!session || !data) return;
    const context: GlanceContext = { glance: data, serverUrl: session.serverUrl, token: session.token, locale, hideCalories };
    syncWidgets(context);
    syncWatch(context);
  }, [session, data, locale, hideCalories]);
}

/**
 * Signing out unmounts the tabs (and useGlanceSync with them), so the root
 * tells the watch and the widgets to forget the session.
 */
export function useSignedOutSync(signedOut: boolean) {
  useEffect(() => {
    if (!signedOut) return;
    syncWidgets(null);
    syncWatch(null);
  }, [signedOut]);
}
