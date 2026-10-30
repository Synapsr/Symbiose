import { localTime, type DaySummary, type Profile, type SleepNight } from '@symbiose/shared';
import { Moon } from 'lucide-react-native';
import { View } from 'react-native';

import { HydrationRow } from '@/components/today/hydration-row';
import { MoodRow } from '@/components/today/mood-row';
import { Card, Row, Txt } from '@/components/ui';
import { useI18n } from '@/i18n';
import { formatSleep } from '@/lib/format';
import { useUser } from '@/lib/session';
import { LIFE_COLORS, Space, useTheme } from '@/theme';

/** Last night, in one quiet line under the greeting: « Nuit de 7 h 12 · 23:40 → 07:05 ». */
export function SleepLine({ night }: { night: SleepNight }) {
  const { t, locale } = useI18n();
  return (
    <Row gap={6} style={{ marginTop: 2 }}>
      <Moon size={13} color={LIFE_COLORS.sleep} fill={LIFE_COLORS.sleep} />
      <Txt variant="caption" tone="secondary" numberOfLines={1} style={{ flexShrink: 1, fontVariant: ['tabular-nums'] }}>
        {t('sleep.lastNight', { duration: formatSleep(night.asleepMin, locale) })} · {localTime(night.bedtime)} → {localTime(night.wakeTime)}
      </Txt>
    </Row>
  );
}

/** Past days are read-only: their mood shows only if one was checked in. */
const showsMood = (day: DaySummary, profile: Profile | null, isToday: boolean) => profile?.trackMood === true && (isToday || Boolean(day.mood));

/** Whether Today has a life card to show: nothing at all when both modules are off. */
export const hasLifeCard = (day: DaySummary, profile: Profile | null, isToday: boolean) => Boolean(day.hydration) || showsMood(day, profile, isToday);

/** Hydration and mood share one compact card, each only when its module is on. */
export function LifeCard({ day, isToday }: { day: DaySummary; isToday: boolean }) {
  const { colors } = useTheme();
  const user = useUser();
  const hydration = day.hydration ?? null;
  const showMood = showsMood(day, user.profile, isToday);
  if (!hydration && !showMood) return null;
  return (
    <Card style={{ gap: Space.lg }}>
      {hydration ? <HydrationRow date={day.date} hydration={hydration} editable={isToday} /> : null}
      {hydration && showMood ? <View style={{ height: 1, backgroundColor: colors.border }} /> : null}
      {showMood ? <MoodRow date={day.date} mood={day.mood ?? null} editable={isToday} /> : null}
    </Card>
  );
}
