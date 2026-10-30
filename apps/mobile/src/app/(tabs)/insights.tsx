import type { NutrientKey } from '@symbiose/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Flame, Sparkles } from 'lucide-react-native';
import { useState } from 'react';
import { Platform, RefreshControl, ScrollView, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActivityCard } from '@/components/insights/activity-card';
import { DayBars, HourBars } from '@/components/insights/charts';
import { WeightCard } from '@/components/insights/weight-card';
import { Bar, Button, Card, Dot, Row, SectionTitle, Segmented, Skeleton, Txt } from '@/components/ui';
import { useI18n } from '@/i18n';
import { formatAmount, formatNumber, weekdayInitial } from '@/lib/format';
import { errorMessage, useToday } from '@/lib/hooks';
import { useApi, useUser } from '@/lib/session';
import { useSettings } from '@/lib/stores';
import { NUTRIENT_COLORS, Radius, Space, useTheme } from '@/theme';

export default function Insights() {
  const { t, locale, nutrient } = useI18n();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const user = useUser();
  const today = useToday();
  const hideCalories = useSettings((s) => s.hideCalories);
  const [range, setRange] = useState<'7' | '30'>('7');
  const days = Number(range);
  const query = useQuery({ queryKey: ['insights', days, today], queryFn: () => api.insights(days, today) });
  const review = useMutation({ mutationFn: () => api.review(days, today) });
  const data = query.data;

  const primary = data?.focus[0] ?? 'kcal';
  const primaryAdherence = data?.adherence.find((a) => a.nutrient === primary);
  // Weight comes first when the goals are about body weight.
  const weightFirst = Boolean(user.plan && user.plan.calorieMode !== 'maintain');
  // Same for activity, which also matters for muscle.
  const activityFirst = weightFirst || Boolean(user.plan?.tags.some((tag) => tag === 'lose_weight' || tag === 'gain_muscle'));

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} />}
      contentContainerStyle={{ paddingTop: (Platform.OS === 'ios' ? 0 : insets.top) + Space.md, paddingHorizontal: Space.lg, paddingBottom: insets.bottom + 120, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
      <Row style={{ justifyContent: 'space-between', paddingHorizontal: 4, marginBottom: Space.lg }}>
        <Txt variant="title">{t('insights.title')}</Txt>
        <Segmented
          value={range}
          onChange={(v) => {
            setRange(v);
            review.reset();
          }}
          options={[
            { value: '7', label: t('insights.week') },
            { value: '30', label: t('insights.month') },
          ]}
        />
      </Row>

      {!data ? (
        query.error ? (
          <Txt tone="warning">{errorMessage(query.error, t('common.error'), t('common.offline'))}</Txt>
        ) : (
          <View style={{ gap: Space.lg }}>
            <Skeleton width="100%" height={220} radius={Radius.xl} />
            <Skeleton width="100%" height={160} radius={Radius.xl} />
          </View>
        )
      ) : data.loggedDays === 0 ? (
        <Card style={{ alignItems: 'center', gap: Space.sm, paddingVertical: Space.xxxl }}>
          <Txt style={{ fontSize: 36 }}>📈</Txt>
          <Txt tone="secondary" style={{ textAlign: 'center' }}>
            {t('insights.empty')}
          </Txt>
        </Card>
      ) : (
        <Animated.View entering={FadeIn} style={{ gap: Space.lg }}>
          <Card style={{ gap: Space.lg }}>
            <View style={{ gap: 2 }}>
              <Row gap={6}>
                <Dot color={primary === 'kcal' ? colors.accent : NUTRIENT_COLORS[primary]} />
                <Txt variant="label" tone="secondary" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {nutrient(primary)} · {t('insights.average').toLowerCase()}
                </Txt>
              </Row>
              <Txt variant="display" style={{ fontSize: 40 }}>
                {formatAmount(primary, data.averages[primary], locale)}
              </Txt>
              <Row gap={Space.md}>
                <Txt variant="caption" tone="secondary">
                  {t('insights.logged', { count: data.loggedDays })}
                </Txt>
                {data.streak > 0 ? (
                  <Row gap={4}>
                    <Flame size={13} color={colors.warning} fill={colors.warning} />
                    <Txt variant="caption" tone="secondary">
                      {t('today.streak', { count: data.streak })}
                    </Txt>
                  </Row>
                ) : null}
              </Row>
            </View>
            <DayBars
              values={data.days.map((d) => (d.logged ? d.totals[primary] : null))}
              labels={data.days.map((d) => weekdayInitial(d.date, locale))}
              target={primaryAdherence?.target ?? (primary === 'kcal' ? (data.days.at(-1)?.kcalTarget ?? 2000) : 0)}
              kind={primaryAdherence?.kind ?? 'target'}
              color={primary === 'kcal' ? colors.accent : NUTRIENT_COLORS[primary]}
            />
            {!hideCalories && primary !== 'kcal' ? (
              <Txt variant="caption" tone="secondary">
                {formatNumber(data.averages.kcal, locale)} kcal · {formatAmount('protein', data.averages.protein, locale)} {nutrient('protein').toLowerCase()} · {formatAmount('fiber', data.averages.fiber, locale)}{' '}
                {nutrient('fiber').toLowerCase()}
              </Txt>
            ) : null}
          </Card>

          {weightFirst ? <WeightCard weight={data.weight} plan={user.plan} /> : null}
          {activityFirst && data.activity ? <ActivityCard activity={data.activity} /> : null}

          {data.adherence.length ? (
            <>
              <SectionTitle>{t('insights.adherence')}</SectionTitle>
              <Card style={{ gap: Space.lg, marginTop: -Space.sm }}>
                {data.adherence.map((a) => (
                  <View key={a.nutrient} style={{ gap: 8 }}>
                    <Row style={{ justifyContent: 'space-between' }}>
                      <Row gap={8}>
                        <Dot color={NUTRIENT_COLORS[a.nutrient]} />
                        <Txt variant="label">
                          {nutrient(a.nutrient)} {a.kind === 'max' ? '≤' : a.kind === 'min' ? '≥' : '≈'} {formatAmount(a.nutrient, a.target, locale)}
                        </Txt>
                      </Row>
                      <Txt variant="caption" tone="secondary">
                        {t('insights.daysOk', { ok: a.daysOk, total: a.daysLogged })}
                      </Txt>
                    </Row>
                    <Bar progress={a.daysLogged ? a.daysOk / a.daysLogged : 0} color={NUTRIENT_COLORS[a.nutrient]} />
                  </View>
                ))}
              </Card>
            </>
          ) : null}

          {(Object.entries(data.topSources) as [NutrientKey, (typeof data.topSources)[NutrientKey]][]).map(([key, sources]) =>
            sources && sources.length ? (
              <View key={key}>
                <SectionTitle>
                  {t('insights.sources')} · {nutrient(key).toLowerCase()}
                </SectionTitle>
                <Card style={{ gap: Space.md, marginTop: -Space.sm }}>
                  {sources.map((s) => (
                    <View key={s.name} style={{ gap: 6 }}>
                      <Row style={{ justifyContent: 'space-between' }}>
                        <Txt variant="label" numberOfLines={1} style={{ flex: 1 }}>
                          {s.emoji} {s.name} <Txt variant="caption" tone="tertiary">×{s.count}</Txt>
                        </Txt>
                        <Txt variant="label" tone="secondary">
                          {formatAmount(key, s.amount, locale)}
                        </Txt>
                      </Row>
                      <Bar progress={s.amount / (sources[0]?.amount || 1)} color={NUTRIENT_COLORS[key]} height={6} />
                    </View>
                  ))}
                </Card>
              </View>
            ) : null,
          )}

          {data.byHour.hours.some((h) => h > 0) ? (
            <>
              <SectionTitle>
                {t('insights.when')} · {nutrient(data.byHour.nutrient).toLowerCase()}
              </SectionTitle>
              <Card style={{ marginTop: -Space.sm }}>
                <HourBars hours={data.byHour.hours} color={data.byHour.nutrient === 'kcal' ? colors.accent : NUTRIENT_COLORS[data.byHour.nutrient]} />
              </Card>
            </>
          ) : null}

          {data.cravings.total > 0 ? (
            <Card style={{ gap: 4 }}>
              <Txt variant="overline" tone="secondary">
                {t('insights.cravings')}
              </Txt>
              <Txt variant="number">{t('insights.cravingsBody', { resisted: data.cravings.resisted, total: data.cravings.total })}</Txt>
              {data.cravings.topWhat.length ? (
                <Txt variant="caption" tone="tertiary">
                  {data.cravings.topWhat.join(' · ')}
                </Txt>
              ) : null}
            </Card>
          ) : null}

          {!weightFirst ? <WeightCard weight={data.weight} plan={user.plan} /> : null}
          {!activityFirst && data.activity ? <ActivityCard activity={data.activity} /> : null}

          <SectionTitle>{t('insights.review')}</SectionTitle>
          <Card style={{ gap: Space.lg, marginTop: -Space.sm }}>
            {review.data ? (
              <Animated.View entering={FadeIn} style={{ gap: Space.lg }}>
                <Txt variant="heading" style={{ lineHeight: 26 }}>
                  {review.data.headline}
                </Txt>
                <ReviewList title={t('insights.wins')} items={review.data.wins} color={colors.accent} />
                <ReviewList title={t('insights.patterns')} items={review.data.patterns} color={colors.warning} />
                <ReviewList title={t('insights.next')} items={review.data.nextSteps} color={NUTRIENT_COLORS.fat} />
              </Animated.View>
            ) : (
              <>
                {review.error ? (
                  <Txt variant="caption" tone="warning">
                    {errorMessage(review.error, t('common.error'), t('common.offline'))}
                  </Txt>
                ) : null}
                <Button
                  title={review.isPending ? t('insights.reviewing') : t('insights.reviewCta')}
                  icon={<Sparkles size={18} color={colors.onInverted} />}
                  loading={review.isPending}
                  onPress={() => review.mutate()}
                />
              </>
            )}
          </Card>
        </Animated.View>
      )}
    </ScrollView>
  );
}

function ReviewList({ title, items, color }: { title: string; items: string[]; color: string }) {
  if (!items.length) return null;
  return (
    <View style={{ gap: Space.sm }}>
      <Txt variant="overline" tone="secondary">
        {title}
      </Txt>
      {items.map((item) => (
        <Row key={item} gap={Space.md} style={{ alignItems: 'flex-start' }}>
          <View style={{ marginTop: 7 }}>
            <Dot color={color} />
          </View>
          <Txt style={{ flex: 1 }}>{item}</Txt>
        </Row>
      ))}
    </View>
  );
}
