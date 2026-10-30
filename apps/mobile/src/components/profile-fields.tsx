import type { ActivityLevel, Sex } from '@symbiose/shared';
import { Check } from 'lucide-react-native';
import { View } from 'react-native';

import { Field, Pressy, Row, Txt } from '@/components/ui';
import { useI18n, type TranslationKey } from '@/i18n';
import { Radius, Space, useTheme } from '@/theme';

function Option({ title, description, selected, onPress }: { title: string; description?: string; selected: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressy
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={{
        minHeight: 64,
        borderRadius: Radius.lg,
        paddingHorizontal: Space.xl,
        paddingVertical: Space.md,
        backgroundColor: selected ? colors.inverted : colors.surface,
        borderWidth: 1,
        borderColor: selected ? 'transparent' : colors.border,
        flexDirection: 'row',
        alignItems: 'center',
        gap: Space.md,
      }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="label" style={{ fontSize: 17 }} color={selected ? colors.onInverted : colors.text}>
          {title}
        </Txt>
        {description ? (
          <Txt variant="caption" color={selected ? colors.onInverted : colors.text2} style={{ opacity: selected ? 0.75 : 1 }}>
            {description}
          </Txt>
        ) : null}
      </View>
      {selected ? <Check size={20} color={colors.onInverted} /> : null}
    </Pressy>
  );
}

export function SexPicker({ value, onChange }: { value: Sex | null; onChange: (v: Sex) => void }) {
  const { t } = useI18n();
  return (
    <View style={{ gap: Space.sm }}>
      {(['female', 'male', 'other'] as const).map((sex) => (
        <Option key={sex} title={t(`onb.sex.${sex}`)} selected={value === sex} onPress={() => onChange(sex)} />
      ))}
    </View>
  );
}

const LEVELS: ActivityLevel[] = ['sedentary', 'light', 'moderate', 'active', 'athlete'];

export function ActivityPicker({ value, onChange }: { value: ActivityLevel | null; onChange: (v: ActivityLevel) => void }) {
  const { t } = useI18n();
  return (
    <View style={{ gap: Space.sm }}>
      {LEVELS.map((level) => (
        <Option
          key={level}
          title={t(`onb.activity.${level}` as TranslationKey)}
          description={t(`onb.activity.${level}.desc` as TranslationKey)}
          selected={value === level}
          onPress={() => onChange(level)}
        />
      ))}
    </View>
  );
}

export interface BodyValues {
  birthYear: string;
  heightCm: string;
  weightKg: string;
}

export function BodyFields({ value, onChange }: { value: BodyValues; onChange: (v: BodyValues) => void }) {
  const { t } = useI18n();
  return (
    <View style={{ gap: Space.md }}>
      <Field label={t('onb.body.birthYear')} value={value.birthYear} onChangeText={(birthYear) => onChange({ ...value, birthYear })} keyboardType="number-pad" maxLength={4} placeholder="1995" />
      <Row gap={Space.md}>
        <View style={{ flex: 1 }}>
          <Field label={t('onb.body.height')} value={value.heightCm} onChangeText={(heightCm) => onChange({ ...value, heightCm })} keyboardType="number-pad" maxLength={3} placeholder="175" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label={t('onb.body.weight')} value={value.weightKg} onChangeText={(weightKg) => onChange({ ...value, weightKg })} keyboardType="decimal-pad" maxLength={5} placeholder="70" />
        </View>
      </Row>
    </View>
  );
}

export function parseBody(value: BodyValues): { birthYear: number; heightCm: number; weightKg: number } | null {
  const birthYear = Number(value.birthYear);
  const heightCm = Number(value.heightCm);
  const weightKg = Number(value.weightKg.replace(',', '.'));
  const year = new Date().getFullYear();
  if (!(birthYear > 1900 && birthYear <= year - 12)) return null;
  if (!(heightCm >= 80 && heightCm <= 260)) return null;
  if (!(weightKg >= 25 && weightKg <= 400)) return null;
  return { birthYear, heightCm, weightKg };
}
