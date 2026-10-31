import { View } from 'react-native';

import { Chip, Field, Txt } from '@/components/ui';
import { MicButton } from '@/components/ui/mic-button';
import { useI18n, type TranslationKey } from '@/i18n';
import { useDictation } from '@/lib/dictation';
import { Space } from '@/theme';

const CHIPS = ['sugar', 'lose', 'muscle', 'balanced', 'fiber', 'salt'] as const;

/** Free-text goals with one-tap starters. */
export function GoalComposer({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  const { t } = useI18n();
  const dictation = useDictation(value, onChange);
  return (
    <View style={{ gap: Space.lg }}>
      <Field
        value={value}
        onChangeText={onChange}
        placeholder={dictation.listening ? t('dictation.listening') : t('onb.goals.placeholder')}
        multiline
        autoFocus={autoFocus}
        maxLength={2000}
        accessory={<MicButton dictation={dictation} />}
        highlighted={dictation.listening}
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm }}>
        {CHIPS.map((chip) => {
          const text = t(`chip.${chip}.text` as TranslationKey);
          const selected = value.includes(text);
          return (
            <Chip
              key={chip}
              label={t(`chip.${chip}` as TranslationKey)}
              selected={selected}
              onPress={() => onChange(selected ? value.replace(text, '').replace(/\s{2,}/g, ' ').trim() : `${value.trim()} ${text}`.trim())}
            />
          );
        })}
      </View>
      <Txt variant="caption" tone="tertiary">
        {t('onb.goals.subtitle')}
      </Txt>
    </View>
  );
}
