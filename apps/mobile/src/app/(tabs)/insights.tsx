import { goalNutrient, type InsightsResponse, type NutrientKey } from '@symbiose/shared';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Camera, ChartNoAxesColumn } from 'lucide-react-native';
import { useState } from 'react';
import { Platform, RefreshControl, ScrollView, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActivityCard, hasActivity } from '@/components/insights/activity-card';
import { BodyCard } from '@/components/insights/body-card';
import { RowsCard } from '@/components/insights/expand-row';
import { GoalCard } from '@/components/insights/goal-card';
import { WaterTrendRow } from '@/components/insights/hydration-card';
import { moodDaysIn, MoodTrendRow } from '@/components/insights/mood-card';
import { ReviewCard } from '@/components/insights/review-card';
import { SleepTrendRow } from '@/components/insights/sleep-card';
import { SourcesCard } from '@/components/insights/sources-card';
import { Button, Card, Row, Segmented, Skeleton, Txt } from '@/components/ui';
import { useI18n } from '@/i18n';
import { formatAmount } from '@/lib/format';
import { errorMessage, useToday } from '@/lib/hooks';
import { useApi, useUser } from '@/lib/session';
import { useSettings } from '@/lib/stores';
import { Radius, Space, useTheme } from '@/theme';

/**
 * Tendances, read-only and short: the saved weekly review, the goal's number, where it comes from,
 * then body, activity and the rest of life in compact rows that open on a tap. The range applies
 * to every card but the weekly review, which is about the week by definition.
 */
export default function Insights() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const today = useToday();
  const queryClient = useQueryClient();
  const hideCalories = useSettings((s) => s.hideCalories);
  const [range, setRange] = useState<'7' | '30'>('7');
  const days = Number(range);
  const query = useQuery({
    queryKey: ['insights', days, today, hideCalories],
    queryFn: () => api.insights(days, today, hideCalories),
    // Switching range keeps the cards on screen while the other period loads.
    placeholderData: keepPreviousData,
  });
  const data = query.data;
  const refresh = () => {
    void query.refetch();
    void queryClient.invalidateQueries({ queryKey: ['weekly-review'] });
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<RefreshControl refreshing={query.isRefetching && !query.isPlaceholderData} onRefresh={refresh} />}
      contentContainerStyle={{ paddingTop: (Platform.OS === 'ios' ? 0 : insets.top) + Space.md, paddingHorizontal: Space.lg, paddingBottom: insets.bottom + 120, maxWidth: 640, width: '100%', alignSelf: 'center', gap: Space.lg }}>
      <Row style={{ justifyContent: 'space-between', paddingHorizontal: 4 }}>
        <Txt variant="title">{t('insights.title')}</Txt>
        <Segmented
          value={range}
          onChange={setRange}
          options={[
            { value: '7', label: t('insights.week') },
            { value: '30', label: t('insights.month') },
          ]}
        />
      </Row>

      <ReviewCard today={today} hideCalories={hideCalories} />

      {!data ? (
        query.error ? (
          <Txt tone="warning">{errorMessage(query.error, t('common.error'), t('common.offline'))}</Txt>
        ) : (
          <Skeleton width="100%" height={300} radius={Radius.xl} />
        )
      ) : (
        <Cards data={data} hideCalories={hideCalories} today={today} />
      )}
    </ScrollView>
  );
}

/** Nothing logged over the period yet: what will show up here, the goal it will follow, and the way to start. */
function FirstDays({ hero }: { hero: NutrientKey }) {
  const { t, locale, nutrient } = useI18n();
  const { colors } = useTheme();
  const rule = useUser().plan?.rules.find((r) => r.nutrient === hero);
  return (
    <Card style={{ gap: Space.lg, alignItems: 'flex-start' }}>
      <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
        <ChartNoAxesColumn size={22} color={colors.accent} />
      </View>
      <View style={{ gap: Space.sm }}>
        <Txt variant="heading">{t('insights.firstTitle')}</Txt>
        <Txt tone="secondary">
          {t('review.first')}
          {rule ? ` ${t('insights.firstRule', { rule: `${nutrient(hero)} ${rule.kind === 'max' ? '≤' : '≥'} ${formatAmount(hero, rule.value, locale)}` })}` : ''}
        </Txt>
      </View>
      <Button title={t('insights.firstCta')} size="md" icon={<Camera size={18} color={colors.onInverted} />} onPress={() => router.push('/capture')} />
    </Card>
  );
}

function Cards({ data, hideCalories, today }: { data: InsightsResponse; hideCalories: boolean; today: string }) {
  const { t } = useI18n();
  const user = useUser();
  const plan = user.plan;
  const hero = data.hero ?? goalNutrient(plan, hideCalories);
  const logged = data.loggedDays > 0;

  // Body: weight when it's the goal or when there are weigh-ins; blood pressure when tracked; the
  // measured expenditure only for weight goals, or once enough weigh-ins make it meaningful.
  const weightGoal = Boolean(plan && (plan.calorieMode !== 'maintain' || plan.tags.some((tag) => tag === 'lose_weight' || tag === 'gain_muscle')));
  const showWeight = weightGoal || data.weight.latest !== null;
  const trackBp = user.profile?.trackBloodPressure === true;
  const adaptive = data.adaptiveEnergy && !hideCalories && (weightGoal || data.adaptiveEnergy.missing.weighIns === 0) ? data.adaptiveEnergy : null;

  // « Ta vie »: one row per module that is on and has something to show.
  const sleep = data.sleep && data.sleep.nights.length ? data.sleep : null;
  const water = data.hydration && data.hydration.daysLogged ? data.hydration : null;
  const mood = data.mood && (moodDaysIn(data.mood, data.from).length || data.mood.persistentLow) ? data.mood : null;

  return (
    <Animated.View entering={FadeIn.duration(260)} style={{ gap: Space.lg }}>
      {logged ? <GoalCard data={data} hero={hero} hideCalories={hideCalories} /> : <FirstDays hero={hero} />}

      {logged ? <SourcesCard data={data} hero={hero} /> : null}

      {showWeight || trackBp || adaptive ? (
        <BodyCard weight={showWeight ? data.weight : null} bloodPressure={trackBp ? (data.bloodPressure ?? null) : undefined} adaptive={adaptive} plan={plan} from={data.from} to={data.to} />
      ) : null}

      {hasActivity(data.activity) ? <ActivityCard activity={data.activity} /> : null}

      {sleep || water || mood ? (
        <RowsCard title={t('insights.life')}>
          {sleep ? <SleepTrendRow first trend={sleep} dates={data.days.map((d) => d.date)} /> : null}
          {water ? <WaterTrendRow first={!sleep} trend={water} today={today} /> : null}
          {mood ? <MoodTrendRow first={!sleep && !water} trend={mood} from={data.from} to={data.to} /> : null}
        </RowsCard>
      ) : null}
    </Animated.View>
  );
}
