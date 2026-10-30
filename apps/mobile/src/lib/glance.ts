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
    const context: GlanceContext | null =
      session && data ? { glance: data, serverUrl: session.serverUrl, token: session.token, locale, hideCalories } : null;
    syncWidgets(context);
    syncWatch(context);
  }, [session, data, locale, hideCalories]);
}
