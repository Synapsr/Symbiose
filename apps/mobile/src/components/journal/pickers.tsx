import { JOURNAL_KINDS, type JournalKind } from '@symbiose/shared';
import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { MOOD_LEVELS, MoodFace, moodColor, moodLabel } from '@/components/mood-face';
import { Pressy, Row, Txt } from '@/components/ui';
import { useI18n } from '@/i18n';
import { haptics } from '@/lib/haptics';
import { Motion, Radius, Space, useTheme } from '@/theme';

import { KIND_META, kindLabel } from './meta';

/** The kinds, a touch more compact than the regular chips so all five fit on two lines. */
export function KindChips({ value, onChange }: { value: JournalKind; onChange: (kind: JournalKind) => void }) {
  const { t } = useI18n();
  const { colors, elevation } = useTheme();
  return (
    <Row gap={6} style={{ flexWrap: 'wrap' }}>
      {JOURNAL_KINDS.map((kind) => {
        const Icon = KIND_META[kind].icon;
        const selected = value === kind;
        return (
          <Pressy
            key={kind}
            onPress={() => onChange(kind)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={[
              { flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingHorizontal: 13, borderRadius: Radius.pill, backgroundColor: selected ? colors.inverted : colors.surface },
              selected ? null : elevation,
            ]}>
            <Icon size={15} color={selected ? colors.onInverted : KIND_META[kind].color(colors)} />
            <Txt variant="label" color={selected ? colors.onInverted : colors.text}>
              {t(kindLabel(kind))}
            </Txt>
          </Pressy>
        );
      })}
    </Row>
  );
}

/** One-tap choice among a few words; tapping the chosen one again clears it (every field is optional). */
export function PillPicker<T extends string>({ label, options, value, onChange }: { label: string; options: { value: T; label: string }[]; value: T | undefined; onChange: (value: T | undefined) => void }) {
  const { colors, elevation } = useTheme();
  return (
    <View style={{ gap: Space.sm }}>
      <Txt variant="caption" tone="secondary" style={{ marginLeft: 4 }}>
        {label}
      </Txt>
      <Row gap={6} style={{ flexWrap: 'wrap' }}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressy
              key={option.value}
              onPress={() => onChange(selected ? undefined : option.value)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={[
                { height: 38, paddingHorizontal: 15, borderRadius: Radius.pill, justifyContent: 'center', backgroundColor: selected ? colors.inverted : colors.surface },
                selected ? null : elevation,
              ]}>
              <Txt variant="label" color={selected ? colors.onInverted : colors.text}>
                {option.label}
              </Txt>
            </Pressy>
          );
        })}
      </Row>
    </View>
  );
}

const FACE = 40;

function Face({ level, selected, dimmed, onPress }: { level: number; selected: boolean; dimmed: boolean; onPress: () => void }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const grow = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    grow.set(withSpring(selected ? 1 : 0, Motion.press));
  }, [selected, grow]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: 1 + grow.value * 0.14 }] }));
  const color = selected ? moodColor(level, colors) : colors.text2;
  return (
    <Pressy haptic={false} hitSlop={6} onPress={onPress} accessibilityRole="button" accessibilityLabel={t(moodLabel(level))} accessibilityState={{ selected }}>
      <Animated.View style={[style, dimmed ? { opacity: 0.45 } : null]}>
        <MoodFace mood={level} size={FACE} color={color} filled={selected} fillOpacity={0.2} />
      </Animated.View>
    </Pressy>
  );
}

/** Five faces, from very low to very good; the chosen one grows and names itself. */
export function FeelingPicker({ value, onChange }: { value: number | undefined; onChange: (value: number | undefined) => void }) {
  const { t } = useI18n();
  return (
    <View style={{ gap: Space.sm }}>
      <Row style={{ justifyContent: 'space-between', marginHorizontal: 4 }}>
        <Txt variant="caption" tone="secondary">
          {t('journal.feeling')}
        </Txt>
        {value !== undefined ? (
          <Animated.View key={value} entering={FadeIn.duration(200)}>
            <Txt variant="caption" tone="primary" style={{ fontWeight: '600' }}>
              {t(moodLabel(value))}
            </Txt>
          </Animated.View>
        ) : null}
      </Row>
      <Row style={{ justifyContent: 'space-between', paddingHorizontal: Space.sm }}>
        {MOOD_LEVELS.map((level) => (
          <Face
            key={level}
            level={level}
            selected={value === level}
            dimmed={value !== undefined && value !== level}
            onPress={() => {
              haptics.tap();
              onChange(value === level ? undefined : level);
            }}
          />
        ))}
      </Row>
    </View>
  );
}
