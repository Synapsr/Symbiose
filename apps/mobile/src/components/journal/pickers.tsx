import { JOURNAL_KINDS, type JournalKind } from '@symbiose/shared';
import { View } from 'react-native';

import { Pressy, Row, Txt } from '@/components/ui';
import { useI18n } from '@/i18n';
import { Radius, Space, useTheme } from '@/theme';

import { KIND_META, kindLabel } from './meta';

/**
 * The kinds, a touch more compact than the regular chips so they fit on one
 * or two lines. A mood isn't a note any more (its faces are in « + »): an older
 * « Ressenti » note shows its kind, still selected, so nothing looks lost.
 */
export function KindChips({ value, onChange }: { value: JournalKind; onChange: (kind: JournalKind) => void }) {
  const { t } = useI18n();
  const { colors, elevation } = useTheme();
  const kinds: readonly JournalKind[] = value === 'feeling' ? ['feeling', ...JOURNAL_KINDS] : JOURNAL_KINDS;
  return (
    <Row gap={6} style={{ flexWrap: 'wrap' }}>
      {kinds.map((kind) => {
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
