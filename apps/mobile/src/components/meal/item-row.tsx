import { itemNutrients, type FoodItem } from '@symbiose/shared';
import { Trash2 } from 'lucide-react-native';
import { View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { Dot, IconButton, Pressy, Row, Txt } from '@/components/ui';
import { useI18n } from '@/i18n';
import { formatAmount, formatNumber } from '@/lib/format';
import { NUTRIENT_COLORS, Radius, Space, useTheme } from '@/theme';

import { PortionStepper } from './portion-stepper';

export function ItemRow({
  item,
  baseGrams,
  expanded,
  onToggle,
  onChange,
  onRemove,
  hideCalories,
}: {
  item: FoodItem;
  baseGrams: number;
  expanded: boolean;
  onToggle: () => void;
  onChange: (grams: number) => void;
  onRemove: () => void;
  hideCalories: boolean;
}) {
  const { t, locale, nutrientShort } = useI18n();
  const { colors } = useTheme();
  const n = itemNutrients(item);
  const uncertain = item.confidence !== null && item.confidence < 0.6;

  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: expanded ? colors.text3 : colors.border, overflow: 'hidden' }}>
      <Pressy onPress={onToggle} style={{ flexDirection: 'row', alignItems: 'center', gap: Space.md, padding: Space.lg }}>
        <Txt style={{ fontSize: 26, width: 34, textAlign: 'center' }}>{item.emoji || '•'}</Txt>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="label" style={{ fontSize: 16, opacity: uncertain ? 0.7 : 1 }} numberOfLines={2}>
            {item.name}
          </Txt>
          <Txt variant="caption" tone="secondary">
            {[item.portion, `${item.grams} g`, item.brand].filter(Boolean).join(' · ')}
          </Txt>
          {uncertain ? (
            <Txt variant="caption" tone="warning">
              ≈ {t('detail.lowConfidence')}
            </Txt>
          ) : null}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          {!hideCalories ? <Txt variant="label">{formatNumber(n.kcal, locale)}</Txt> : null}
          <Row gap={5}>
            <Dot color={NUTRIENT_COLORS.addedSugar} size={6} />
            <Txt variant="caption" tone="tertiary">
              {formatAmount('addedSugar', n.addedSugar, locale)}
            </Txt>
          </Row>
        </View>
      </Pressy>
      {expanded ? (
        <Animated.View entering={FadeIn.duration(180)} style={{ paddingHorizontal: Space.lg, paddingBottom: Space.lg, gap: Space.md }}>
          <PortionStepper grams={item.grams} base={baseGrams} onChange={onChange} />
          <Row style={{ justifyContent: 'space-between' }}>
            <Txt variant="caption" tone="secondary" style={{ flex: 1 }}>
              {(['protein', 'carbs', 'fat', 'fiber'] as const).map((k) => `${nutrientShort(k)} ${formatAmount(k, n[k], locale)}`).join(' · ')}
            </Txt>
            <IconButton label={t('common.delete')} size={38} icon={<Trash2 size={18} color={colors.danger} />} onPress={onRemove} />
          </Row>
        </Animated.View>
      ) : null}
    </View>
  );
}
