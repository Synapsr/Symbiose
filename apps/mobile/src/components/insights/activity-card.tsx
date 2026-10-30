import type { InsightsActivity } from '@symbiose/shared';
import { Footprints, SportShoe } from 'lucide-react-native';
import { View } from 'react-native';

import { DayBars } from '@/components/insights/charts';
import { Card, Row, Txt } from '@/components/ui';
import { WORKOUT_ICONS, workoutTypeKey } from '@/components/workout-meta';
import { useI18n } from '@/i18n';
import { formatNumber, weekdayInitial } from '@/lib/format';
import { Space, useTheme } from '@/theme';

/** Active minutes per day against the weekly goal, what kind of sessions, and how moving relates to cravings. */
export function ActivityCard({ activity }: { activity: InsightsActivity }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const { goals } = activity;
  const weekly = Math.round(activity.weeklyMinutes);
  const reached = goals.weeklyActiveMinutes > 0 && weekly >= goals.weeklyActiveMinutes;

  const stepDays = activity.days.filter((d) => d.steps !== null);
  const avgSteps = stepDays.length ? Math.round(stepDays.reduce((sum, d) => sum + (d.steps ?? 0), 0) / stepDays.length) : null;
  const hasSessions = activity.totalMinutes > 0;
  const cravings = activity.cravingsOnActiveDays;
  const stepsReached = Boolean(goals.dailySteps && avgSteps !== null && avgSteps >= goals.dailySteps);

  return (
    <Card style={{ gap: Space.lg }}>
      <View style={{ gap: 2 }}>
        <Row gap={6}>
          <SportShoe size={14} color={colors.text2} />
          <Txt variant="label" tone="secondary">
            {t('insights.activity')}
          </Txt>
        </Row>
        {hasSessions ? (
          <>
            <Row gap={6} style={{ alignItems: 'baseline' }}>
              <Txt variant="display" style={{ fontSize: 36 }}>
                {formatNumber(weekly, locale)}
              </Txt>
              <Txt tone="secondary">{t('insights.activityPerWeek')}</Txt>
            </Row>
            <Txt variant="label" tone={reached ? 'accent' : 'secondary'}>
              {reached ? `${t('insights.activityReached', { goal: goals.weeklyActiveMinutes })} ✓` : t('insights.activityGoal', { goal: goals.weeklyActiveMinutes })}
            </Txt>
          </>
        ) : avgSteps !== null ? (
          // No session yet, but the steps are there: lead with what was done, not with a zero.
          <>
            <Row gap={6} style={{ alignItems: 'baseline' }}>
              <Txt variant="display" style={{ fontSize: 36 }}>
                {formatNumber(avgSteps, locale)}
              </Txt>
              <Txt tone="secondary">{t('insights.activityStepsPerDay')}</Txt>
            </Row>
            {goals.dailySteps ? (
              <Txt variant="label" tone={stepsReached ? 'accent' : 'secondary'}>
                {t('insights.activityStepsGoalShort', { goal: formatNumber(goals.dailySteps, locale) })}
                {stepsReached ? ' ✓' : ''}
              </Txt>
            ) : null}
          </>
        ) : null}
      </View>

      {!hasSessions ? (
        <Txt tone="secondary">{avgSteps !== null ? t('insights.activityNoSession') : t('insights.activityEmpty')}</Txt>
      ) : (
        <>
          <DayBars
            values={activity.days.map((d) => (d.activeMinutes > 0 ? d.activeMinutes : null))}
            labels={activity.days.map((d) => weekdayInitial(d.date, locale))}
            target={goals.weeklyActiveMinutes / 7}
            kind="min"
            color={colors.accent}
          />

          {avgSteps !== null ? (
            <Row gap={6}>
              <Footprints size={14} color={goals.dailySteps && avgSteps >= goals.dailySteps ? colors.accent : colors.text2} />
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
                    <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }}>
                      <Icon size={16} color={colors.text} />
                    </View>
                    <Txt variant="label" style={{ flex: 1 }}>
                      {t(workoutTypeKey(entry.type))}
                    </Txt>
                    <Txt variant="caption" tone="secondary" style={{ fontVariant: ['tabular-nums'] }}>
                      {t(entry.sessions === 1 ? 'insights.sessions.one' : 'insights.sessions.other', { count: entry.sessions })} · {formatNumber(Math.round(entry.minutes), locale)} min
                    </Txt>
                  </Row>
                );
              })}
            </View>
          ) : null}
        </>
      )}

      {cravings ? (
        <Txt variant="accent" tone="secondary" style={{ fontSize: 17, lineHeight: 24 }}>
          {t('insights.activityCravings', { active: formatNumber(cravings.active, locale, 1), inactive: formatNumber(cravings.inactive, locale, 1) })}
        </Txt>
      ) : null}
    </Card>
  );
}
