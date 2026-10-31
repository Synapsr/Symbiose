import type { ServerInfo } from '@symbiose/shared';
import { router } from 'expo-router';
import { QrCode } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Dot, Field, IconButton, Pressy, Reveal, Row, Txt } from '@/components/ui';
import { Logo } from '@/components/ui/logo';
import { useI18n } from '@/i18n';
import { ApiError, authenticate, getServerInfo, normalizeServerUrl } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { useSession } from '@/lib/session';
import { useScannedServer } from '@/lib/stores';
import { Space, useTheme } from '@/theme';

type ServerState = { status: 'idle' | 'checking' | 'error' } | { status: 'ok'; info: ServerInfo };

// Builds can ship with a server pre-filled (EXPO_PUBLIC_SERVER_URL), e.g. for TestFlight.
const DEFAULT_SERVER = process.env.EXPO_PUBLIC_SERVER_URL ?? (Platform.OS === 'web' ? 'http://localhost:3000' : '');

export default function Welcome() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { signIn } = useSession();

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
      haptics.success();
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
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingTop: insets.top + Space.xxxl, paddingBottom: insets.bottom + Space.xxl, paddingHorizontal: Space.xxl, gap: Space.xxl, maxWidth: 520, width: '100%', alignSelf: 'center' }}>
        <Reveal index={0}>
          <Row gap={Space.md}>
            <Logo size={40} animated />
            <Txt variant="heading" style={{ fontSize: 22 }}>
              Symbiose
            </Txt>
          </Row>
        </Reveal>

        <View style={{ gap: Space.md, marginTop: Space.xl }}>
          <Reveal index={2}>
            <Txt variant="title" style={{ fontSize: 42, lineHeight: 46 }}>
              {t('welcome.tagline').split('\n')[0]}
            </Txt>
            <Txt variant="accent" tone="accent" style={{ fontSize: 42, lineHeight: 48 }}>
              {t('welcome.tagline').split('\n')[1]}
            </Txt>
          </Reveal>
          <Reveal index={4}>
            <Txt tone="secondary" style={{ fontSize: 17, lineHeight: 24 }}>
              {t('welcome.subtitle')}
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
    </KeyboardAvoidingView>
  );
}
