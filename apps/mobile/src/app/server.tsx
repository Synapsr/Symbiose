import type { ServerInfo } from '@symbiose/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, QrCode } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Dot, Field, IconButton, Pressy, Reveal, Row, Txt } from '@/components/ui';
import { KeyboardAvoiding } from '@/components/ui/keyboard-avoiding';
import { useI18n } from '@/i18n';
import { ApiError, authenticate, createApi, getServerInfo, normalizeServerUrl } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { dismiss } from '@/lib/nav';
import { clearOutbox } from '@/lib/outbox';
import { useSession } from '@/lib/session';
import { useScannedServer, useSettings, useToast } from '@/lib/stores';
import { serverProviderName } from '@/local/ai-settings';
import { uploadToServer } from '@/local/backup-actions';
import { Space, useTheme } from '@/theme';

/** The account as the server has it now (with the profile and plan just restored). */
const getMe = (url: string, token: string) => createApi(url, token).me();

type ServerState = { status: 'idle' | 'checking' | 'error' } | { status: 'ok'; info: ServerInfo };

// A development build can come with a server filled in (EXPO_PUBLIC_SERVER_URL); the web build talks to the local one.
const DEFAULT_SERVER = process.env.EXPO_PUBLIC_SERVER_URL ?? (Platform.OS === 'web' ? 'http://localhost:3000' : '');

/**
 * « J'ai un serveur Symbiose »: the address (typed or scanned), then an
 * account on that server. Symbiose then lives there, on every device.
 */
export default function ServerScreen() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { signIn } = useSession();
  const showToast = useToast((s) => s.show);
  // From Me, on a phone without a server: this phone's data goes to the account signed in to.
  const moving = useLocalSearchParams<{ move?: string }>().move === '1';

  const [server, setServer] = useState(DEFAULT_SERVER);
  const [probe, setProbe] = useState<{ url: string; info: ServerInfo | null } | null>(null);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The QR scanner screen hands the address back through a tiny store.
  useEffect(
    () =>
      useScannedServer.subscribe((state) => {
        if (!state.url) return;
        setServer(state.url);
        state.set(null);
      }),
    [],
  );

  // Probe the server as the address is typed.
  const url = normalizeServerUrl(server);
  useEffect(() => {
    if (url.length < 10) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      getServerInfo(url)
        .then((info) => {
          if (cancelled) return;
          setProbe({ url, info: info.name === 'symbiose' ? info : null });
          if (info.name === 'symbiose') setMode(info.hasUsers ? 'login' : 'register');
        })
        .catch(() => !cancelled && setProbe({ url, info: null }));
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [url]);

  const serverState: ServerState =
    url.length < 10
      ? { status: 'idle' }
      : probe?.url !== url
        ? { status: 'checking' }
        : probe.info
          ? { status: 'ok', info: probe.info }
          : { status: 'error' };

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await authenticate(url, mode, { email, password });
      if (moving) {
        if (!(await uploadToServer(t, url, res.token))) return;
        await clearOutbox();
        const moved = await getMe(url, res.token);
        haptics.success();
        useSettings.getState().set({ aiNoticeFor: url });
        await signIn({ serverUrl: url, token: res.token }, moved);
        showToast({ message: t('move.toServerDone') });
        dismiss();
        return;
      }
      haptics.success();
      // The notice above was read before signing in.
      useSettings.getState().set({ aiNoticeFor: url });
      await signIn({ serverUrl: url, token: res.token }, res.user);
    } catch (e) {
      haptics.warning();
      if (e instanceof ApiError && e.code === 'signup_closed') setError(t('welcome.signupClosed'));
      else if (e instanceof ApiError && e.code === 'email_reserved') setError(t('admin.emailReserved'));
      else setError(e instanceof ApiError ? (e.status === 0 ? t('common.offline') : e.message) : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const ok = serverState.status === 'ok';
  const statusText =
    serverState.status === 'checking'
      ? t('welcome.checking')
      : serverState.status === 'error'
        ? t('welcome.serverKo')
        : serverState.status === 'ok'
          ? serverState.info.ai.enabled
            ? t('welcome.serverOk')
            : t('welcome.serverAiOff')
          : null;
  const statusColor = serverState.status === 'ok' ? colors.accent : serverState.status === 'error' ? colors.warning : colors.text3;
  const canSubmit = ok && email.includes('@') && password.length >= 8;

  return (
    <KeyboardAvoiding style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingTop: insets.top + Space.lg, paddingBottom: insets.bottom + Space.xxl, paddingHorizontal: Space.xxl, gap: Space.xxl, maxWidth: 520, width: '100%', alignSelf: 'center' }}>
        {router.canGoBack() ? (
          <IconButton label={t('common.back')} icon={<ChevronLeft size={22} color={colors.text} />} onPress={() => router.back()} style={{ marginLeft: -Space.sm, marginBottom: -Space.md }} />
        ) : null}
        <View style={{ gap: Space.md }}>
          <Reveal index={0}>
            <Txt variant="title">{t('server.title')}</Txt>
          </Reveal>
          <Reveal index={2}>
            <Txt tone="secondary" style={{ fontSize: 17, lineHeight: 24 }}>
              {moving ? t('move.toServerNote') : t('server.subtitle')}
            </Txt>
          </Reveal>
        </View>

        <Reveal index={6} style={{ gap: Space.md }}>
          <Row gap={Space.sm} style={{ alignItems: 'flex-end' }}>
            <View style={{ flex: 1 }}>
              <Field
                label={t('welcome.server')}
                value={server}
                onChangeText={setServer}
                placeholder={t('welcome.serverHint')}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                textContentType="URL"
              />
            </View>
            {Platform.OS !== 'web' ? (
              <IconButton label={t('welcome.scan')} size={54} icon={<QrCode size={22} color={colors.text} />} onPress={() => router.push('/scan-server')} />
            ) : null}
          </Row>
          {statusText ? (
            <Row gap={6} style={{ marginLeft: 4 }}>
              <Dot color={statusColor} />
              <Txt variant="caption" tone="secondary">
                {statusText}
              </Txt>
            </Row>
          ) : null}
        </Reveal>

        {ok ? (
          <Reveal style={{ gap: Space.md }}>
            <Field
              label={t('welcome.email')}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              autoComplete="email"
              textContentType="emailAddress"
            />
            <Field
              label={t('welcome.password')}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              textContentType={mode === 'register' ? 'newPassword' : 'password'}
              onSubmitEditing={() => canSubmit && void submit()}
            />
            {mode === 'register' && serverState.info.signup === 'request' && serverState.info.hasUsers ? (
              <Txt variant="caption" tone="secondary" style={{ marginLeft: 4 }}>
                {t('admin.signupOnRequest')}
              </Txt>
            ) : null}
            {/* What the server's AI receives, and who it is: said before signing in (App Store 5.1.2(i)). */}
            {serverState.info.ai.enabled ? (
              <Txt variant="caption" tone="tertiary" style={{ marginLeft: 4 }}>
                {t('server.aiNotice', { provider: serverProviderName(serverState.info.ai.provider) ?? t('server.aiProviderUnknown') })}
              </Txt>
            ) : null}
            {error ? (
              <Txt variant="caption" tone="warning" style={{ marginLeft: 4 }}>
                {error}
              </Txt>
            ) : null}
            <Button title={mode === 'register' ? t('welcome.signUp') : t('welcome.signIn')} onPress={submit} loading={busy} disabled={!canSubmit} style={{ marginTop: Space.sm }} />
            {serverState.info.signupOpen || mode === 'register' ? (
              <Pressy onPress={() => setMode(mode === 'login' ? 'register' : 'login')} style={{ alignSelf: 'center', padding: Space.sm }}>
                <Txt variant="label" tone="secondary">
                  {mode === 'login' ? t('welcome.toSignUp') : t('welcome.toSignIn')}
                </Txt>
              </Pressy>
            ) : null}
          </Reveal>
        ) : null}
      </ScrollView>
    </KeyboardAvoiding>
  );
}
