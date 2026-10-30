import { localTime, WATER_SIZES, type DaySummary } from '@symbiose/shared';
import { router } from 'expo-router';
import { Check, Moon, Plus } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown, FadeOut } from 'react-native-reanimated';

import { MoodFace, moodColor, moodLabel } from '@/components/mood-face';
import { MoodPanel } from '@/components/today/mood-row';
import { Glass, useWater } from '@/components/today/water';
import { Card, Pressy, Ring, Row, Txt } from '@/components/ui';
import { useI18n } from '@/i18n';
import { formatLiters, formatNumber, formatSleep } from '@/lib/format';
import { haptics } from '@/lib/haptics';
import { useUser } from '@/lib/session';
import { useSettings } from '@/lib/stores';
import { LIFE_COLORS, Radius, Space, useTheme } from '@/theme';

type Panel = 'water' | 'mood' | 'sleep';

/** A week with no session and no steps says nothing yet: no pill rather than a zero. */
export const hasActivity = (day: DaySummary) => day.activityWeek.activeMinutes > 0 || day.activity?.steps != null || day.workouts.length > 0;

/**
 * The opt-in modules in one row of compact pills, in the order Eau, Humeur,
 * Activité, Sommeil. A module that is off leaves no trace; with none on, no row.
 * Water pours a glass in one tap; mood and sleep open a small panel below;
 * Activité opens its sheet (the week, and a session to add).
 */
export function StatusRow({ day }: { day: DaySummary }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const user = useUser();
  const glassMl = useSettings((s) => s.glassMl);
  const setSettings = useSettings((s) => s.set);
  const pour = useWater(day.date);
  const [open, setOpen] = useState<Panel | null>(null);
  const toggle = (panel: Panel) => setOpen((current) => (current === panel ? null : panel));

  const hydration = day.hydration ?? null;
  const showMood = user.profile?.trackMood === true;
  const activity = hasActivity(day);
  const sleep = day.sleep ?? null;
  const count = [hydration, showMood, activity, sleep].filter(Boolean).length;
  if (!count) return null;
  // Four pills share 358 pt: the mood shows its face alone.
  const compact = count >= 4;

  const water = hydration ? hydration.totalMl / Math.max(1, hydration.goalMl) : 0;
  const mood = day.mood ?? null;
  const week = day.activityWeek;
  const steps = day.activity?.steps ?? null;
  // No session this week, but the steps are there: lead with what was done, not with a zero.
  const stepsFirst = week.activeMinutes === 0 && steps !== null;
  const move = stepsFirst ? (week.goals.dailySteps ? steps / week.goals.dailySteps : 0) : week.goals.weeklyActiveMinutes > 0 ? week.activeMinutes / week.goals.weeklyActiveMinutes : 0;

  return (
    <View style={{ gap: Space.sm }}>
      <Row gap={6}>
        {hydration ? (
          <Pill
            onPress={() => void pour(glassMl, hydration)}
            onLongPress={() => {
              haptics.tap();
              toggle('water');
            }}
            active={open === 'water'}
            accessibilityLabel={`${t('water.title')} ${formatLiters(hydration.totalMl, locale)}. ${t('water.add', { ml: glassMl })}`}
            accessibilityHint={t('water.pick')}>
            <Glass progress={water} totalMl={hydration.totalMl} height={20} />
            <Txt variant="label" numberOfLines={1} tone={water >= 1 ? 'accent' : 'primary'} style={{ flexShrink: 1, fontSize: 15, fontVariant: ['tabular-nums'] }}>
              {hydration.totalMl > 0 ? `${formatNumber(Math.round(hydration.totalMl / 100) / 10, locale, 1)} L` : t('water.short')}
            </Txt>
            <Plus size={14} color={colors.text2} strokeWidth={2.6} />
          </Pill>
        ) : null}

        {showMood ? (
          <Pill onPress={() => toggle('mood')} active={open === 'mood'} accessibilityLabel={`${t('mood.title')}${mood ? `, ${t(moodLabel(mood.mood))}` : ''}`}>
            <MoodFace mood={mood?.mood ?? 3} size={22} color={mood ? moodColor(mood.mood, colors) : colors.text3} filled={Boolean(mood)} fillOpacity={0.2} />
            {mood && compact ? null : (
              <Txt variant="label" numberOfLines={1} tone={mood ? 'primary' : 'secondary'} style={{ flexShrink: 1, fontSize: 15 }}>
                {mood ? t(moodLabel(mood.mood)) : t('mood.title')}
              </Txt>
            )}
          </Pill>
        ) : null}

        {activity ? (
          <Pill
            onPress={() => router.push({ pathname: '/workout', params: { date: day.date } })}
            accessibilityLabel={`${t('today.move')}: ${stepsFirst ? t('today.steps', { count: formatNumber(steps, locale) }) : t('today.moveMinutes', { count: week.activeMinutes })}`}>
            <Ring progress={move} size={20} stroke={3} color={colors.accent}>
              {move >= 1 ? <Check size={11} color={colors.accent} strokeWidth={3} /> : null}
            </Ring>
            <Txt variant="label" numberOfLines={1} style={{ flexShrink: 1, fontSize: 15, fontVariant: ['tabular-nums'] }}>
              {stepsFirst ? formatNumber(steps, locale) : `${formatNumber(week.activeMinutes, locale)} min`}
            </Txt>
          </Pill>
        ) : null}

        {sleep ? (
          <Pill onPress={() => toggle('sleep')} active={open === 'sleep'} accessibilityLabel={t('sleep.lastNight', { duration: formatSleep(sleep.asleepMin, locale) })}>
            <Moon size={15} color={LIFE_COLORS.sleep} fill={LIFE_COLORS.sleep} />
            <Txt variant="label" numberOfLines={1} style={{ flexShrink: 1, fontSize: 15, fontVariant: ['tabular-nums'] }}>
              {formatSleep(sleep.asleepMin, locale)}
            </Txt>
          </Pill>
        ) : null}
      </Row>

      {open === 'water' && hydration ? (
        <PanelCard key="water">
          <Txt variant="label" tone="secondary" style={{ fontVariant: ['tabular-nums'] }}>
            {t('water.today', { total: formatLiters(hydration.totalMl, locale), goal: formatLiters(hydration.goalMl, locale) })}
          </Txt>
          <Row gap={Space.sm}>
            {WATER_SIZES.map((ml) => (
              <WaterSizeChip
                key={ml}
                ml={ml}
                selected={ml === glassMl}
                onPress={() => {
                  setSettings({ glassMl: ml });
                  setOpen(null);
                  void pour(ml, hydration);
                }}
              />
            ))}
          </Row>
        </PanelCard>
      ) : null}
      {open === 'mood' && showMood ? (
        <PanelCard key="mood">
          <MoodPanel date={day.date} mood={mood} onPicked={() => setOpen(null)} />
        </PanelCard>
      ) : null}
      {open === 'sleep' && sleep ? (
        <PanelCard key="sleep">
          <Row gap={Space.sm}>
            <Moon size={16} color={LIFE_COLORS.sleep} fill={LIFE_COLORS.sleep} />
            <Txt variant="label" style={{ fontVariant: ['tabular-nums'] }}>
              {t('sleep.lastNight', { duration: formatSleep(sleep.asleepMin, locale) })}
            </Txt>
          </Row>
          <Txt variant="caption" tone="secondary" style={{ fontVariant: ['tabular-nums'] }}>
            {sleep.inBedMin !== null
              ? t('sleep.window', { bedtime: localTime(sleep.bedtime), wake: localTime(sleep.wakeTime), inBed: formatSleep(sleep.inBedMin, locale) })
              : `${localTime(sleep.bedtime)} → ${localTime(sleep.wakeTime)}`}
          </Txt>
        </PanelCard>
      ) : null}
    </View>
  );
}

/** A compact module pill: icon and value, the card's surface, the whole thing pressable. */
function Pill({
  children,
  onPress,
  onLongPress,
  active,
  accessibilityLabel,
  accessibilityHint,
}: {
  children: ReactNode;
  onPress: () => void;
  onLongPress?: () => void;
  active?: boolean;
  accessibilityLabel: string;
  accessibilityHint?: string;
}) {
  const { colors, elevation } = useTheme();
  return (
    <Pressy
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      haptic={!onLongPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ expanded: active }}
      style={[
        {
          flexGrow: 1,
          flexShrink: 1,
          minWidth: 0,
          height: 46,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 5,
          paddingHorizontal: 8,
          borderRadius: Radius.pill,
          borderCurve: 'continuous',
          backgroundColor: active ? colors.surface2 : colors.surface,
        },
        active ? null : elevation,
      ]}>
      {children}
    </Pressy>
  );
}

function PanelCard({ children }: { children: ReactNode }) {
  return (
    <Animated.View entering={FadeInDown.duration(220)} exiting={FadeOut.duration(140)}>
      <Card style={{ gap: Space.md, padding: Space.lg }}>{children}</Card>
    </Animated.View>
  );
}

export function WaterSizeChip({ ml, selected, onPress }: { ml: number; selected: boolean; onPress: () => void }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  return (
    <Pressy
      onPress={onPress}
      haptic={false}
      accessibilityRole="button"
      accessibilityLabel={t('water.add', { ml })}
      accessibilityState={{ selected }}
      style={{ flex: 1, height: 36, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? LIFE_COLORS.water : colors.surface2 }}>
      <Txt variant="label" color={selected ? '#FFFFFF' : colors.text} style={{ fontSize: 13, fontVariant: ['tabular-nums'] }}>
        {ml} ml
      </Txt>
    </Pressy>
  );
}

