import type { AdminRequest } from '@symbiose/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, X } from 'lucide-react-native';
import { Alert, Platform, View } from 'react-native';
import Animated, { FadeOut, LinearTransition } from 'react-native-reanimated';

import { formatShortDate } from '@/components/admin/format';
import { CardTitle } from '@/components/admin/parts';
import { Card, IconButton, Pressy, Row, Txt } from '@/components/ui';
import { useI18n } from '@/i18n';
import { haptics } from '@/lib/haptics';
import { useApi } from '@/lib/session';
import { useToast } from '@/lib/stores';
import { Space, useTheme } from '@/theme';

/** Asks before acting: a sheet on phones, the browser's confirm on the web. */
function confirm({ title, message, action, cancel, destructive }: { title: string; message: string; action: string; cancel: string; destructive: boolean }, run: () => void) {
  if (Platform.OS === 'web') {
    if (globalThis.confirm?.(`${title}\n\n${message}`)) run();
    return;
  }
  Alert.alert(title, message, [
    { text: cancel, style: 'cancel' },
    { text: action, style: destructive ? 'destructive' : 'default', onPress: run },
  ]);
}

/**
 * « Demandes »: who waits to get in, with only what it takes to decide (email, first name, date).
 * Each one is accepted or refused after a confirmation; refusing deletes the waiting account.
 */
export function RequestsCard({ requests }: { requests: AdminRequest[] }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const api = useApi();
  const queryClient = useQueryClient();
  const showToast = useToast((s) => s.show);
  const answer = useMutation({
    mutationFn: ({ request, accept }: { request: AdminRequest; accept: boolean }) => (accept ? api.approveRequest(request.id) : api.refuseRequest(request.id)),
    onSuccess: (_, { request, accept }) => {
      haptics.success();
      showToast({ message: accept ? t('admin.accepted', { who: request.name || request.email }) : t('admin.refused') });
      void queryClient.invalidateQueries({ queryKey: ['admin-requests'] });
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: () => haptics.warning(),
  });

  const ask = (request: AdminRequest, accept: boolean) => {
    const who = request.name || request.email;
    const action = accept ? t('admin.accept') : t('admin.refuse');
    const message = accept ? t('admin.acceptConfirm', { who }) : t('admin.refuseConfirm', { who });
    confirm({ title: action, message, action, cancel: t('common.cancel'), destructive: !accept }, () => answer.mutate({ request, accept }));
  };

  return (
    <Card style={{ gap: Space.sm, paddingBottom: Space.md }}>
      <CardTitle color={colors.warning} label={t('admin.requests')} right={String(requests.length)} />
      {requests.map((request, i) => {
        const busy = answer.isPending && answer.variables.request.id === request.id;
        const who = request.name || request.email;
        return (
          <Animated.View key={request.id} exiting={FadeOut.duration(160)} layout={LinearTransition.duration(220)}>
            <Row gap={Space.md} style={[{ paddingVertical: Space.md }, i ? { borderTopWidth: 1, borderTopColor: colors.border } : null, busy ? { opacity: 0.5 } : null]}>
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }}>
                <Txt variant="label">{who.slice(0, 1).toUpperCase()}</Txt>
              </View>
              <View style={{ flex: 1, gap: 1 }}>
                <Row gap={6}>
                  <Txt variant="label" numberOfLines={1} style={{ fontSize: 15, flexShrink: 1 }}>
                    {who}
                  </Txt>
                  <Txt variant="caption" tone="tertiary" numberOfLines={1}>
                    {t('admin.requestedOn', { date: formatShortDate(request.requestedAt, locale) })}
                  </Txt>
                </Row>
                {request.name ? (
                  <Txt variant="caption" tone="secondary" numberOfLines={1}>
                    {request.email}
                  </Txt>
                ) : null}
              </View>
              <IconButton label={`${t('admin.refuse')} ${who}`} size={38} icon={<X size={17} color={colors.text} />} onPress={() => ask(request, false)} />
              <Pressy
                onPress={() => ask(request, true)}
                disabled={busy}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`${t('admin.accept')} ${who}`}
                style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
                <Check size={18} color={colors.onAccent} />
              </Pressy>
            </Row>
          </Animated.View>
        );
      })}
    </Card>
  );
}
