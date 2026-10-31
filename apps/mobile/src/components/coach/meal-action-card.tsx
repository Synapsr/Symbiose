import type { CoachMealAction, CoachMealActionKind, CoachMessage } from '@symbiose/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Check, ChevronRight, PenLine, Plus, Trash2, type LucideIcon } from 'lucide-react-native';
import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { FadeIn, FadeInUp, FadeOut, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Button, Pressy, Row, Txt } from '@/components/ui';
import { useI18n, type TranslationKey } from '@/i18n';
import { feedback } from '@/lib/feedback';
import { haptics } from '@/lib/haptics';
import { errorMessage } from '@/lib/hooks';
import { useApi } from '@/lib/session';
import { Radius, Space, useTheme } from '@/theme';

const KINDS: Record<CoachMealActionKind, { label: TranslationKey; done: TranslationKey; Icon: LucideIcon }> = {
  add: { label: 'coach.mealAdd', done: 'coach.mealAdded', Icon: Plus },
  edit: { label: 'coach.mealEdit', done: 'coach.mealEdited', Icon: PenLine },
  delete: { label: 'coach.mealDelete', done: 'coach.mealDeleted', Icon: Trash2 },
};

/** The footer keeps one height in every state, so the card never jumps. */
const FOOTER_HEIGHT = 44;

/**
 * A meal the coach proposed to add, edit or delete. Nothing changes until the
 * person confirms here; for a delete, this button is the only confirmation.
 */
export function MealActionCard({ messageId, index, action }: { messageId: string; index: number; action: CoachMealAction }) {
  const api = useApi();
  const { t } = useI18n();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const { label, done, Icon } = KINDS[action.action];

  const replaceMessage = (message: CoachMessage) =>
    queryClient.setQueryData<CoachMessage[]>(['coach'], (old = []) => old.map((m) => (m.id === message.id ? message : m)));

  const apply = useMutation({
    mutationFn: () => api.applyCoachMealAction(messageId, index),
    onSuccess: ({ message, meal }) => {
      // A meal added through the coach is a meal logged; an edit or a delete just gets its haptic.
      if (action.action === 'add' && meal) feedback.mealLogged(meal);
      else haptics.success();
      replaceMessage(message);
      if (meal) queryClient.setQueryData(['meal', meal.id], meal);
      else if (action.mealId) queryClient.removeQueries({ queryKey: ['meal', action.mealId] });
      // An edit can move a meal to another day: refresh them all.
      void queryClient.invalidateQueries({ queryKey: ['day'] });
      void queryClient.invalidateQueries({ queryKey: ['insights'] });
      void queryClient.invalidateQueries({ queryKey: ['library'] });
    },
    onError: () => haptics.warning(),
  });
  const dismiss = useMutation({
    mutationFn: () => api.dismissCoachMealAction(messageId, index),
    onSuccess: replaceMessage,
    onError: () => haptics.warning(),
  });

  // Dismissing shows at once; a failure brings the buttons back with the error.
  const status = dismiss.isPending ? 'dismissed' : action.status;
  const error = apply.error ?? dismiss.error;

  const muted = useSharedValue(status === 'dismissed' ? 1 : 0);
  useEffect(() => {
    muted.set(withTiming(status === 'dismissed' ? 1 : 0, { duration: 250 }));
  }, [status, muted]);
  const mutedStyle = useAnimatedStyle(() => ({ opacity: 1 - muted.value * 0.45 }));

  // The entrance runs on a wrapper: a layout animation would fight the muted opacity.
  return (
    <Animated.View entering={FadeInUp.duration(220).delay(80 + index * 60)} style={{ width: '86%' }}>
      <Animated.View
        style={[{ backgroundColor: colors.accentSoft, borderRadius: Radius.lg, borderCurve: 'continuous', padding: Space.lg, paddingBottom: Space.md, gap: Space.sm }, mutedStyle]}>
        <Row gap={Space.sm}>
          <Icon size={16} color={colors.accentText} />
          <Txt variant="label" tone="accent">
            {t(label)}
          </Txt>
        </Row>
        <Txt variant="caption" tone="secondary">
          {action.summary}
        </Txt>
        <View style={{ height: FOOTER_HEIGHT }}>
          {/* Keyed by state: the old one is mostly gone before the new one shows, no muddled overlap. */}
          <Animated.View
            key={status}
            entering={FadeIn.duration(200).delay(90)}
            exiting={FadeOut.duration(120)}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: Space.sm }}>
            {status === 'proposed' ? (
              <>
                <Button
                  title={action.action === 'delete' ? t('common.delete') : t('coach.mealConfirm')}
                  size="md"
                  variant={action.action === 'delete' ? 'danger' : 'accent'}
                  loading={apply.isPending}
                  onPress={() => apply.mutate()}
                  style={{ flex: 1 }}
                />
                {/* Stays in place while applying (no layout shift), just inert. */}
                <Button
                  title={t('coach.mealNoThanks')}
                  size="md"
                  variant="ghost"
                  onPress={() => !apply.isPending && dismiss.mutate()}
                  style={apply.isPending ? { opacity: 0.4 } : null}
                />
              </>
            ) : status === 'applied' ? (
              <>
                <Check size={18} color={colors.accentText} strokeWidth={2.5} />
                <Txt variant="label" tone="accent" style={{ flex: 1 }}>
                  {t(done)}
                </Txt>
                {action.resultMealId ? (
                  <Pressy
                    accessibilityRole="link"
                    hitSlop={8}
                    onPress={() => router.push({ pathname: '/meal/[id]', params: { id: action.resultMealId! } })}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 2, height: 32, paddingLeft: Space.md, paddingRight: Space.sm, borderRadius: Radius.pill, backgroundColor: colors.surface }}>
                    <Txt variant="label">{t('coach.mealView')}</Txt>
                    <ChevronRight size={16} color={colors.text2} />
                  </Pressy>
                ) : null}
              </>
            ) : (
              <Txt variant="label" tone="secondary">
                {t('coach.mealDismissed')}
              </Txt>
            )}
          </Animated.View>
        </View>
        {error ? (
          <Animated.View entering={FadeIn.duration(200)}>
            <Txt variant="caption" tone="warning">
              {errorMessage(error, t('common.error'), t('common.offline'))}
            </Txt>
          </Animated.View>
        ) : null}
      </Animated.View>
    </Animated.View>
  );
}
