import type { AdminPeriod } from '@symbiose/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Lock, X } from 'lucide-react-native';
import { useState } from 'react';
import { Platform, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AiCard } from '@/components/admin/ai-card';
import { RequestsCard } from '@/components/admin/requests-card';
import { SystemCard } from '@/components/admin/system-card';
import { UsageCard } from '@/components/admin/usage-card';
import { IconButton, Reveal, Row, Segmented, Skeleton, Txt } from '@/components/ui';
import { useI18n } from '@/i18n';
import { ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/hooks';
import { dismiss } from '@/lib/nav';
import { useApi } from '@/lib/session';
import { Radius, Space, useTheme } from '@/theme';

/**
 * The owner's glance at the whole server, from « Moi » for the emails in ADMIN_EMAILS: what the AI
 * costs, how the app is used, and the server's health. Counts only, never anyone's data.
 */
export default function Admin() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const [period, setPeriod] = useState<`${AdminPeriod}`>('30');
  const query = useQuery({
    queryKey: ['admin', period],
    queryFn: () => api.adminOverview(Number(period) as AdminPeriod),
    // The other period loads under the cards already on screen.
    placeholderData: keepPreviousData,
  });
  const data = query.data;
  // Sign-up on request: the people waiting come first, they are the one thing to act on.
  const requests = useQuery({ queryKey: ['admin-requests'], queryFn: () => api.adminRequests() });
  const waiting = requests.data?.requests ?? [];
  const failed = query.error instanceof ApiError && query.error.status === 403 ? t('admin.forbidden') : query.error ? errorMessage(query.error, t('common.error'), t('common.offline')) : null;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      refreshControl={
        <RefreshControl
          refreshing={query.isRefetching && !query.isPlaceholderData}
          onRefresh={() => {
            void query.refetch();
            void requests.refetch();
          }}
        />
      }
      contentContainerStyle={{
        paddingTop: (Platform.OS === 'ios' ? 0 : insets.top) + Space.xxl,
        paddingHorizontal: Space.lg,
        paddingBottom: insets.bottom + Space.xxxl,
        gap: Space.lg,
        maxWidth: 640,
        width: '100%',
        alignSelf: 'center',
      }}>
      <Reveal index={0} style={{ gap: 4, paddingHorizontal: 4 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt variant="title">{t('admin.title')}</Txt>
          <IconButton label={t('common.close')} icon={<X size={20} color={colors.text} />} onPress={() => dismiss()} />
        </Row>
        <Row gap={5}>
          <Lock size={12} color={colors.text3} />
          <Txt variant="caption" tone="tertiary" numberOfLines={2} style={{ flexShrink: 1 }}>
            {t('admin.privacy', { server: api.baseUrl.replace(/^https?:\/\//, '') })}
          </Txt>
        </Row>
      </Reveal>

      {waiting.length ? (
        <Reveal index={1}>
          <RequestsCard requests={waiting} />
        </Reveal>
      ) : null}

      <Reveal index={1}>
        <Segmented
          value={period}
          onChange={setPeriod}
          options={[
            { value: '7', label: t('admin.days', { count: 7 }) },
            { value: '30', label: t('admin.days', { count: 30 }) },
            { value: '90', label: t('admin.days', { count: 90 }) },
          ]}
        />
      </Reveal>

      {data ? (
        <>
          <Reveal index={2}>
            <AiCard ai={data.ai} />
          </Reveal>
          <Reveal index={3}>
            <UsageCard people={data.people} usage={data.usage} />
          </Reveal>
          <Reveal index={4}>
            <SystemCard system={data.system} />
          </Reveal>
        </>
      ) : failed ? (
        <Txt tone="warning" style={{ paddingHorizontal: 4 }}>
          {failed}
        </Txt>
      ) : (
        <View style={{ gap: Space.lg }}>
          <Skeleton width="100%" height={360} radius={Radius.xl} />
          <Skeleton width="100%" height={280} radius={Radius.xl} />
        </View>
      )}
    </ScrollView>
  );
}
