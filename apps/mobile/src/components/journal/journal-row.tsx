import type { JournalEntry } from '@symbiose/shared';
import { router } from 'expo-router';
import { View } from 'react-native';
import Animated, { Easing, FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';

import { Pressy, Txt } from '@/components/ui';
import { useI18n } from '@/i18n';
import { useDeleteNote } from '@/lib/journal';
import { Radius, Space, useTheme } from '@/theme';

import { headline, KindBubble, noteTime } from './meta';

const PAD = Space.md;
// Concentric radii, like the meal cards: the bubble's corner follows the card's corner minus the padding.
const BUBBLE_RADIUS = Radius.lg - PAD;

const openNote = (entry: JournalEntry, from?: 'journal') => router.push({ pathname: '/note', params: { id: entry.id, date: entry.localDate, ...(from ? { from } : null) } });

/**
 * A note in Today's timeline: the meal cards' shape, flatter and smaller so
 * meals stay the main thing. Tap to edit, long-press to delete.
 */
export function JournalRow({ entry }: { entry: JournalEntry }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const remove = useDeleteNote();
  const free = entry.kind === 'other';
  const title = free ? entry.text : headline(entry, t);
  const detail = free ? null : entry.text || null;

  return (
    <Animated.View entering={FadeInDown.duration(320).easing(Easing.out(Easing.cubic))} exiting={FadeOut.duration(150)} layout={LinearTransition.duration(250)}>
      <Pressy
        onPress={() => openNote(entry)}
        onLongPress={() => remove(entry)}
        delayLongPress={400}
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${noteTime(entry)}`}
        accessibilityHint={t('journal.editTitle')}
        style={{ flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingVertical: 10, paddingHorizontal: PAD, backgroundColor: colors.surface, borderRadius: Radius.lg, borderCurve: 'continuous' }}>
        <KindBubble entry={entry} radius={BUBBLE_RADIUS} />
        <View style={{ flex: 1, gap: 1 }}>
          <Txt variant="label" numberOfLines={1} style={{ fontSize: 15 }}>
            {title}
          </Txt>
          {detail ? (
            <Txt variant="caption" tone="secondary" numberOfLines={1}>
              {detail}
            </Txt>
          ) : null}
        </View>
        <Txt variant="caption" tone="tertiary" style={{ fontVariant: ['tabular-nums'] }}>
          {noteTime(entry)}
        </Txt>
      </Pressy>
    </Animated.View>
  );
}

/** A note in the Carnet: the whole text, in a day's group. */
export function JournalItem({ entry }: { entry: JournalEntry }) {
  const { t } = useI18n();
  const remove = useDeleteNote();
  const free = entry.kind === 'other';
  return (
    <Pressy
      onPress={() => openNote(entry, 'journal')}
      onLongPress={() => remove(entry)}
      delayLongPress={400}
      accessibilityRole="button"
      accessibilityLabel={`${headline(entry, t)}, ${noteTime(entry)}${entry.text ? `. ${entry.text}` : ''}`}
      accessibilityHint={t('journal.editTitle')}
      style={{ flexDirection: 'row', alignItems: 'flex-start', gap: Space.md, paddingHorizontal: Space.lg, paddingVertical: Space.md }}>
      <KindBubble entry={entry} radius={BUBBLE_RADIUS} />
      <View style={{ flex: 1, gap: 2, paddingTop: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: Space.sm }}>
          <Txt variant="label" tone={free ? 'tertiary' : 'primary'} numberOfLines={1} style={{ flex: 1, fontSize: 15 }}>
            {headline(entry, t)}
          </Txt>
          <Txt variant="caption" tone="tertiary" style={{ fontVariant: ['tabular-nums'] }}>
            {noteTime(entry)}
          </Txt>
        </View>
        {entry.text ? (
          <Txt tone={free ? 'primary' : 'secondary'} style={{ fontSize: 15, lineHeight: 21 }}>
            {entry.text}
          </Txt>
        ) : null}
      </View>
    </Pressy>
  );
}
