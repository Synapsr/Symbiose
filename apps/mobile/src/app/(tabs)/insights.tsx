import { goalNutrient, type InsightsResponse } from '@symbiose/shared';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Camera } from 'lucide-react-native';
import { useState } from 'react';
import { Platform, RefreshControl, ScrollView } from 'react-native';
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
import { Pressy, Row, Segmented, Skeleton, Txt } from '@/components/ui';
import { useI18n } from '@/i18n';
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

function Cards({ data, hideCalories, today }: { data: InsightsResponse; hideCalories: boolean; today: string }) {
  const { t } = useI18n();
  const { colors } = useTheme();
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
      {logged ? (
        <GoalCard data={data} hero={hero} hideCalories={hideCalories} />
      ) : (
        <Pressy
          onPress={() => router.push('/capture')}
          style={{ flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingVertical: Space.md, paddingHorizontal: Space.lg, borderRadius: Radius.lg, backgroundColor: colors.surface2 }}>
          <Camera size={16} color={colors.text2} />
          <Txt variant="caption" tone="secondary" style={{ flex: 1, fontSize: 14 }}>
            {t('insights.empty')}
          </Txt>
        </Pressy>
      )}

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
