import { localTime, MIN_REVIEW_DAYS, toLocalDate, toLocalDateTime, type CoachMessage } from '@symbiose/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { ArrowUp, ChevronRight, Ellipsis, Settings2, Sparkles, Sun, Trash2 } from 'lucide-react-native';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, FlatList, Platform, Pressable, TextInput, View, type TextInputInstance } from 'react-native';
import Animated, { FadeIn, FadeInUp, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MealActionCard } from '@/components/coach/meal-action-card';
import { Button, Chip, IconButton, Pressy, Row, Txt, webInput, webSingleRow } from '@/components/ui';
import { Logo } from '@/components/ui/logo';
import { MicButton } from '@/components/ui/mic-button';
import { InlineProse, Prose } from '@/components/ui/prose';
import { useI18n, type TranslationKey } from '@/i18n';
import { useDictation } from '@/lib/dictation';
import { haptics } from '@/lib/haptics';
import { errorMessage } from '@/lib/hooks';
import { useKeyboardLift } from '@/lib/keyboard';
import { markMorningSeen, useMorningDraft, useProactive } from '@/lib/proactive';
import { useApi } from '@/lib/session';
import { Radius, Space, useTheme } from '@/theme';

const SUGGESTIONS: TranslationKey[] = ['coach.s1', 'coach.s2', 'coach.s3', 'coach.s4'];

/** The exchange being streamed: the question and the reply as it is written. */
interface Live {
  /** Its bubbles' keys, which the saved messages keep: nothing re-enters once the reply is written. */
  key: string;
  user: CoachMessage;
  reply: string;
  /** Once written: the saved reply's id, until the conversation shows it. */
  savedId?: string;
}

export default function Coach() {
  const { t } = useI18n();
  const { colors, elevation } = useTheme();
  // Inside a native tab, the bottom inset already includes the tab bar.
  const insets = useSafeAreaInsets();
  // The composer rests on the tab bar and rides on the keyboard, following it as it is dragged away.
  const lift = useKeyboardLift(Platform.OS === 'web' ? 88 : insets.bottom, Space.sm);
  const api = useApi();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const dictation = useDictation(text, setText);
  const [live, setLive] = useState<Live | null>(null);
  // Saved message id → the live bubble's key it took over.
  const [keys, setKeys] = useState<Record<string, string>>({});
  const exchanges = useRef(0);
  const [error, setError] = useState<unknown>(null);
  const [menu, setMenu] = useState(false);
  const input = useRef<TextInputInstance>(null);
  const messages = useQuery({ queryKey: ['coach'], queryFn: () => api.coachMessages() });
  const schedule = useProactive().data;
  const draft = useMorningDraft((s) => s.draft);
  const today = toLocalDate();

  // Something to talk about, from elsewhere (« En parler au coach »): ready in the composer, never sent on its own.
  const params = useLocalSearchParams<{ prompt?: string; message?: string }>();
  const [prompted, setPrompted] = useState<string | undefined>(undefined);
  if (params.prompt !== prompted) {
    setPrompted(params.prompt);
    if (params.prompt) setText(params.prompt);
  }
  useEffect(() => {
    if (params.prompt) router.setParams({ prompt: undefined });
  }, [params.prompt]);
  // Opened on a proactive message (the coach line): the keyboard is up, ready for « pourquoi ? ».
  useEffect(() => {
    if (!params.message) return;
    const timer = setTimeout(() => {
      input.current?.focus();
      router.setParams({ message: undefined });
    }, 400);
    return () => clearTimeout(timer);
  }, [params.message]);

  const clear = useMutation({
    mutationFn: () => api.clearCoach(),
    onSuccess: () => {
      queryClient.setQueryData(['coach'], []);
      // Today's check-in went with it: no rewriting it, no notification for it.
      useMorningDraft.setState({ draft: null });
      markMorningSeen(today);
      void queryClient.invalidateQueries({ queryKey: ['proactive'] });
    },
  });
  const confirmClear = () => {
    setMenu(false);
    if (Platform.OS === 'web') {
      if (globalThis.confirm?.(`${t('coach.clear')}\n\n${t('coach.clearConfirm')}`)) clear.mutate();
      return;
    }
    Alert.alert(t('coach.clear'), t('coach.clearConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('coach.clearAction'), style: 'destructive', onPress: () => clear.mutate() },
    ]);
  };

  const submit = async (message: string) => {
    const question = message.trim();
    if (!question || (live && !live.savedId)) return;
    haptics.tap();
    setText('');
    setError(null);
    exchanges.current += 1;
    const key = `live-${exchanges.current}`;
    setLive({ key, user: { id: `${key}-user`, role: 'user', content: question, suggestion: null, mealActions: [], createdAt: new Date().toISOString() }, reply: '' });
    try {
      const saved = await api.streamCoach(question, toLocalDate(), (delta) => setLive((current) => current && { ...current, reply: current.reply + delta }));
      setKeys((known) => ({ ...known, [saved.user.id]: `${key}-user`, [saved.reply.id]: `${key}-reply` }));
      setLive((current) => current && { ...current, savedId: saved.reply.id });
      queryClient.setQueryData<CoachMessage[]>(['coach'], (old = []) => [...old, saved.user, saved.reply]);
      // A reply is a conversation, not a milestone.
      haptics.soft();
    } catch (e) {
      haptics.warning();
      setError(e);
      setText(question); // give the question back so it can be re-sent
      setLive(null);
    }
  };

  const history = messages.data ?? [];
  // Today's check-in while it is written (opened from its notification): it streams in like a reply.
  const morningDone = history.some((m) => m.kind === 'morning' && m.localDate === today);
  const writing: (CoachMessage & { streaming?: boolean })[] =
    draft?.date === today && draft.writing && !morningDone
      ? [{ id: 'live-morning', role: 'assistant', content: draft.text, suggestion: null, mealActions: [], kind: 'morning', localDate: today, createdAt: new Date().toISOString(), streaming: true }]
      : [];
  // The conversation holds the saved exchange: it takes the live one's place, under the same keys.
  if (live?.savedId && history.some((m) => m.id === live.savedId)) setLive(null);
  const shown: (CoachMessage & { streaming?: boolean })[] = live
    ? [...history, ...writing, live.user, { id: `${live.key}-reply`, role: 'assistant', content: live.reply, suggestion: null, mealActions: [], createdAt: '', streaming: !live.savedId }]
    : [...history, ...writing];
  // Read here: today's morning notification isn't needed any more.
  const focused = useIsFocused();
  useEffect(() => {
    if (focused && morningDone) markMorningSeen(today);
  }, [focused, morningDone, today]);
  const reviewDay = schedule && schedule.settings.weekly && schedule.review.loggedDays >= MIN_REVIEW_DAYS ? schedule.review.monday : null;
  const empty = shown.length === 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Row style={{ justifyContent: 'space-between', paddingTop: insets.top + Space.md, paddingHorizontal: Space.xl, paddingBottom: Space.sm }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="title">{t('coach.title')}</Txt>
          <Txt variant="caption" tone="secondary">
            {t('coach.subtitle')}
          </Txt>
        </View>
        <IconButton label={t('coach.more')} icon={<Ellipsis size={20} color={colors.text2} />} onPress={() => setMenu((open) => !open)} />
      </Row>
      {menu ? (
        <>
          <Pressable style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10 }} onPress={() => setMenu(false)} accessibilityLabel={t('common.cancel')} />
          <Animated.View
            entering={FadeIn.duration(140)}
            style={[{ position: 'absolute', top: insets.top + Space.md + 48, right: Space.xl, zIndex: 11, minWidth: 240, backgroundColor: colors.surface, borderRadius: Radius.lg, borderCurve: 'continuous', paddingVertical: Space.xs }, elevation]}>
            <MenuItem
              icon={<Settings2 size={18} color={colors.text} />}
              label={t('coach.settings')}
              onPress={() => {
                setMenu(false);
                router.push('/coach-settings');
              }}
            />
            {history.length ? <MenuItem icon={<Trash2 size={18} color={colors.danger} />} label={t('coach.clear')} danger onPress={confirmClear} /> : null}
          </Animated.View>
        </>
      ) : null}

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
          keyExtractor={(m) => keys[m.id] ?? m.id}
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
          renderItem={({ item }) => <Bubble message={item} streaming={item.streaming} review={Boolean(reviewDay && item.kind === 'morning' && item.localDate === reviewDay)} />}
        />
      )}

      <Animated.View style={[{ paddingHorizontal: Space.lg, paddingTop: Space.sm }, lift]}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: Space.sm, backgroundColor: colors.surface, borderRadius: Radius.xl, borderWidth: 1, borderColor: colors.border, padding: 6, paddingLeft: Space.lg }}>
          <TextInput
            ref={input}
            value={text}
            onChangeText={setText}
            placeholder={dictation.listening ? t('dictation.listening') : t('coach.placeholder')}
            placeholderTextColor={colors.text3}
            multiline
            // One row when empty, so the placeholder lines up with the send button.
            {...webSingleRow}
            style={[{ flex: 1, minHeight: 44, maxHeight: 140, color: colors.text, fontSize: 16, lineHeight: 20, paddingTop: 12, paddingBottom: 12 }, webInput]}
          />
          <MicButton dictation={dictation} size={44} />
          <IconButton label={t('coach.send')} variant="inverted" icon={<ArrowUp size={20} color={colors.onInverted} />} onPress={() => void submit(text)} />
        </View>
      </Animated.View>
    </View>
  );
}

/** A soft blinking caret after the last word of a reply being written. */
function Caret() {
  const { colors } = useTheme();
  const opacity = useSharedValue(1);
  useEffect(() => {
    opacity.set(withRepeat(withTiming(0.15, { duration: 500 }), -1, true));
  }, [opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[{ width: 7, height: 15, borderRadius: 2, backgroundColor: colors.accent, marginLeft: 3 }, style]} />;
}

function MenuItem({ icon, label, onPress, danger }: { icon: ReactNode; label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressy onPress={onPress} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingHorizontal: Space.lg, height: 48 }}>
      {icon}
      <Txt variant="label" tone={danger ? 'danger' : 'primary'} style={{ fontSize: 16 }}>
        {label}
      </Txt>
    </Pressy>
  );
}

/** « Point du matin · 07:20 »: what a message the coach wrote on its own is. */
function ProactiveLabel({ message }: { message: CoachMessage }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  if (message.kind !== 'morning') return null;
  return (
    <Row gap={6} style={{ paddingLeft: 4, marginBottom: -2 }}>
      <Sun size={13} color={colors.warning} />
      <Txt variant="caption" tone="secondary" style={{ fontVariant: ['tabular-nums'] }}>
        {t('proactive.label.morning', { time: localTime(toLocalDateTime(new Date(message.createdAt))) })}
      </Txt>
    </Row>
  );
}

function Bubble({ message, streaming, review }: { message: CoachMessage; streaming?: boolean; review?: boolean }) {
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
      <ProactiveLabel message={message} />
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
        {mine ? (
          <Txt color={colors.onInverted} style={{ lineHeight: 23 }} selectable>
            {message.content}
          </Txt>
        ) : (
          <Prose text={message.content} streaming={streaming} trailing={streaming ? <Caret /> : null} selectable={!streaming} />
        )}
      </View>
      {message.suggestion ? (
        <View style={{ maxWidth: '86%', backgroundColor: colors.accentSoft, borderRadius: Radius.lg, padding: Space.lg, gap: Space.sm }}>
          <Row gap={Space.sm}>
            <Sparkles size={16} color={colors.accentText} />
            <Txt variant="label" tone="accent">
              {t('coach.suggestion')}
            </Txt>
          </Row>
          <Txt variant="caption" tone="secondary">
            <InlineProse text={message.suggestion.rationale} />
          </Txt>
          <Button title={t('coach.apply')} size="md" variant="primary" onPress={() => router.push({ pathname: '/goals', params: { intentions: message.suggestion!.intentions } })} />
        </View>
      ) : null}
      {review ? (
        <Pressy onPress={() => router.navigate('/insights')} accessibilityRole="link" style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: Space.md, height: 34, borderRadius: Radius.pill, backgroundColor: colors.surface2 }}>
          <Txt variant="label">{t('proactive.reviewLink')}</Txt>
          <ChevronRight size={16} color={colors.text3} />
        </Pressy>
      ) : null}
      {/* Servers older than the app send no meal actions. */}
      {(message.mealActions ?? []).map((action, index) => (
        <MealActionCard key={index} messageId={message.id} index={index} action={action} />
      ))}
    </Animated.View>
  );
}
