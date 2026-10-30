import type { Locale, Review, WeeklyReviewState } from '@symbiose/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ArrowRight, Check, ChevronRight, CircleAlert, RefreshCw, Sparkles } from 'lucide-react-native';
import { useEffect, type ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { Card, Pressy, Row, Skeleton, Txt } from '@/components/ui';
import { useI18n } from '@/i18n';
import { ApiError } from '@/lib/api';
import { formatAmount } from '@/lib/format';
import { haptics } from '@/lib/haptics';
import { errorMessage } from '@/lib/hooks';
import { useApi } from '@/lib/session';
import { NUTRIENT_COLORS, Radius, Space, useTheme } from '@/theme';

/** « 24 – 30 oct. », « 28 sept. – 4 oct. »; « Oct 24 – 30 » in English. */
function weekLabel(from: string, to: string, locale: Locale): string {
  const withMonth = (localDate: string) => {
    const [y, m, d] = localDate.split('-').map(Number) as [number, number, number];
    return new Date(y, m - 1, d).toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-US', { day: 'numeric', month: 'short' });
  };
  const day = (localDate: string) => String(Number(localDate.slice(8)));
  if (from.slice(0, 7) !== to.slice(0, 7)) return `${withMonth(from)} – ${withMonth(to)}`;
  return locale === 'fr' ? `${day(from)} – ${withMonth(to)}` : `${withMonth(from)} – ${day(to)}`;
}

/**
 * « Bilan de la semaine », first on Tendances: saved on the server, so it stays across tabs and
 * ranges. Written on open when missing or when a new week has new meals, otherwise on demand.
 */
export function ReviewCard({ today, hideCalories }: { today: string; hideCalories: boolean }) {
  const { t, plural, locale, nutrient } = useI18n();
  const { colors } = useTheme();
  const api = useApi();
  const queryClient = useQueryClient();
  const key = ['weekly-review', today, hideCalories];
  const state = useQuery({ queryKey: key, queryFn: () => api.weeklyReview(today, hideCalories), retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2 });
  // Servers from before the saved review: the review is only written on demand.
  const legacy = state.error instanceof ApiError && state.error.status === 404;

  const write = useMutation({
    mutationFn: () => api.review(today),
    onSuccess: (review) => {
      queryClient.setQueryData<WeeklyReviewState>(key, (old) =>
        old ? { ...old, status: 'fresh', review: { ...review, from: review.from ?? old.week.from, to: review.to ?? today, generatedAt: review.generatedAt ?? new Date().toISOString() } } : old,
      );
      haptics.soft();
    },
  });

  // Missing, or a new week with new meals: write it now, once (a failure waits for a tap).
  const due = state.data?.status === 'due';
  useEffect(() => {
    if (due && write.isIdle) write.mutate();
  }, [due, write]);

  const review: Review | null = state.data?.review ?? (legacy ? (write.data ?? null) : null);
  const range = state.data?.review ? weekLabel(state.data.review.from, state.data.review.to, locale) : null;
  const canWrite = legacy || (state.data?.ai ?? false);

  if (state.isPending) return <Skeleton width="100%" height={150} radius={Radius.xl} />;

  if (review) {
    const bullets: { key: string; text: string | undefined; icon: ReactNode }[] = [
      { key: 'win', text: review.wins[0], icon: <Check size={15} color={colors.accent} strokeWidth={2.5} /> },
      { key: 'pattern', text: review.patterns[0], icon: <CircleAlert size={15} color={colors.warning} strokeWidth={2.5} /> },
      { key: 'next', text: review.nextSteps[0], icon: <ArrowRight size={15} color={NUTRIENT_COLORS.fat} strokeWidth={2.5} /> },
    ];
    const refreshing = write.isPending;
    return (
      <Card style={{ gap: Space.lg }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Row gap={6} style={{ flexShrink: 1 }}>
            <Sparkles size={14} color={colors.accent} />
            <Txt variant="label" tone="secondary" numberOfLines={1} style={{ flexShrink: 1 }}>
              {t('insights.review')}
              {range ? ` · ${range}` : ''}
            </Txt>
          </Row>
          {refreshing ? (
            <ActivityIndicator size="small" color={colors.text3} />
          ) : state.data?.status === 'stale' && canWrite ? (
            <Pressy onPress={() => write.mutate()} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('review.refresh')} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <RefreshCw size={13} color={colors.text2} />
              <Txt variant="caption" tone="secondary">
                {t('review.refresh')}
              </Txt>
            </Pressy>
          ) : null}
        </Row>
        <Animated.View key={review.headline} entering={FadeIn.duration(320)} style={{ gap: Space.md, opacity: refreshing ? 0.55 : 1 }}>
          <Txt variant="accent" style={{ fontSize: 22, lineHeight: 28 }}>
            {review.headline}
          </Txt>
          {bullets.map((bullet) =>
            bullet.text ? (
              <Row key={bullet.key} gap={Space.md} style={{ alignItems: 'flex-start' }}>
                <View style={{ marginTop: 2 }}>{bullet.icon}</View>
                <Txt style={{ flex: 1, fontSize: 15, lineHeight: 21 }}>{bullet.text}</Txt>
              </Row>
            ) : null,
          )}
        </Animated.View>
        <Pressy
          onPress={() => router.push({ pathname: '/coach', params: { prompt: t('review.prompt', { headline: review.headline }) } })}
          accessibilityRole="button"
          style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, height: 36, paddingHorizontal: 14, borderRadius: Radius.pill, backgroundColor: colors.surface2 }}>
          <Txt variant="label">{t('review.askCoach')}</Txt>
          <ChevronRight size={16} color={colors.text2} />
        </Pressy>
        {write.error ? (
          <Txt variant="caption" tone="warning">
            {errorMessage(write.error, t('common.error'), t('common.offline'))}
          </Txt>
        ) : null}
      </Card>
    );
  }

  // No review yet: one calm line about the week, and the way to write it.
  const week = state.data?.week;
  const summary = (() => {
    if (!week || week.loggedDays === 0) return t('review.first');
    const a = week.adherence;
    if (!a || a.daysLogged === 0) return t('review.average', { amount: formatAmount(week.nutrient, week.average, locale), nutrient: nutrient(week.nutrient).toLowerCase() });
    return plural(`review.${a.kind}`, a.daysOk, { ok: a.daysOk, total: a.daysLogged, target: formatAmount(week.nutrient, a.target, locale) });
  })();
  const writing = write.isPending;
  const offer = canWrite && !writing && (legacy || (week?.loggedDays ?? 0) > 0);
  const problem = write.error ?? (legacy ? null : state.error);

  return (
    <View style={{ gap: Space.sm, paddingVertical: Space.md, paddingHorizontal: Space.lg, borderRadius: Radius.lg, backgroundColor: colors.surface2 }}>
      <Row gap={Space.md} style={{ alignItems: 'flex-start' }}>
        {writing ? <ActivityIndicator size="small" color={colors.accent} style={{ marginTop: 1 }} /> : <Sparkles size={16} color={colors.text2} style={{ marginTop: 1 }} />}
        <Txt variant="caption" tone="secondary" style={{ flex: 1, fontSize: 14, lineHeight: 20 }}>
          {writing ? t('insights.reviewing') : summary}
        </Txt>
      </Row>
      {problem ? (
        <Txt variant="caption" tone="warning" style={{ marginLeft: 28 }}>
          {errorMessage(problem, t('common.error'), t('common.offline'))}
        </Txt>
      ) : null}
      {offer ? (
        <Pressy onPress={() => write.mutate()} accessibilityRole="button" hitSlop={8} style={{ marginLeft: 28, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          <Txt variant="label" tone="accent">
            {t('review.generate')}
          </Txt>
          <ChevronRight size={15} color={colors.accent} />
        </Pressy>
      ) : null}
    </View>
  );
}
