import { localTime, toLocalDateTime, type DaySummary, type MoodCheckIn } from '@symbiose/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { TextInput, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeInDown, FadeOut, LinearTransition, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { MOOD_LEVELS, MoodFace, moodColor, moodLabel } from '@/components/mood-face';
import { Pressy, Row, Txt, webInput } from '@/components/ui';
import { useI18n } from '@/i18n';
import { momentOn } from '@/lib/day-logic';
import { haptics } from '@/lib/haptics';
import { useApi } from '@/lib/session';
import { Motion, Radius, Space, useTheme } from '@/theme';

/** « Historique » keeps its check-ins under this prefix: `['mood-check-ins', from, to]`. */
export const MOOD_CHECK_INS = 'mood-check-ins';

/**
 * « Humeur », one concept: the day's check-in, a face and an optional word.
 * Optimistic: the face fills at once wherever the day shows (Today, « + »,
 * « Historique »), the server follows; a failure puts the day back.
 */
export function useMood(date: string, mood: MoodCheckIn | null) {
  const api = useApi();
  const queryClient = useQueryClient();
  const key = ['day', date];

  const apply = async (next: MoodCheckIn | null, send: () => Promise<unknown>) => {
    await queryClient.cancelQueries({ queryKey: key });
    queryClient.setQueryData<DaySummary>(key, (day) => (day ? { ...day, mood: next } : day));
    // In the history, a check-in already listed changes or leaves in place; new ones come with the refetch.
    queryClient.setQueriesData<MoodCheckIn[]>({ queryKey: [MOOD_CHECK_INS] }, (list) =>
      list?.flatMap((c) => (c.localDate !== date ? [c] : next ? [next] : [])),
    );
    try {
      await send();
    } catch {
      haptics.warning();
    }
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: [MOOD_CHECK_INS] });
    void queryClient.invalidateQueries({ queryKey: ['insights'] });
  };

  return {
    pick: (level: number) => {
      if (level === mood?.mood) return;
      haptics.soft();
      const next = { at: toLocalDateTime(momentOn(date)), localDate: date, mood: level, note: mood?.note ?? null };
      void apply({ ...next, updatedAt: new Date().toISOString() }, () => api.saveMood(next));
    },
    clear: () => {
      haptics.tap();
      void apply(null, () => api.deleteMood(date));
    },
    saveNote: (text: string) => {
      const note = text.trim() || null;
      if (!mood || note === mood.note) return;
      const next = { at: mood.at, localDate: date, mood: mood.mood, note };
      void apply({ ...next, updatedAt: new Date().toISOString() }, () => api.saveMood(next));
    },
  };
}

/** One face: fills with its colour and grows a touch when it's the day's mood. */
function FaceButton({ level, selected, dimmed, size, onPress }: { level: number; selected: boolean; dimmed: boolean; size: number; onPress: () => void }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const grow = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    grow.set(withSpring(selected ? 1 : 0, Motion.press));
  }, [selected, grow]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: 1 + grow.value * 0.14 }] }));
  const color = selected ? moodColor(level, colors) : dimmed ? colors.text3 : colors.text2;
  return (
    <Pressy haptic={false} hitSlop={6} onPress={onPress} accessibilityRole="button" accessibilityLabel={t(moodLabel(level))} accessibilityState={{ selected }}>
      {/* Once a mood is picked, the others step back. */}
      <Animated.View style={[style, dimmed && !selected ? { opacity: 0.6 } : null]}>
        <MoodFace mood={level} size={size} color={color} filled={selected} fillOpacity={0.2} />
      </Animated.View>
    </Pressy>
  );
}

/** The five faces, one tap each. */
export function MoodFaces({ mood, onPick, size = 38 }: { mood: number | null; onPick: (level: number) => void; size?: number }) {
  return (
    <Row style={{ justifyContent: 'space-between', paddingHorizontal: Space.xs }}>
      {MOOD_LEVELS.map((level) => (
        <FaceButton key={level} level={level} size={size} selected={mood === level} dimmed={mood !== null} onPress={() => onPick(level)} />
      ))}
    </Row>
  );
}

/**
 * The one mood UI: a face, then an optional word; « Effacer » undoes the
 * day's check-in (no hidden long press). It lives in « + », under Today's
 * Humeur pill, and opens in place from a mood row of the timeline or the
 * history. `title` names it where it sits among other things (« + »).
 */
export function MoodPanel({ date, mood, onPicked, title, size }: { date: string; mood: MoodCheckIn | null; onPicked: () => void; title?: string; size?: number }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const { pick, clear, saveNote } = useMood(date, mood);
  const quote = (text: string) => (locale === 'fr' ? `« ${text} »` : `“${text}”`);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const status = mood ? `${t(moodLabel(mood.mood))} · ${t('mood.at', { time: localTime(mood.at) })}` : null;

  return (
    <View style={{ gap: Space.md }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt variant="label" tone={title ? 'primary' : 'secondary'} numberOfLines={1} style={{ flexShrink: 1, fontVariant: ['tabular-nums'] }}>
          {title ?? status ?? t('mood.ask')}
          {title && status ? (
            <Txt variant="label" tone="secondary">
              {` · ${status}`}
            </Txt>
          ) : null}
        </Txt>
        {mood ? (
          <Pressy onPress={clear} hitSlop={8} accessibilityRole="button">
            <Txt variant="label" tone="tertiary">
              {t('mood.clearAction')}
            </Txt>
          </Pressy>
        ) : null}
      </Row>

      <MoodFaces
        mood={mood?.mood ?? null}
        size={size}
        onPick={(level) => {
          pick(level);
          // The first face of the day closes the panel; changing it later keeps the word at hand.
          if (!mood) onPicked();
        }}
      />

      {mood ? (
        editing ? (
          <Animated.View entering={FadeIn.duration(160)}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              // Submitting blurs the field: saving on blur covers both.
              onBlur={() => {
                setEditing(false);
                saveNote(draft);
              }}
              placeholder={t('mood.notePlaceholder')}
              placeholderTextColor={colors.text3}
              autoFocus
              maxLength={140}
              returnKeyType="done"
              accessibilityLabel={t('mood.addNote')}
              style={[{ height: 40, borderRadius: Radius.md, backgroundColor: colors.surface2, paddingHorizontal: Space.md, fontSize: 15, color: colors.text }, webInput]}
            />
          </Animated.View>
        ) : (
          <Pressy
            onPress={() => {
              setDraft(mood.note ?? '');
              setEditing(true);
            }}
            accessibilityRole="button"
            style={{ alignSelf: 'flex-start', paddingVertical: 2 }}>
            <Txt variant="caption" tone={mood.note ? 'secondary' : 'tertiary'} numberOfLines={2}>
              {mood.note ? quote(mood.note) : `+ ${t('mood.addNote')}`}
            </Txt>
          </Pressy>
        )
      ) : null}
    </View>
  );
}

const PAD = Space.md;
// Concentric radii, like the meal cards: the bubble's corner follows the card's corner minus the padding.
const BUBBLE_RADIUS = Radius.lg - PAD;

/**
 * A check-in in a list: Today's timeline when the Humeur pill is off, and
 * « Historique ». The face, its word and the time; a tap opens the panel in
 * place to change the face, add a word or clear it.
 */
export function MoodEntry({ mood, variant }: { mood: MoodCheckIn; variant: 'row' | 'item' }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const color = moodColor(mood.mood, colors);
  const title = t(moodLabel(mood.mood));
  const time = localTime(mood.at);
  const row = variant === 'row';

  return (
    <Animated.View
      entering={row ? FadeInDown.duration(320).easing(Easing.out(Easing.cubic)) : undefined}
      exiting={FadeOut.duration(150)}
      layout={LinearTransition.duration(250)}
      style={row ? { backgroundColor: colors.surface, borderRadius: Radius.lg, borderCurve: 'continuous' } : null}>
      <Pressy
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityLabel={`${t('mood.title')}, ${title}, ${time}${mood.note ? `. ${mood.note}` : ''}`}
        accessibilityState={{ expanded: open }}
        style={{ flexDirection: 'row', alignItems: row ? 'center' : 'flex-start', gap: Space.md, paddingVertical: row ? 10 : Space.md, paddingHorizontal: row ? PAD : Space.lg }}>
        <View style={{ width: 36, height: 36, borderRadius: BUBBLE_RADIUS, borderCurve: 'continuous', backgroundColor: `${color}24`, alignItems: 'center', justifyContent: 'center' }}>
          <MoodFace mood={mood.mood} size={22} color={color} />
        </View>
        <View style={{ flex: 1, gap: row ? 1 : 2, paddingTop: row ? 0 : 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: Space.sm }}>
            <Txt variant="label" numberOfLines={1} style={{ flex: 1, fontSize: 15 }}>
              {title}
            </Txt>
            {row ? null : (
              <Txt variant="caption" tone="tertiary" style={{ fontVariant: ['tabular-nums'] }}>
                {time}
              </Txt>
            )}
          </View>
          {mood.note ? (
            row ? (
              <Txt variant="caption" tone="secondary" numberOfLines={1}>
                {mood.note}
              </Txt>
            ) : (
              <Txt tone="secondary" style={{ fontSize: 15, lineHeight: 21 }}>
                {mood.note}
              </Txt>
            )
          ) : null}
        </View>
        {row ? (
          <Txt variant="caption" tone="tertiary" style={{ fontVariant: ['tabular-nums'] }}>
            {time}
          </Txt>
        ) : null}
      </Pressy>
      {open ? (
        <Animated.View entering={FadeInDown.duration(200)} exiting={FadeOut.duration(140)} style={{ paddingHorizontal: row ? PAD : Space.lg, paddingBottom: Space.md }}>
          <MoodPanel date={mood.localDate} mood={mood} size={34} onPicked={() => setOpen(false)} />
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}
