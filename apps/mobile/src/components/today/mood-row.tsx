import { localTime, toLocalDateTime, type DaySummary, type MoodCheckIn } from '@symbiose/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { TextInput, View } from 'react-native';
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { MOOD_LEVELS, MoodFace, moodColor, moodLabel } from '@/components/mood-face';
import { Pressy, Row, Txt, webInput } from '@/components/ui';
import { useI18n } from '@/i18n';
import { haptics } from '@/lib/haptics';
import { useApi } from '@/lib/session';
import { Motion, Radius, Space, useTheme } from '@/theme';

const FACE = 38;

/** One face: fills with its colour and grows a touch when it's the day's mood. */
function FaceButton({ level, selected, dimmed, disabled, onPress, onLongPress }: { level: number; selected: boolean; dimmed: boolean; disabled: boolean; onPress: () => void; onLongPress: () => void }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const grow = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    grow.set(withSpring(selected ? 1 : 0, Motion.press));
  }, [selected, grow]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: 1 + grow.value * 0.14 }] }));
  const color = selected ? moodColor(level, colors) : dimmed ? colors.text3 : colors.text2;
  // Once a mood is picked, the others step back.
  const face = (
    <Animated.View style={[style, dimmed && !selected ? { opacity: 0.6 } : null]}>
      <MoodFace mood={level} size={FACE} color={color} filled={selected} fillOpacity={0.2} />
    </Animated.View>
  );
  // Past days are read-only.
  if (disabled) return <View accessible accessibilityLabel={t(moodLabel(level))} accessibilityState={{ selected }}>{face}</View>;
  return (
    <Pressy
      haptic={false}
      hitSlop={6}
      delayLongPress={400}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={t(moodLabel(level))}
      accessibilityHint={selected ? t('mood.clear') : undefined}
      accessibilityState={{ selected }}>
      {face}
    </Pressy>
  );
}

/**
 * The daily check-in: one tap on a face, changeable all day (the latest one
 * wins), an optional word, a long press on the chosen face to clear it.
 */
export function MoodRow({ date, mood, editable }: { date: string; mood: MoodCheckIn | null; editable: boolean }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const api = useApi();
  const quote = (text: string) => (locale === 'fr' ? `« ${text} »` : `“${text}”`);
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const key = ['day', date];

  /** Optimistic: the face fills at once, the server follows; a failure puts the day back. */
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

  const pick = (level: number) => {
    if (level === mood?.mood) return;
    haptics.soft();
    const next = { at: toLocalDateTime(), localDate: date, mood: level, note: mood?.note ?? null };
    void apply({ ...next, updatedAt: new Date().toISOString() }, () => api.saveMood(next));
  };
  const clear = () => {
    haptics.impact();
    setEditing(false);
    void apply(null, () => api.deleteMood(date));
  };
  const saveNote = () => {
    setEditing(false);
    if (!mood) return;
    const note = draft.trim() || null;
    if (note === mood.note) return;
    const next = { at: mood.at, localDate: date, mood: mood.mood, note };
    void apply({ ...next, updatedAt: new Date().toISOString() }, () => api.saveMood(next));
  };

  return (
    <View style={{ gap: Space.md }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt variant="overline" tone="secondary">
          {t('mood.title')}
        </Txt>
        <Txt variant="caption" tone="tertiary" style={{ fontVariant: ['tabular-nums'] }}>
          {mood ? `${t(moodLabel(mood.mood))} · ${t('mood.at', { time: localTime(mood.at) })}` : t('mood.ask')}
        </Txt>
      </Row>

      <Row style={{ justifyContent: 'space-between', paddingHorizontal: Space.xs }}>
        {MOOD_LEVELS.map((level) => (
          <FaceButton
            key={level}
            level={level}
            selected={mood?.mood === level}
            dimmed={Boolean(mood)}
            disabled={!editable}
            onPress={() => pick(level)}
            onLongPress={() => (mood?.mood === level ? clear() : pick(level))}
          />
        ))}
      </Row>

      {mood && editable ? (
        editing ? (
          <Animated.View entering={FadeIn.duration(160)}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              // Submitting blurs the field: saving on blur covers both.
              onBlur={saveNote}
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
      ) : mood?.note ? (
        <Txt variant="caption" tone="secondary" numberOfLines={2}>
          {quote(mood.note)}
        </Txt>
      ) : null}
    </View>
  );
}
