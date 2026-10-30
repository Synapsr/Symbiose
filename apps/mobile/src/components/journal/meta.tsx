import { consistencyOf, localTime, type JournalEntry, type JournalKind } from '@symbiose/shared';
import { FaceSlightlySmiling, NotebookPen, Pill, Thermometer, Toilet, type LucideIcon } from 'lucide-react-native';
import { View } from 'react-native';

import { MoodFace, moodColor } from '@/components/mood-face';
import type { TranslationKey } from '@/i18n';
import { useTheme, type Palette } from '@/theme';

type T = (key: TranslationKey, params?: Record<string, string | number>) => string;

/** Calm hues: a symptom is noted, never alarming. */
export const KIND_META: Record<JournalKind, { icon: LucideIcon; color: (colors: Palette) => string }> = {
  transit: { icon: Toilet, color: () => '#B48A58' },
  feeling: { icon: FaceSlightlySmiling, color: () => '#9584C8' },
  symptom: { icon: Thermometer, color: () => '#D98166' },
  medication: { icon: Pill, color: () => '#5B8DEF' },
  other: { icon: NotebookPen, color: (colors) => colors.text2 },
};

export const kindLabel = (kind: JournalKind): TranslationKey => `journal.kind.${kind}`;
export const feelingLabel = (feeling: number): TranslationKey => `journal.feeling.${Math.min(5, Math.max(1, Math.round(feeling)))}` as TranslationKey;

/** « Transit · normal, facile », « Bien », « Symptôme »: the structured part of a note, in words. */
export function headline(entry: Pick<JournalEntry, 'kind' | 'data'>, t: T): string {
  const { bristol, ease, feeling } = entry.data;
  switch (entry.kind) {
    case 'transit': {
      const details = [bristol !== undefined ? t(`journal.consistency.${consistencyOf(bristol)}`) : null, ease ? t(`journal.ease.${ease}`) : null].filter(Boolean);
      return details.length ? `${t('journal.kind.transit')} · ${details.join(', ').toLowerCase()}` : t('journal.kind.transit');
    }
    case 'feeling':
      return feeling !== undefined ? t(feelingLabel(feeling)) : t('journal.kind.feeling');
    case 'other':
      return t('journal.kind.otherShort');
    default:
      return t(kindLabel(entry.kind));
  }
}

export const noteTime = (entry: Pick<JournalEntry, 'at'>) => localTime(entry.at);

/** The kind's icon in a tinted bubble; a feeling with a face shows the face. */
export function KindBubble({ entry, size = 36, radius }: { entry: Pick<JournalEntry, 'kind' | 'data'>; size?: number; radius: number }) {
  const { colors } = useTheme();
  const { feeling } = entry.data;
  const color = entry.kind === 'feeling' && feeling !== undefined ? moodColor(feeling, colors) : KIND_META[entry.kind].color(colors);
  const Icon = KIND_META[entry.kind].icon;
  return (
    <View style={{ width: size, height: size, borderRadius: radius, borderCurve: 'continuous', backgroundColor: entry.kind === 'other' ? colors.surface2 : `${color}24`, alignItems: 'center', justifyContent: 'center' }}>
      {entry.kind === 'feeling' && feeling !== undefined ? <MoodFace mood={feeling} size={size * 0.6} color={color} /> : <Icon size={size * 0.48} color={color} />}
    </View>
  );
}
