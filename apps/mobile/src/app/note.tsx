import {
  CONSISTENCY_BRISTOL,
  consistencyOf,
  isMeaningfulEntry,
  journalDataFor,
  JournalKindSchema,
  STOOL_CONSISTENCIES,
  toLocalDate,
  toLocalDateTime,
  TRANSIT_EASES,
  type JournalEntry,
  type JournalKind,
  type TransitEase,
} from '@symbiose/shared';
import { useMutation } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Clock, Lock, Minus, Plus, Trash2 } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, ScrollView, TextInput, View, type TextInputInstance } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { headline } from '@/components/journal/meta';
import { FeelingPicker, KindChips, PillPicker } from '@/components/journal/pickers';
import { Button, Chip, IconButton, Row, Txt, webInput } from '@/components/ui';
import { useI18n, type TranslationKey } from '@/i18n';
import { formatDay } from '@/lib/format';
import { haptics } from '@/lib/haptics';
import { errorMessage } from '@/lib/hooks';
import { useCachedNote, useDeleteNote, useJournal, useRefreshAfterNote } from '@/lib/journal';
import { dismiss } from '@/lib/nav';
import { useApi } from '@/lib/session';
import { useToast } from '@/lib/stores';
import { Radius, Space, useTheme } from '@/theme';

const QUARTER = 15 * 60_000;

/** Quick times for « ce matin »-style notes: today's that have passed, or the parts of a past day. */
function timePresets(date: string, now: Date): { key: TranslationKey; at: Date }[] {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const on = (hour: number, minute = 0, dayOffset = 0) => new Date(y, m - 1, d + dayOffset, hour, minute);
  if (date !== toLocalDate(now)) {
    return [
      { key: 'journal.time.dayMorning', at: on(8) },
      { key: 'journal.time.dayNoon', at: on(12, 30) },
      { key: 'journal.time.dayAfternoon', at: on(16) },
      { key: 'journal.time.dayEvening', at: on(20) },
    ];
  }
  const presets: { key: TranslationKey; at: Date }[] = [
    { key: 'journal.time.now', at: now },
    { key: 'journal.time.hourAgo', at: new Date(now.getTime() - 4 * QUARTER) },
    { key: 'journal.time.morning', at: on(8) },
    { key: 'journal.time.noon', at: on(12, 30) },
    { key: 'journal.time.afternoon', at: on(16) },
    { key: 'journal.time.yesterdayEvening', at: on(21, 0, -1) },
  ];
  return presets.filter((p) => p.at <= now);
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const hhmm = (date: Date) => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

/** Write or edit a note: one big field, a kind if you like, a time if it wasn't now. */
export default function NoteSheet() {
  const params = useLocalSearchParams<{ id?: string; kind?: string; date?: string; from?: string }>();
  const { t } = useI18n();
  const { colors } = useTheme();
  const today = toLocalDate();
  const date = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) && params.date <= today ? params.date : today;
  // Opened from a list, the note is already in memory; after a reload, fetch its day.
  const cached = useCachedNote(params.id);
  const day = useJournal({ from: date, to: date }, { enabled: Boolean(params.id) && !cached });
  const entry = cached ?? day.data?.find((e) => e.id === params.id);

  if (params.id && !entry) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: Space.xl, gap: Space.lg }}>
        {day.isPending ? (
          <ActivityIndicator color={colors.text2} />
        ) : (
          <>
            <Txt tone="secondary">{day.error ? errorMessage(day.error, t('common.error'), t('common.offline')) : t('journal.empty.kind')}</Txt>
            <Button title={t('common.close')} variant="secondary" size="md" onPress={() => dismiss()} />
          </>
        )}
      </View>
    );
  }
  const kind = JournalKindSchema.safeParse(params.kind);
  return <NoteForm key={entry?.id ?? 'new'} entry={entry} date={date} initialKind={kind.success ? kind.data : 'other'} fromJournal={params.from === 'journal'} />;
}

function NoteForm({ entry, date, initialKind, fromJournal }: { entry: JournalEntry | undefined; date: string; initialKind: JournalKind; fromJournal: boolean }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const refresh = useRefreshAfterNote();
  const showToast = useToast((s) => s.show);
  const remove = useDeleteNote(() => dismiss());
  const input = useRef<TextInputInstance>(null);

  const [now] = useState(() => new Date());
  const [kind, setKind] = useState<JournalKind>(entry?.kind ?? initialKind);
  const [text, setText] = useState(entry?.text ?? '');
  const [bristol, setBristol] = useState(entry?.data.bristol);
  const [ease, setEase] = useState(entry?.data.ease);
  const [feeling, setFeeling] = useState(entry?.data.feeling);
  const [when, setWhen] = useState(() => {
    if (entry) return new Date(entry.at);
    if (date === toLocalDate(now)) return now;
    // A past day: that day, at this time of day.
    const [y, m, d] = date.split('-').map(Number) as [number, number, number];
    return new Date(y, m - 1, d, now.getHours(), now.getMinutes());
  });
  const [focused, setFocused] = useState(false);

  const data = journalDataFor(kind, { bristol, ease, feeling });
  const fields = { at: toLocalDateTime(when), localDate: toLocalDate(when), kind, text: text.trim(), data };
  const ready = isMeaningfulEntry(fields);
  const presets = timePresets(date, now);

  const save = useMutation({
    mutationFn: () => (entry ? api.updateNote(entry.id, fields) : api.createNote(fields)),
    onSuccess: (saved) => {
      haptics.success();
      refresh();
      const label = saved.kind === 'other' ? '' : ` · ${headline(saved, t)}`;
      showToast({
        message: `${entry ? t('journal.updated') : t('journal.saved')}${label}`,
        onPress: () => router.push('/journal'),
        action: {
          label: t('today.undo'),
          onPress: () => {
            const undo = entry ? api.updateNote(entry.id, { at: entry.at, localDate: entry.localDate, kind: entry.kind, text: entry.text, data: entry.data }) : api.deleteNote(saved.id);
            void undo.then(refresh);
          },
        },
      });
      dismiss();
    },
    onError: () => haptics.warning(),
  });

  const pickKind = (next: JournalKind) => {
    setKind(next);
    // The pickers need the room and the words are optional there; elsewhere, words are the note.
    if (next !== 'transit' && next !== 'feeling') input.current?.focus();
    else if (!text.trim()) Keyboard.dismiss();
  };
  const nudge = (delta: number) => {
    haptics.tap();
    setWhen((w) => new Date(Math.min(now.getTime(), w.getTime() + delta)));
  };

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: Space.xl, paddingTop: Space.xxl, paddingBottom: insets.bottom + Space.xxl, gap: Space.xl, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
      <View style={{ gap: 4 }}>
        <Row gap={Space.md} style={{ justifyContent: 'space-between' }}>
          <Txt variant="title" numberOfLines={1} style={{ flexShrink: 1 }}>
            {entry ? t('journal.editTitle') : t('journal.newTitle')}
          </Txt>
          {/* Up top so the keyboard never hides it. */}
          <Button title={entry ? t('common.save') : t('journal.save')} size="md" onPress={() => save.mutate()} disabled={!ready} loading={save.isPending} />
        </Row>
        <Row gap={5}>
          <Lock size={12} color={colors.text3} />
          <Txt variant="caption" tone="tertiary">
            {t('journal.privacy')}
          </Txt>
        </Row>
      </View>

      <KindChips value={kind} onChange={pickKind} />

      {kind === 'transit' ? (
        <Animated.View key="transit" entering={FadeInDown.duration(240)} style={{ gap: Space.lg }}>
          <PillPicker
            label={t('journal.consistency')}
            options={STOOL_CONSISTENCIES.map((value) => ({ value, label: t(`journal.consistency.${value}`) }))}
            value={bristol === undefined ? undefined : consistencyOf(bristol)}
            onChange={(value) => setBristol(value ? CONSISTENCY_BRISTOL[value] : undefined)}
          />
          <PillPicker<TransitEase> label={t('journal.ease')} options={TRANSIT_EASES.map((value) => ({ value, label: t(`journal.ease.${value}`) }))} value={ease} onChange={setEase} />
        </Animated.View>
      ) : kind === 'feeling' ? (
        <Animated.View key="feeling" entering={FadeInDown.duration(240)}>
          <FeelingPicker value={feeling} onChange={setFeeling} />
        </Animated.View>
      ) : null}

      <TextInput
        ref={input}
        value={text}
        onChangeText={setText}
        placeholder={t(`journal.placeholder.${kind}`)}
        placeholderTextColor={colors.text3}
        multiline
        maxLength={2000}
        autoFocus={!entry && initialKind === 'other'}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[
          {
            minHeight: 128,
            borderRadius: Radius.lg,
            borderCurve: 'continuous',
            backgroundColor: colors.surface,
            borderWidth: 1.5,
            borderColor: focused ? colors.text : colors.border,
            padding: Space.lg,
            paddingTop: Space.lg,
            fontSize: 18,
            lineHeight: 25,
            color: colors.text,
            textAlignVertical: 'top',
          },
          webInput,
        ]}
      />

      <View style={{ gap: Space.sm }}>
        <Row style={{ justifyContent: 'space-between', marginLeft: 4 }}>
          <Row gap={6}>
            <Clock size={14} color={colors.text2} />
            <Txt variant="caption" tone="secondary">
              {t('journal.when')}
            </Txt>
            <Animated.View key={when.getTime()} entering={FadeIn.duration(180)}>
              <Txt variant="label" style={{ fontVariant: ['tabular-nums'] }}>
                {toLocalDate(when) === date ? hhmm(when) : `${capitalize(formatDay(toLocalDate(when), locale, { today: t('common.today'), yesterday: t('common.yesterday') }))} · ${hhmm(when)}`}
              </Txt>
            </Animated.View>
          </Row>
          <Row gap={6}>
            <IconButton label={t('journal.earlier')} size={34} icon={<Minus size={16} color={colors.text} />} onPress={() => nudge(-QUARTER)} />
            <IconButton label={t('journal.later')} size={34} icon={<Plus size={16} color={when.getTime() + QUARTER > now.getTime() ? colors.text3 : colors.text} />} onPress={() => nudge(QUARTER)} />
          </Row>
        </Row>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ marginHorizontal: -Space.xl }} contentContainerStyle={{ gap: 6, paddingHorizontal: Space.xl, paddingVertical: 4 }}>
          {presets.map((preset) => {
            const selected = Math.abs(preset.at.getTime() - when.getTime()) < 60_000;
            return (
              <Chip
                key={preset.key}
                label={preset.key === 'journal.time.now' ? t(preset.key) : `${t(preset.key)} · ${hhmm(preset.at)}`}
                selected={selected}
                onPress={() => setWhen(preset.at)}
              />
            );
          })}
        </ScrollView>
      </View>

      {save.error ? (
        <Txt variant="caption" tone="warning">
          {errorMessage(save.error, t('common.error'), t('common.offline'))}
        </Txt>
      ) : null}
      {entry ? (
        <Row gap={Space.sm} style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
          <Button title={t('common.delete')} variant="danger" size="md" icon={<Trash2 size={16} color={colors.danger} />} onPress={() => remove(entry)} />
          {!fromJournal ? <Button title={t('journal.seeAll')} variant="ghost" size="md" onPress={() => router.replace('/journal')} /> : null}
        </Row>
      ) : null}
    </ScrollView>
  );
}
