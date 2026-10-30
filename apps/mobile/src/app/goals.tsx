import type { GoalsResponse } from '@symbiose/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { Sparkles, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GoalComposer } from '@/components/goal-composer';
import { PlanPreview } from '@/components/plan-preview';
import { Button, IconButton, Row, Txt } from '@/components/ui';
import { dismiss } from '@/lib/nav';
import { useI18n } from '@/i18n';
import { haptics } from '@/lib/haptics';
import { errorMessage } from '@/lib/hooks';
import { useApi, useSetUser, useUser } from '@/lib/session';
import { Space, useTheme } from '@/theme';

/** Rewrite your goals in your own words; the AI re-plans, you confirm. */
export default function Goals() {
  const params = useLocalSearchParams<{ intentions?: string }>();
  const { t } = useI18n();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const user = useUser();
  const setUser = useSetUser();
  const queryClient = useQueryClient();
  const [intentions, setIntentions] = useState(params.intentions ?? user.plan?.intentions ?? '');
  const [draft, setDraft] = useState<(GoalsResponse & { aiGenerated: boolean }) | null>(null);

  const plan = useMutation({
    mutationFn: () => api.draftGoals(intentions.trim()),
    onSuccess: (res) => {
      haptics.success();
      setDraft(res);
    },
  });
  const save = useMutation({
    mutationFn: async () => {
      await api.saveGoals(draft!.plan!);
      return api.me();
    },
    onSuccess: (saved) => {
      haptics.success();
      setUser(saved);
      void queryClient.invalidateQueries({ queryKey: ['day'] });
      void queryClient.invalidateQueries({ queryKey: ['insights'] });
      dismiss();
    },
  });

  // Coming from the coach with a suggestion: plan right away.
  useEffect(() => {
    if (params.intentions) plan.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const error = plan.error ?? save.error;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Row style={{ justifyContent: 'space-between', padding: Space.lg, paddingTop: (Platform.OS === 'ios' ? 0 : insets.top) + Space.lg }}>
        <Txt variant="heading">{t('me.editGoals')}</Txt>
        <IconButton label={t('common.close')} icon={<X size={20} color={colors.text} />} onPress={() => dismiss()} />
      </Row>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: Space.xl, paddingTop: 0, gap: Space.xxl, paddingBottom: insets.bottom + Space.xxxl, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
        {draft?.plan && draft.targets && draft.energy ? (
          <PlanPreview plan={draft.plan} targets={draft.targets} energy={draft.energy} aiGenerated={draft.aiGenerated} />
        ) : (
          <GoalComposer value={intentions} onChange={setIntentions} />
        )}
        {error ? (
          <Txt variant="caption" tone="warning">
            {errorMessage(error, t('common.error'), t('common.offline'))}
          </Txt>
        ) : null}
        <View style={{ gap: Space.sm }}>
          {draft ? (
            <>
              <Button title={t('common.save')} onPress={() => save.mutate()} loading={save.isPending} />
              <Button title={t('onb.plan.adjust')} variant="ghost" onPress={() => setDraft(null)} />
            </>
          ) : (
            <Button
              title={plan.isPending ? t('onb.goals.generating') : t('onb.goals.generate')}
              icon={<Sparkles size={18} color={colors.onInverted} />}
              onPress={() => plan.mutate()}
              loading={plan.isPending}
              disabled={intentions.trim().length < 3}
            />
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
