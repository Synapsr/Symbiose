import { Minus, Plus } from 'lucide-react-native';
import { TextInput, View } from 'react-native';

import { Chip, IconButton, Row, Txt, webInput } from '@/components/ui';
import { Radius, Space, useTheme } from '@/theme';

const step = (grams: number) => (grams < 50 ? 5 : grams < 300 ? 10 : 25);

/** Grams with ± buttons, direct entry, and quick multipliers of the original estimate. */
export function PortionStepper({ grams, base, onChange }: { grams: number; base: number; onChange: (grams: number) => void }) {
  const { colors } = useTheme();
  const set = (value: number) => onChange(Math.max(0, Math.min(5000, Math.round(value))));
  return (
    <View style={{ gap: Space.md }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <IconButton label="-" icon={<Minus size={20} color={colors.text} />} onPress={() => set(grams - step(grams))} />
        <Row gap={4} style={{ alignItems: 'baseline' }}>
          <TextInput
            value={String(grams)}
            onChangeText={(text) => set(Number(text.replace(/[^0-9]/g, '')) || 0)}
            keyboardType="number-pad"
            selectTextOnFocus
            style={[{ fontSize: 32, fontWeight: '800', color: colors.text, minWidth: 70, textAlign: 'center', fontVariant: ['tabular-nums'], padding: 0 }, webInput]}
          />
          <Txt tone="secondary">g</Txt>
        </Row>
        <IconButton label="+" icon={<Plus size={20} color={colors.text} />} onPress={() => set(grams + step(grams))} />
      </Row>
      <Row gap={Space.sm} style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
        {[0.5, 1, 1.5, 2].map((factor) => (
          <Chip key={factor} label={factor === 1 ? '×1' : factor === 0.5 ? '½' : `×${factor}`} selected={Math.round(base * factor) === grams} onPress={() => set(base * factor)} />
        ))}
      </Row>
      <View style={{ height: 1, backgroundColor: colors.border, borderRadius: Radius.pill }} />
    </View>
  );
}
