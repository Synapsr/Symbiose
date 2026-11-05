import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Alert } from 'react-native';

import { useI18n } from '@/i18n';
import { serverProviderName } from '@/local/ai-settings';

import { getServerInfo } from './api';
import { useSession } from './session';
import { useSettings } from './stores';

/**
 * With a server: once, the person is told what its AI receives and who answers
 * (App Store 5.1.2(i)). New accounts read it on the server screen before
 * signing in; this is for those signed in before it was there.
 */
export function useServerAiNotice() {
  const { t } = useI18n();
  const { session, onPhone } = useSession();
  const serverUrl = !onPhone ? session?.serverUrl : undefined;
  const loaded = useSettings((s) => s.loaded);
  const noticeFor = useSettings((s) => s.aiNoticeFor);
  const info = useQuery({ queryKey: ['server-info', serverUrl], queryFn: () => getServerInfo(serverUrl!), enabled: Boolean(serverUrl && loaded && noticeFor !== serverUrl), staleTime: 5 * 60_000 });
  const enabled = info.data?.ai.enabled;
  const provider = info.data?.ai.provider;

  useEffect(() => {
    if (!serverUrl || !enabled || noticeFor === serverUrl) return;
    useSettings.getState().set({ aiNoticeFor: serverUrl });
    Alert.alert(t('me.ai.server'), t('server.aiNotice', { provider: serverProviderName(provider) ?? t('server.aiProviderUnknown') }), [{ text: t('ai.welcome.ok') }]);
  }, [serverUrl, enabled, provider, noticeFor, t]);
}
