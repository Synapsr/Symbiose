import { Layers, Plus } from 'lucide-react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { Pressy, Txt } from '@/components/ui';
import { useI18n } from '@/i18n';
import { yourMeal, type CourseChoice } from '@/lib/courses';
import { Radius } from '@/theme';

const WHITE = '#FFFFFF';
const MINT = '#5FD6B4';

/**
 * Where the capture goes, said quietly on the camera: « Avec ton déjeuner ·
 * 12:40 » when it follows a meal closely, pre-selected. One tap makes it a
 * « Nouveau repas », another brings it back. No question asked.
 */
export function CourseChip({ choice, joined, onToggle }: { choice: CourseChoice; joined: boolean; onToggle: () => void }) {
  const { t } = useI18n();
  const meal = yourMeal(t, choice.mealType);
  const Icon = joined ? Layers : Plus;
  return (
    <Pressy
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityState={{ selected: joined }}
      accessibilityHint={joined ? t('courses.withHint') : t('courses.newMealHint', { meal })}
      style={{
        maxWidth: '64%',
        height: 36,
        paddingHorizontal: 14,
        borderRadius: Radius.pill,
        borderWidth: 1,
        borderColor: joined ? 'rgba(95,214,180,0.45)' : 'rgba(255,255,255,0.16)',
        backgroundColor: joined ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.32)',
        justifyContent: 'center',
      }}>
      {/* The words cross-fade on each tap. */}
      <Animated.View key={String(joined)} entering={FadeIn.duration(180)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon size={15} color={joined ? MINT : 'rgba(255,255,255,0.75)'} />
        <Txt variant="label" numberOfLines={1} style={{ color: WHITE, fontSize: 14, fontVariant: ['tabular-nums'], flexShrink: 1 }}>
          {joined ? t('courses.with', { meal, time: choice.time }) : t('courses.newMeal')}
        </Txt>
      </Animated.View>
    </Pressy>
  );
}
