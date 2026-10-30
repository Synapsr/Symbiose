import type { InsightsActivity } from '@symbiose/shared';
import { Footprints, SportShoe } from 'lucide-react-native';
import { View } from 'react-native';

import { DayBars, MiniBars } from '@/components/insights/charts';
import { ExpandRow, RowsCard } from '@/components/insights/expand-row';
import { Row, Txt } from '@/components/ui';
import { WORKOUT_ICONS, workoutTypeKey } from '@/components/workout-meta';
import { useI18n } from '@/i18n';
import { formatNumber, weekdayInitial } from '@/lib/format';
import { Space, useTheme } from '@/theme';

/** Nothing to show yet: no session and no steps over the period. */
export function hasActivity(activity: InsightsActivity): boolean {
  return activity.totalMinutes > 0 || activity.days.some((d) => d.steps !== null);
}

/**
 * Activity in one line: minutes a week against the goal (or steps when there's no session yet),
 * a bar a day; the details open underneath: per day, steps, kinds of sessions, and cravings.
 */
export function ActivityCard({ activity }: { activity: InsightsActivity }) {
  const { t, plural, locale } = useI18n();
  const { colors } = useTheme();
  const { goals } = activity;
  const weekly = Math.round(activity.weeklyMinutes);
  const reached = goals.weeklyActiveMinutes > 0 && weekly >= goals.weeklyActiveMinutes;

  const stepDays = activity.days.filter((d) => d.steps !== null);
  const avgSteps = stepDays.length ? Math.round(stepDays.reduce((sum, d) => sum + (d.steps ?? 0), 0) / stepDays.length) : null;
  const hasSessions = activity.totalMinutes > 0;
  const cravings = activity.cravingsOnActiveDays;
  const stepsReached = Boolean(goals.dailySteps && avgSteps !== null && avgSteps >= goals.dailySteps);

  // No session yet, but the steps are there: lead with what was done, not with a zero.
  const value = hasSessions
    ? `${formatNumber(weekly, locale)} ${t('insights.activityPerWeek')}`
    : avgSteps !== null
      ? `${formatNumber(avgSteps, locale)} ${t('insights.activityStepsPerDay')}`
      : '—';
  const caption = hasSessions
    ? reached
      ? `${t('insights.activityReached', { goal: goals.weeklyActiveMinutes })} ✓`
      : t('insights.activityGoal', { goal: goals.weeklyActiveMinutes })
    : avgSteps !== null && goals.dailySteps
      ? `${t('insights.activityStepsGoalShort', { goal: formatNumber(goals.dailySteps, locale) })}${stepsReached ? ' ✓' : ''}`
      : t('insights.activityNoSession');

  return (
    <RowsCard>
      <ExpandRow
        first
        icon={<SportShoe size={17} color={colors.text} />}
        label={t('insights.activity')}
        value={value}
        caption={caption}
        captionColor={(hasSessions && reached) || (!hasSessions && stepsReached) ? colors.accent : undefined}
        chart={<MiniBars values={activity.days.map((d) => (hasSessions ? d.activeMinutes || null : d.steps))} color={colors.accent} />}>
        {hasSessions ? (
          <DayBars
            values={activity.days.map((d) => (d.activeMinutes > 0 ? d.activeMinutes : null))}
            labels={activity.days.map((d) => weekdayInitial(d.date, locale))}
            target={goals.weeklyActiveMinutes / 7}
            kind="min"
            color={colors.accent}
          />
        ) : null}

        {hasSessions && avgSteps !== null ? (
          <Row gap={6}>
            <Footprints size={14} color={stepsReached ? colors.accent : colors.text2} />
            <Txt variant="caption" tone="secondary">
              {goals.dailySteps
                ? t('insights.activityStepsGoal', { count: formatNumber(avgSteps, locale), goal: formatNumber(goals.dailySteps, locale) })
                : t('insights.activitySteps', { count: formatNumber(avgSteps, locale) })}
            </Txt>
          </Row>
        ) : null}

        {activity.byType.length ? (
          <View style={{ gap: Space.md }}>
            {activity.byType.map((entry) => {
              const Icon = WORKOUT_ICONS[entry.type];
              return (
                <Row key={entry.type} gap={Space.md}>
                  <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon size={15} color={colors.text} />
                  </View>
                  <Txt variant="label" style={{ flex: 1 }}>
                    {t(workoutTypeKey(entry.type))}
                  </Txt>
                  <Txt variant="caption" tone="secondary" style={{ fontVariant: ['tabular-nums'] }}>
                    {plural('insights.sessions', entry.sessions)} · {formatNumber(Math.round(entry.minutes), locale)} min
                  </Txt>
                </Row>
              );
            })}
          </View>
        ) : null}

        {cravings ? (
          <Txt variant="accent" tone="secondary" style={{ fontSize: 17, lineHeight: 24 }}>
            {t('insights.activityCravings', { active: formatNumber(cravings.active, locale, 1), inactive: formatNumber(cravings.inactive, locale, 1) })}
          </Txt>
        ) : null}
      </ExpandRow>
    </RowsCard>
  );
}
