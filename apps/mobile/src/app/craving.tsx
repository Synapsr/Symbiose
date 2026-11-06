import { toLocalDate, toLocalDateTime, type Craving, type CravingOutcome } from '@symbiose/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Lightbulb, Sparkles } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PillPicker } from '@/components/journal/pickers';
import { Button, Card, Chip, Field, Row, Skeleton, Txt } from '@/components/ui';
import { Celebration } from '@/components/ui/celebration';
import { MicButton } from '@/components/ui/mic-button';
import { InlineProse } from '@/components/ui/prose';
import { useI18n, type TranslationKey } from '@/i18n';
import { useDictation } from '@/lib/dictation';
import { feedback } from '@/lib/feedback';
import { haptics } from '@/lib/haptics';
import { errorMessage } from '@/lib/hooks';
import { endCravingActivity, startCravingActivity } from '@/lib/live-activity';
import { dismiss } from '@/lib/nav';
import { useApi } from '@/lib/session';
import { Space, useTheme } from '@/theme';

const QUICK = ['sweet', 'chocolate', 'snack', 'soda', 'salty'] as const;
const INTENSITIES = [
  { value: '1', key: 'craving.low' },
  { value: '2', key: 'craving.mid' },
  { value: '3', key: 'craving.high' },
] as const;

type Settled = Exclude<CravingOutcome, 'pending'>;

/** "tip\nalternative", whole or as it streams in. */
function splitAdvice(text: string): { tip: string; alternative: string } {
  const cut = text.indexOf('\n');
  if (cut === -1) return { tip: text.trim(), alternative: '' };
  return { tip: text.slice(0, cut).trim(), alternative: text.slice(cut + 1).replace(/\s+/g, ' ').trim() };
}

/**
 * « J'ai une envie »: saved the moment the sheet opens, the Live Activity
 * starts with it, and « J'ai tenu » / « J'ai craqué » are there at once.
 * The tip streams in for what was tapped (or for an urge in general); what
 * and how strong are optional and saved as they come.
 */
export default function CravingSheet() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const queryClient = useQueryClient();
  const [today] = useState(() => toLocalDate());
  const [what, setWhat] = useState('');
  // What the tip is written for: a chip, the words typed, or nothing said.
  const [tipFor, setTipFor] = useState('');
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState('');
  const [intensity, setIntensity] = useState<number | null>(null);
  const [advice, setAdvice] = useState<{ for: string; text: string; done: boolean } | null>(null);
  const [celebrating, setCelebrating] = useState(false);

  const create = useMutation({
    mutationFn: async () => (await api.createCraving({ at: toLocalDateTime(), localDate: today, tip: 'stream' })).craving,
    onSuccess: (craving) => {
      startCravingActivity(craving.id, t);
      void queryClient.invalidateQueries({ queryKey: ['day', today] });
    },
  });
  const { mutateAsync } = create;
  const saving = useRef<Promise<Craving> | null>(null);
  /** The craving, saved once: as the sheet opens, or again after a failure. */
  const saved = useCallback(() => {
    saving.current ??= mutateAsync().catch((error: unknown) => {
      saving.current = null;
      throw error;
    });
    return saving.current;
  }, [mutateAsync]);
  useEffect(() => {
    saved().catch(() => undefined);
  }, [saved]);

  // The tip, streamed for the current `tipFor`; a newer chip drops the older stream.
  const craving = create.data ?? null;
  useEffect(() => {
    if (!craving) return;
    const controller = new AbortController();
    let text = '';
    api
      .streamCravingTip(
        craving.id,
        tipFor ? { what: tipFor } : {},
        (delta) => {
          text += delta;
          setAdvice({ for: tipFor, text, done: false });
        },
        controller.signal,
      )
      .then(({ craving: withTip, alternative }) => setAdvice({ for: tipFor, text: `${withTip.tip ?? text}\n${alternative}`, done: true }))
      .catch(() => {
        // Offline or interrupted: a kind tip of our own (below), never an error in the middle of a craving.
        if (!controller.signal.aborted) setAdvice({ for: tipFor, text: '', done: true });
      });
    return () => controller.abort();
  }, [api, craving, tipFor]);

  const keep = (patch: { what?: string; intensity?: number | null }) => {
    saved()
      .then((c) => api.updateCraving(c.id, patch))
      .catch(() => undefined);
  };
  const pickWhat = (label: string) => {
    const next = what === label ? '' : label;
    setWhat(next);
    setTyping(false);
    if (next) setTipFor(next);
    keep({ what: next });
  };
  const submitDraft = () => {
    const words = draft.trim();
    setTyping(false);
    if (words && words !== what) pickWhat(words);
  };

  const settle = useMutation({
    mutationFn: async (outcome: Settled) => api.updateCraving((await saved()).id, { outcome, what, intensity }),
    onSuccess: (settled, outcome) => {
      endCravingActivity(settled.id, outcome);
      void queryClient.invalidateQueries({ queryKey: ['day', today] });
      void queryClient.invalidateQueries({ queryKey: ['insights'] });
      // A craving beaten can be a milestone: celebrated once this sheet has closed.
      void queryClient.invalidateQueries({ queryKey: ['progress'] });
      if (outcome === 'resisted') {
        setCelebrating(true);
        setTimeout(() => dismiss(), 1900);
      } else {
        router.replace({ pathname: '/capture', params: { mode: 'text' } });
      }
    },
    onError: () => haptics.warning(),
  });

  // Once the sheet (and any dictation in it) has let go: the crescendo, with the celebration.
  useEffect(() => {
    if (celebrating) feedback.resisted();
  }, [celebrating]);

  if (celebrating) return <Celebration emoji="💪" title={t('craving.celebrate')} subtitle={t('craving.celebrateBody')} />;

  const shown = advice?.for === tipFor ? advice : null;
  // No network, or no answer: a kind tip of our own rather than a skeleton that never fills.
  const offline = (shown?.done && !shown.text) || (create.isError && !craving);
  const { tip, alternative } = splitAdvice(offline ? t('craving.tipOffline') : (shown?.text ?? ''));
  const quick = QUICK.map((key) => t(`craving.${key}` as TranslationKey));
  const typed = what && !quick.includes(what) ? what : '';
  const failed = settle.error ?? (create.error && !craving ? create.error : null);

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: Space.xl, paddingTop: Space.xxl, paddingBottom: insets.bottom + Space.xxl, gap: Space.xl, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
      <View style={{ gap: Space.sm }}>
        <Txt variant="title">{t('craving.title')}</Txt>
        <Txt tone="secondary">{t('craving.subtitle')}</Txt>
      </View>

      <View style={{ gap: Space.sm }}>
        <Txt variant="caption" tone="secondary" style={{ marginLeft: 4 }}>
          {t('craving.what')}
        </Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm }}>
          {quick.map((label) => (
            <Chip key={label} label={label} selected={what === label} onPress={() => pickWhat(label)} />
          ))}
          <Chip
            label={typed || t('craving.other')}
            selected={Boolean(typed) || typing}
            onPress={() => {
              setDraft(typed);
              setTyping(true);
            }}
          />
        </View>
        {typing ? (
          <Animated.View entering={FadeIn.duration(160)}>
            <OtherField value={draft} onChange={setDraft} onSubmit={submitDraft} />
          </Animated.View>
        ) : null}
      </View>

      {/* Room for the tip from the start: it streams in without moving the buttons. */}
      <Card style={{ gap: Space.sm, backgroundColor: colors.accentSoft, borderColor: 'transparent' }} accessibilityLiveRegion="polite">
        <Row gap={Space.sm}>
          <Sparkles size={18} color={colors.accentText} />
          <Txt variant="overline" tone="accent">
            {t('craving.tip')}
          </Txt>
        </Row>
        <View style={{ minHeight: 75 }}>
          {tip ? (
            <Txt style={{ fontSize: 18, lineHeight: 25 }}>
              <InlineProse text={tip} streaming={!shown?.done} />
            </Txt>
          ) : (
            <View style={{ gap: 10, paddingTop: 6 }}>
              <Skeleton width="94%" height={14} />
              <Skeleton width="72%" height={14} />
            </View>
          )}
        </View>
        <View style={{ minHeight: 42 }}>
          {alternative ? (
            <Animated.View entering={FadeIn.duration(220)}>
              <Row gap={Space.sm} style={{ alignItems: 'flex-start' }}>
                <Lightbulb size={16} color={colors.warning} style={{ marginTop: 2 }} />
                <Txt tone="secondary" style={{ flex: 1, fontSize: 15, lineHeight: 21 }}>
                  <InlineProse text={alternative} streaming={!shown?.done} />
                </Txt>
              </Row>
            </Animated.View>
          ) : null}
        </View>
      </Card>

      <View style={{ gap: Space.md }}>
        <Button title={t('craving.resisted')} variant="accent" onPress={() => settle.mutate('resisted')} loading={settle.isPending && settle.variables === 'resisted'} disabled={settle.isPending} />
        <Button title={t('craving.gaveIn')} variant="secondary" onPress={() => settle.mutate('gave_in')} loading={settle.isPending && settle.variables === 'gave_in'} disabled={settle.isPending} />
        <Txt variant="caption" tone="tertiary" style={{ textAlign: 'center' }}>
          {t('craving.gaveInHint')}
        </Txt>
        {failed ? (
          <Txt variant="caption" tone="warning" style={{ textAlign: 'center' }}>
            {errorMessage(failed, t('common.error'), t('common.offline'))}
          </Txt>
        ) : null}
      </View>

      <PillPicker
        label={t('craving.intensity')}
        options={INTENSITIES.map((option) => ({ value: option.value, label: t(option.key) }))}
        value={intensity === null ? undefined : (String(intensity) as (typeof INTENSITIES)[number]['value'])}
        onChange={(value) => {
          const next = value ? Number(value) : null;
          setIntensity(next);
          keep({ intensity: next });
        }}
      />
    </ScrollView>
  );
}

/** « Autre » in its own words, typed or dictated; closing it ends the dictation. */
function OtherField({ value, onChange, onSubmit }: { value: string; onChange: (text: string) => void; onSubmit: () => void }) {
  const { t } = useI18n();
  const dictation = useDictation(value, onChange);
  return (
    <Field
      value={value}
      onChangeText={onChange}
      placeholder={dictation.listening ? t('dictation.listening') : t('craving.otherPlaceholder')}
      autoFocus
      maxLength={80}
      returnKeyType="done"
      onSubmitEditing={onSubmit}
      onBlur={onSubmit}
      accessory={<MicButton dictation={dictation} />}
      highlighted={dictation.listening}
    />
  );
}
