import type { User } from '@symbiose/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, Platform, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Reveal, Txt } from '@/components/ui';
import { Logo } from '@/components/ui/logo';
import { useI18n } from '@/i18n';
import { haptics } from '@/lib/haptics';
import { useApi, useSession } from '@/lib/session';
import { useSettings } from '@/lib/stores';
import { Space, useTheme } from '@/theme';

/**
 * Sign-up on request, after the onboarding: one calm screen while an admin decides. A pull or
 * « Vérifier » asks again; once approved, the onboarding resumes with the plan.
 */
export function PendingPanel() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const { session, signOut } = useSession();
  const queryClient = useQueryClient();
  const setSettings = useSettings((s) => s.set);

  // Through the session's own query: a refused request (the account is gone) signs out with its message.
  const check = useMutation({
    mutationFn: async () => {
      const key = ['me', session?.serverUrl, session?.token];
      await queryClient.refetchQueries({ queryKey: key, exact: true });
      const state = queryClient.getQueryState<User>(key);
      return state?.status === 'success' ? state.data : undefined;
    },
    onSuccess: (user) => (user?.pending ? haptics.soft() : haptics.success()),
  });

  // Asked again and still waiting: said quietly under the text, nothing pops up.
  const still = check.isSuccess && check.data?.pending === true;

  const remove = () => {
    const run = async () => {
      await api.deleteAccount();
      setSettings({ waitingIntentions: '' });
      await signOut();
    };
    if (Platform.OS === 'web') {
      if (globalThis.confirm?.(t('admin.pending.deleteConfirm'))) void run();
      return;
    }
    Alert.alert(t('admin.pending.delete'), t('admin.pending.deleteConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => void run() },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={check.isPending} onRefresh={() => check.mutate()} />}
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: Space.xxl, paddingTop: insets.top + Space.xxl, gap: Space.xxl, maxWidth: 520, width: '100%', alignSelf: 'center' }}>
        <Reveal index={0} style={{ alignItems: 'center' }}>
          <Logo size={72} breathe />
        </Reveal>
        <Reveal index={1} style={{ gap: Space.md }}>
          <Txt variant="title" style={{ textAlign: 'center' }}>
            {t('admin.pending.title')}
          </Txt>
          <Txt tone="secondary" style={{ textAlign: 'center', fontSize: 17, lineHeight: 24 }}>
            {t('admin.pending.body')}
          </Txt>
          <Txt variant="caption" tone={still ? 'secondary' : 'tertiary'} style={{ textAlign: 'center' }}>
            {still ? t('admin.pending.still') : session?.serverUrl.replace(/^https?:\/\//, '')}
          </Txt>
        </Reveal>
      </ScrollView>
      <Reveal index={2} style={{ padding: Space.xl, paddingBottom: insets.bottom + Space.lg, gap: Space.sm, maxWidth: 520, width: '100%', alignSelf: 'center' }}>
        <Button title={t('admin.pending.check')} variant="secondary" onPress={() => check.mutate()} loading={check.isPending} />
        <Button title={t('admin.pending.delete')} variant="ghost" onPress={remove} />
      </Reveal>
    </View>
  );
}
