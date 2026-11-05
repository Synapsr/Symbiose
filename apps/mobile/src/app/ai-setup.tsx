import { AI_PROVIDERS, type AiProvider } from '@symbiose/core';
import { useQuery } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import { Check, ChevronDown, ExternalLink, KeyRound, Network, Sparkles, X } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Platform, ScrollView, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, Field, IconButton, Pressy, Row, SectionTitle, Toggle, Txt } from '@/components/ui';
import { KeyboardAvoiding } from '@/components/ui/keyboard-avoiding';
import { useI18n } from '@/i18n';
import type { TranslationKey } from '@/i18n/fr';
import { getServerInfo } from '@/lib/api';
import { formatNumber } from '@/lib/format';
import { haptics } from '@/lib/haptics';
import { dismiss } from '@/lib/nav';
import { useSession } from '@/lib/session';
import { useToast } from '@/lib/stores';
import { ask } from '@/local/backup-actions';
import { providerName, useAiSettings, type AiChoice } from '@/local/ai-settings';
import { KEY_PAGES, testAiChoice } from '@/local/ai-test';
import { CHATGPT_USAGE_URL, signOutOfChatGpt } from '@/local/chatgpt-auth';
import { signInWithOpenRouter } from '@/local/openrouter-auth';
import { useConnectChatGpt } from '@/local/use-connect-chatgpt';
import { Radius, Space, useTheme } from '@/theme';

/** The providers offered with a key, in the order people know them. */
const KEY_PROVIDERS: AiProvider[] = ['anthropic', 'openai', 'gemini', 'mistral', 'openrouter'];
const NETWORK_PROVIDERS: AiProvider[] = ['ollama', 'openai-compatible'];

/**
 * « Ton IA »: on a phone without a server, the AI the person chose, and every
 * way to choose one (their ChatGPT plan, OpenRouter, a key, a server on their
 * network). With a server, its AI, read only.
 */
export default function AiSetupScreen() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { onPhone, api } = useSession();

  return (
    <KeyboardAvoiding style={{ flex: 1, backgroundColor: colors.bg }}>
      <Row style={{ justifyContent: 'space-between', padding: Space.lg, paddingTop: (Platform.OS === 'ios' ? 0 : insets.top) + Space.lg }}>
        <Txt variant="heading">{onPhone ? t('aiSetup.title') : t('me.ai')}</Txt>
        <IconButton label={t('common.close')} icon={<X size={20} color={colors.text} />} onPress={() => dismiss()} />
      </Row>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: Space.xl, paddingTop: 0, paddingBottom: insets.bottom + Space.xxxl, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
        {onPhone ? <PhoneAi /> : api ? <ServerAi serverUrl={api.baseUrl} /> : null}
      </ScrollView>
    </KeyboardAvoiding>
  );
}

function ServerAi({ serverUrl }: { serverUrl: string }) {
  const { t } = useI18n();
  const info = useQuery({ queryKey: ['server-info', serverUrl], queryFn: () => getServerInfo(serverUrl) });
  if (!info.data) return info.isPending ? <ActivityIndicator /> : null;
  const { ai } = info.data;
  return (
    <Card style={{ gap: Space.sm }}>
      <Txt variant="label">{ai.enabled ? t('me.ai.server') : t('me.ai.serverOff')}</Txt>
      {ai.enabled ? (
        <Txt tone="secondary">
          {ai.provider ? `${ai.provider} · ` : ''}
          {ai.model}
        </Txt>
      ) : null}
    </Card>
  );
}

function PhoneAi() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const choice = useAiSettings((s) => s.choice);
  const save = useAiSettings((s) => s.save);
  const showToast = useToast((s) => s.show);
  const chatgpt = useConnectChatGpt();
  const [open, setOpen] = useState<AiProvider | null>(null);
  const [openRouterBusy, setOpenRouterBusy] = useState(false);
  const [openRouterError, setOpenRouterError] = useState(false);

  const connectOpenRouter = async () => {
    setOpenRouterBusy(true);
    setOpenRouterError(false);
    const result = await signInWithOpenRouter();
    setOpenRouterBusy(false);
    if (!result.ok) {
      if (result.reason !== 'cancelled') setOpenRouterError(true);
      return;
    }
    await save({ kind: 'key', provider: 'openrouter', apiKey: result.key }, { provider: 'OpenRouter', at: new Date().toISOString() });
    haptics.success();
    showToast({ message: t('aiSetup.ready', { provider: 'OpenRouter' }) });
    dismiss();
  };

  const disconnect = async () => {
    if (!(await ask(t('me.ai.disconnect'), t('me.ai.disconnectConfirm'), t('me.ai.disconnect'), t('common.cancel')))) return;
    if (choice?.kind === 'chatgpt') await signOutOfChatGpt().catch(() => false);
    await save(null);
    haptics.soft();
  };

  const chatgptStage = chatgpt.state.stage;

  return (
    <View style={{ gap: Space.md }}>
      <Txt tone="secondary">{t('aiSetup.subtitle')}</Txt>

      {choice ? <CurrentAi choice={choice} onDisconnect={() => void disconnect()} /> : null}

      <SectionTitle>{t('aiSetup.withAccount')}</SectionTitle>
      <Option
        icon={<Sparkles size={20} color={colors.accentText} />}
        title="ChatGPT"
        note={t('aiSetup.chatgptNote')}
        active={choice?.kind === 'chatgpt'}
        busy={chatgpt.busy}
        onPress={() => void chatgpt.connect()}
      />
      {chatgptStage === 'connected' ? (
        <Animated.View entering={FadeIn}>
          <Card style={{ gap: Space.md, backgroundColor: colors.accentSoft }}>
            <Txt variant="label">{t('ai.welcome.title')}</Txt>
            <Txt tone="secondary">{t('ai.welcome.body')}</Txt>
            <Row gap={Space.sm}>
              <Button title={t('ai.manageUsage')} variant="secondary" size="md" onPress={() => void WebBrowser.openBrowserAsync(CHATGPT_USAGE_URL)} />
              <Button title={t('ai.welcome.ok')} size="md" onPress={() => dismiss()} />
            </Row>
          </Card>
        </Animated.View>
      ) : chatgptStage === 'notEligible' ? (
        <Card style={{ gap: Space.sm }}>
          <Txt variant="label">{t('ai.notEligible.title')}</Txt>
          <Txt tone="secondary">{t('ai.notEligible.body')}</Txt>
          <Button title={t('ai.notEligible.plans')} variant="secondary" size="md" onPress={() => void WebBrowser.openBrowserAsync('https://chatgpt.com/#pricing')} style={{ alignSelf: 'flex-start' }} />
        </Card>
      ) : chatgptStage === 'failed' || chatgptStage === 'unavailable' ? (
        <Txt variant="caption" tone="warning">
          {chatgptStage === 'unavailable' ? t('ai.unavailable') : t('ai.failed')}
        </Txt>
      ) : null}
      <Option
        icon={<Network size={20} color={colors.text} />}
        title={t('aiSetup.openrouter')}
        note={t('aiSetup.openrouterNote')}
        active={choice?.kind === 'key' && choice.provider === 'openrouter' && open !== 'openrouter'}
        busy={openRouterBusy}
        onPress={() => void connectOpenRouter()}
      />
      {openRouterError ? (
        <Txt variant="caption" tone="warning">
          {t('ai.failed')}
        </Txt>
      ) : null}

      <SectionTitle>{t('aiSetup.withKey')}</SectionTitle>
      {KEY_PROVIDERS.map((provider) => (
        <KeyOption key={provider} provider={provider} open={open === provider} onToggle={() => setOpen(open === provider ? null : provider)} />
      ))}

      {__DEV__ ? (
        <Option
          icon={<Sparkles size={20} color={colors.text2} />}
          title="Mock (dev)"
          note="Canned answers, no network: development builds only."
          active={choice?.kind === 'mock'}
          onPress={() => void save({ kind: 'mock' }, { provider: 'Mock', at: new Date().toISOString() }).then(() => dismiss())}
        />
      ) : null}

      <SectionTitle>{t('aiSetup.onNetwork')}</SectionTitle>
      {NETWORK_PROVIDERS.map((provider) => (
        <KeyOption key={provider} provider={provider} open={open === provider} onToggle={() => setOpen(open === provider ? null : provider)} />
      ))}

      <Txt variant="caption" tone="tertiary" style={{ marginTop: Space.lg }}>
        {t('ai.consent', { provider: open ? t(`provider.${open}` as TranslationKey) : 'OpenAI' })}
      </Txt>
    </View>
  );
}

function CurrentAi({ choice, onDisconnect }: { choice: AiChoice; onDisconnect: () => void }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const { api } = useSession();
  const usage = useQuery({ queryKey: ['local-ai-usage'], queryFn: () => api!.localAiUsage(), enabled: Boolean(api?.local) });
  const name = choice.kind === 'chatgpt' ? 'ChatGPT' : choice.kind === 'mock' ? 'Mock (dev)' : t(`provider.${choice.provider}` as TranslationKey);
  const detail = choice.kind === 'chatgpt' ? t('ai.usingPlan') : t('me.ai.key', { provider: providerName(choice) });
  const calls = usage.data?.calls ?? 0;
  const cost = usage.data?.costUsd;
  return (
    <Card style={{ gap: Space.md }}>
      <Row gap={Space.md}>
        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Check size={18} color={colors.accentText} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt variant="label">{name}</Txt>
          <Txt variant="caption" tone="secondary">
            {detail}
          </Txt>
        </View>
      </Row>
      {usage.data ? (
        <Txt variant="caption" tone="secondary">
          {cost != null && cost > 0
            ? t('me.ai.usageCost', { count: calls, cost: `${formatNumber(cost, locale, 2)} $` })
            : t('me.ai.usage', { count: calls })}
        </Txt>
      ) : null}
      <Row gap={Space.sm}>
        {choice.kind === 'chatgpt' ? <Button title={t('ai.manageUsage')} variant="secondary" size="md" onPress={() => void WebBrowser.openBrowserAsync(CHATGPT_USAGE_URL)} /> : null}
        <Button title={t('me.ai.disconnect')} variant="ghost" size="md" onPress={onDisconnect} />
      </Row>
    </Card>
  );
}

function Option({ icon, title, note, active, busy, onPress, right }: { icon: ReactNode; title: string; note?: string; active?: boolean; busy?: boolean; onPress: () => void; right?: ReactNode }) {
  const { colors } = useTheme();
  return (
    <Pressy onPress={onPress} disabled={busy} accessibilityRole="button" accessibilityLabel={title}>
      <Card padded={false} style={{ padding: Space.lg, flexDirection: 'row', alignItems: 'center', gap: Space.md, borderWidth: active ? 2 : 0, borderColor: colors.accent }}>
        <View style={{ width: 40, height: 40, borderRadius: Radius.pill, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }}>{icon}</View>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="label">{title}</Txt>
          {note ? (
            <Txt variant="caption" tone="secondary">
              {note}
            </Txt>
          ) : null}
        </View>
        {busy ? <ActivityIndicator color={colors.text2} /> : active ? <Check size={20} color={colors.accentText} /> : right}
      </Card>
    </Pressy>
  );
}

function KeyOption({ provider, open, onToggle }: { provider: AiProvider; open: boolean; onToggle: () => void }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const choice = useAiSettings((s) => s.choice);
  const save = useAiSettings((s) => s.save);
  const showToast = useToast((s) => s.show);
  const current = choice?.kind === 'key' && choice.provider === provider ? choice : null;
  const info = AI_PROVIDERS[provider];
  const onNetwork = NETWORK_PROVIDERS.includes(provider);

  const [apiKey, setApiKey] = useState(current?.apiKey ?? '');
  const [model, setModel] = useState(current?.model ?? '');
  const [baseUrl, setBaseUrl] = useState(current?.baseUrl ?? '');
  const [vision, setVision] = useState(current?.vision ?? true);
  const [workspaceId, setWorkspaceId] = useState(current?.workspaceId ?? '');
  const [more, setMore] = useState(Boolean(current?.workspaceId));
  const [state, setState] = useState<'idle' | 'testing' | 'refused' | 'unreachable'>('idle');

  const name = t(`provider.${provider}` as TranslationKey);
  const needsKey = info.keyRequired;
  const needsUrl = info.baseUrl === null && provider !== 'anthropic';
  const needsModel = info.model === null;
  const ready = (!needsKey || apiKey.trim().length > 8) && (!needsUrl || /^https?:\/\//.test(baseUrl.trim())) && (!needsModel || model.trim().length > 0);

  const use = async () => {
    const next: AiChoice = {
      kind: 'key',
      provider,
      apiKey: apiKey.trim() || null,
      model: model.trim() || null,
      baseUrl: baseUrl.trim() || null,
      vision,
      workspaceId: workspaceId.trim() || null,
    };
    setState('testing');
    const result = await testAiChoice(next);
    if (result !== 'ok') {
      haptics.warning();
      return setState(result);
    }
    await save(next, { provider: name, at: new Date().toISOString() });
    haptics.success();
    showToast({ message: t('aiSetup.ready', { provider: name }) });
    dismiss();
  };

  return (
    <View style={{ gap: Space.sm }}>
      <Pressy onPress={onToggle} accessibilityRole="button" accessibilityLabel={name}>
        <Card padded={false} style={{ padding: Space.lg, flexDirection: 'row', alignItems: 'center', gap: Space.md, borderWidth: current && !open ? 2 : 0, borderColor: colors.accent }}>
          <View style={{ width: 40, height: 40, borderRadius: Radius.pill, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }}>
            {onNetwork ? <Network size={18} color={colors.text} /> : <KeyRound size={18} color={colors.text} />}
          </View>
          <Txt variant="label" style={{ flex: 1 }}>
            {name}
          </Txt>
          {current && !open ? <Check size={20} color={colors.accentText} /> : <ChevronDown size={20} color={colors.text3} style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }} />}
        </Card>
      </Pressy>
      {open ? (
        <Animated.View entering={FadeIn.duration(200)} style={{ gap: Space.md, paddingHorizontal: Space.xs }}>
          {needsUrl || onNetwork ? (
            <Field
              label={t('aiSetup.baseUrl')}
              value={baseUrl}
              onChangeText={setBaseUrl}
              placeholder={provider === 'ollama' ? 'http://192.168.1.20:11434/v1' : 'http://192.168.1.20:1234/v1'}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
          ) : null}
          {needsKey || onNetwork ? (
            <Field label={t('aiSetup.key')} value={apiKey} onChangeText={setApiKey} placeholder={needsKey ? 'sk-…' : ''} autoCapitalize="none" autoCorrect={false} secureTextEntry />
          ) : null}
          <Field
            label={t('aiSetup.model')}
            value={model}
            onChangeText={setModel}
            placeholder={info.model ? t('aiSetup.modelDefault', { model: info.model }) : 'llama3.3'}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {onNetwork ? (
            <Row style={{ justifyContent: 'space-between' }}>
              <Txt>{t('aiSetup.vision')}</Txt>
              <Toggle value={vision} onValueChange={setVision} />
            </Row>
          ) : null}
          {provider === 'anthropic' ? (
            more ? (
              <Field label={t('aiSetup.workspace')} value={workspaceId} onChangeText={setWorkspaceId} autoCapitalize="none" autoCorrect={false} />
            ) : (
              <Pressy onPress={() => setMore(true)} style={{ alignSelf: 'flex-start', paddingVertical: Space.xs }}>
                <Txt variant="caption" tone="secondary">
                  {t('aiSetup.moreOptions')}
                </Txt>
              </Pressy>
            )
          ) : null}
          {provider === 'gemini' ? (
            <Txt variant="caption" tone="tertiary">
              {t('aiSetup.geminiNote')}
            </Txt>
          ) : null}
          {onNetwork ? (
            <Txt variant="caption" tone="tertiary">
              {t('aiSetup.localNote')}
            </Txt>
          ) : null}
          {state === 'refused' || state === 'unreachable' ? (
            <Txt variant="caption" tone="warning">
              {state === 'refused' ? t('aiSetup.keyRefused') : t('aiSetup.unreachable', { provider: name })}
            </Txt>
          ) : null}
          <Row gap={Space.md} style={{ flexWrap: 'wrap' }}>
            <Button title={t('aiSetup.test')} size="md" onPress={() => void use()} loading={state === 'testing'} disabled={!ready} />
            {KEY_PAGES[provider] ? (
              <Pressy onPress={() => void WebBrowser.openBrowserAsync(KEY_PAGES[provider]!)} style={{ paddingVertical: Space.sm }}>
                <Row gap={4}>
                  <Txt variant="caption" tone="secondary">
                    {t('aiSetup.whereKey')}
                  </Txt>
                  <ExternalLink size={13} color={colors.text2} />
                </Row>
              </Pressy>
            ) : null}
          </Row>
        </Animated.View>
      ) : null}
    </View>
  );
}
