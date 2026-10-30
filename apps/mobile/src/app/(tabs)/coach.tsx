import { toLocalDate, type CoachMessage } from '@symbiose/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ArrowUp, Sparkles, Trash2 } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { FlatList, Keyboard, KeyboardAvoidingView, Platform, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInUp, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Chip, IconButton, Row, Txt, webInput, webSingleRow } from '@/components/ui';
import { Logo } from '@/components/ui/logo';
import { useI18n, type TranslationKey } from '@/i18n';
import { haptics } from '@/lib/haptics';
import { errorMessage } from '@/lib/hooks';
import { useApi } from '@/lib/session';
import { Radius, Space, useTheme } from '@/theme';

const SUGGESTIONS: TranslationKey[] = ['coach.s1', 'coach.s2', 'coach.s3', 'coach.s4'];

/** The exchange being streamed: the question and the reply as it is written. */
interface Live {
  user: CoachMessage;
  reply: string;
}

/** True while the software keyboard is on screen. */
function useKeyboardVisible() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setVisible(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}

export default function Coach() {
  const { t } = useI18n();
  const { colors } = useTheme();
  // Inside a native tab, the bottom inset already includes the tab bar.
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardVisible();
  const api = useApi();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [live, setLive] = useState<Live | null>(null);
  const [error, setError] = useState<unknown>(null);
  const messages = useQuery({ queryKey: ['coach'], queryFn: () => api.coachMessages() });

  const clear = useMutation({
    mutationFn: () => api.clearCoach(),
    onSuccess: () => queryClient.setQueryData(['coach'], []),
  });

  const submit = async (message: string) => {
    const question = message.trim();
    if (!question || live) return;
    haptics.tap();
    setText('');
    setError(null);
    setLive({ user: { id: 'live-user', role: 'user', content: question, suggestion: null, createdAt: new Date().toISOString() }, reply: '' });
    try {
      const saved = await api.streamCoach(question, toLocalDate(), (delta) => setLive((current) => current && { ...current, reply: current.reply + delta }));
      queryClient.setQueryData<CoachMessage[]>(['coach'], (old = []) => [...old, saved.user, saved.reply]);
      haptics.success();
    } catch (e) {
      haptics.warning();
      setError(e);
      setText(question); // give the question back so it can be re-sent
    } finally {
      setLive(null);
    }
  };

  const history = messages.data ?? [];
  const shown: (CoachMessage & { streaming?: boolean })[] = live
    ? [...history, live.user, { id: 'live-reply', role: 'assistant', content: live.reply, suggestion: null, createdAt: '', streaming: true }]
    : history;
  const empty = shown.length === 0;
  const composerBottom = Platform.OS === 'web' ? 96 : keyboardVisible ? Space.sm : insets.bottom + Space.sm;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Row style={{ justifyContent: 'space-between', paddingTop: insets.top + Space.md, paddingHorizontal: Space.xl, paddingBottom: Space.sm }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="title">{t('coach.title')}</Txt>
          <Txt variant="caption" tone="secondary">
            {t('coach.subtitle')}
          </Txt>
        </View>
        {history.length ? <IconButton label={t('coach.clear')} icon={<Trash2 size={18} color={colors.text2} />} onPress={() => clear.mutate()} /> : null}
      </Row>

      {empty ? (
        <View style={{ flex: 1, justifyContent: 'center', padding: Space.xl, gap: Space.xl }}>
          <View style={{ alignItems: 'center', gap: Space.md }}>
            <Logo size={56} />
            <Txt tone="secondary" style={{ textAlign: 'center', maxWidth: 300 }}>
              {t('coach.intro')}
            </Txt>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm, justifyContent: 'center' }}>
            {SUGGESTIONS.map((key) => (
              <Chip key={key} label={t(key)} onPress={() => void submit(t(key))} />
            ))}
          </View>
        </View>
      ) : (
        <FlatList
          data={[...shown].reverse()}
          inverted
          keyExtractor={(m) => m.id}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: Space.lg, gap: Space.md }}
          ListHeaderComponent={
            error ? (
              <Txt variant="caption" tone="warning">
                {errorMessage(error, t('common.error'), t('common.offline'))}
              </Txt>
            ) : undefined
          }
          renderItem={({ item }) => <Bubble message={item} streaming={item.streaming} />}
        />
      )}

      <View style={{ paddingHorizontal: Space.lg, paddingTop: Space.sm, paddingBottom: composerBottom }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: Space.sm, backgroundColor: colors.surface, borderRadius: Radius.xl, borderWidth: 1, borderColor: colors.border, padding: 6, paddingLeft: Space.lg }}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={t('coach.placeholder')}
            placeholderTextColor={colors.text3}
            multiline
            // One row when empty, so the placeholder lines up with the send button.
            {...webSingleRow}
            style={[{ flex: 1, minHeight: 44, maxHeight: 140, color: colors.text, fontSize: 16, lineHeight: 20, paddingTop: 12, paddingBottom: 12 }, webInput]}
          />
          <IconButton label={t('capture.send')} variant="inverted" icon={<ArrowUp size={20} color={colors.onInverted} />} onPress={() => void submit(text)} />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

/** A soft blinking caret at the end of a reply being written. */
function Caret() {
  const { colors } = useTheme();
  const opacity = useSharedValue(1);
  useEffect(() => {
    opacity.set(withRepeat(withTiming(0.15, { duration: 500 }), -1, true));
  }, [opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[{ width: 8, height: 16, borderRadius: 2, backgroundColor: colors.accent, marginLeft: 2, marginBottom: 3 }, style]} />;
}

function Bubble({ message, streaming }: { message: CoachMessage; streaming?: boolean }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const mine = message.role === 'user';

  // Waiting for the first words: the logo breathes.
  if (streaming && !message.content) {
    return (
      <Animated.View entering={FadeIn.duration(200)}>
        <Row gap={Space.sm} style={{ paddingVertical: Space.sm }}>
          <Logo size={22} breathe />
          <Txt variant="accent" tone="tertiary" style={{ fontSize: 16 }}>
            {t('coach.thinking')}
          </Txt>
        </Row>
      </Animated.View>
    );
  }

  return (
    <Animated.View entering={streaming ? undefined : FadeInUp.duration(220)} style={{ alignItems: mine ? 'flex-end' : 'flex-start', gap: Space.sm }}>
      <View
        style={{
          maxWidth: '86%',
          paddingHorizontal: Space.lg,
          paddingVertical: Space.md,
          borderRadius: Radius.lg,
          borderBottomRightRadius: mine ? 6 : Radius.lg,
          borderBottomLeftRadius: mine ? Radius.lg : 6,
          backgroundColor: mine ? colors.inverted : colors.surface,
          borderWidth: mine ? 0 : 1,
          borderColor: colors.border,
        }}>
        <Txt color={mine ? colors.onInverted : colors.text} style={{ lineHeight: 23 }} selectable={!streaming}>
          {message.content}
        </Txt>
        {streaming ? <Caret /> : null}
      </View>
      {message.suggestion ? (
        <View style={{ maxWidth: '86%', backgroundColor: colors.accentSoft, borderRadius: Radius.lg, padding: Space.lg, gap: Space.sm }}>
          <Row gap={Space.sm}>
            <Sparkles size={16} color={colors.accent} />
            <Txt variant="label" tone="accent">
              {t('coach.suggestion')}
            </Txt>
          </Row>
          <Txt variant="caption" tone="secondary">
            {message.suggestion.rationale}
          </Txt>
          <Button title={t('coach.apply')} size="md" variant="accent" onPress={() => router.push({ pathname: '/goals', params: { intentions: message.suggestion!.intentions } })} />
        </View>
      ) : null}
    </Animated.View>
  );
}
