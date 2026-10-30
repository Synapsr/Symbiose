import { localTime, toLocalDateTime, type DaySummary, type MoodCheckIn } from '@symbiose/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { TextInput, View } from 'react-native';
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { MOOD_LEVELS, MoodFace, moodColor, moodLabel } from '@/components/mood-face';
import { Pressy, Row, Txt, webInput } from '@/components/ui';
import { useI18n } from '@/i18n';
import { momentOn } from '@/lib/day-logic';
import { haptics } from '@/lib/haptics';
import { useApi } from '@/lib/session';
import { Motion, Radius, Space, useTheme } from '@/theme';

/**
 * The day's check-in, optimistic: the face fills at once, the server follows;
 * a failure puts the day back. One per day, the latest one wins.
 */
export function useMood(date: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  const key = ['day', date];
  const current = () => queryClient.getQueryData<DaySummary>(key)?.mood ?? null;

  const apply = async (next: MoodCheckIn | null, send: () => Promise<unknown>) => {
    await queryClient.cancelQueries({ queryKey: key });
    queryClient.setQueryData<DaySummary>(key, (day) => (day ? { ...day, mood: next } : day));
    try {
      await send();
    } catch {
      haptics.warning();
    }
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: ['insights'] });
  };

  return {
    pick: (level: number) => {
      const mood = current();
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
      const mood = current();
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
 * The check-in, opened from Today's Humeur pill: a face, then an optional
 * word. « Effacer » undoes the day's check-in: no hidden long press.
 */
export function MoodPanel({ date, mood, onPicked }: { date: string; mood: MoodCheckIn | null; onPicked: () => void }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const { pick, clear, saveNote } = useMood(date);
  const quote = (text: string) => (locale === 'fr' ? `« ${text} »` : `“${text}”`);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  return (
    <View style={{ gap: Space.md }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt variant="label" tone="secondary" style={{ fontVariant: ['tabular-nums'] }}>
          {mood ? `${t(moodLabel(mood.mood))} · ${t('mood.at', { time: localTime(mood.at) })}` : t('mood.ask')}
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
