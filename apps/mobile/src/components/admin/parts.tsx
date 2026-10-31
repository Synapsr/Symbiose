import type { ReactNode } from 'react';
import { View } from 'react-native';

import { Dot, Row, Txt } from '@/components/ui';
import { Space, useTheme } from '@/theme';

/** A card's small title, with its colour, and an optional quiet pill on the right. */
export function CardTitle({ color, label, right }: { color: string; label: string; right?: string | null }) {
  const { colors } = useTheme();
  return (
    <Row style={{ justifyContent: 'space-between' }}>
      <Row gap={6} style={{ flexShrink: 1 }}>
        <Dot color={color} />
        <Txt variant="label" tone="secondary" numberOfLines={1}>
          {label}
        </Txt>
      </Row>
      {right ? (
        <View style={{ paddingHorizontal: 10, height: 26, justifyContent: 'center', borderRadius: 13, backgroundColor: colors.surface2 }}>
          <Txt variant="caption" style={{ fontWeight: '600', fontVariant: ['tabular-nums'] }}>
            {right}
          </Txt>
        </View>
      ) : null}
    </Row>
  );
}

/** A few numbers side by side: the value, its label underneath. */
export function Stats({ items }: { items: { label: string; value: string; tone?: 'warning' | 'accent' }[] }) {
  return (
    <Row gap={Space.md} style={{ alignItems: 'flex-start' }}>
      {items.map((item) => (
        <View key={item.label} style={{ flex: 1, gap: 2 }}>
          <Txt variant="number" tone={item.tone ?? 'primary'} numberOfLines={1} style={{ fontSize: 20 }}>
            {item.value}
          </Txt>
          <Txt variant="caption" tone="secondary" numberOfLines={2}>
            {item.label}
          </Txt>
        </View>
      ))}
    </Row>
  );
}

/** A hairline between the parts of a card. */
export function Rule() {
  const { colors } = useTheme();
  return <View style={{ height: 1, backgroundColor: colors.border }} />;
}

/** A label on the left, its value on the right. */
export function Line({ label, value, icon, first }: { label: string; value: string; icon?: ReactNode; first?: boolean }) {
  const { colors } = useTheme();
  return (
    <Row gap={Space.md} style={[{ paddingVertical: Space.md }, first ? null : { borderTopWidth: 1, borderTopColor: colors.border }]}>
      <Txt tone="secondary" style={{ fontSize: 15 }}>
        {label}
      </Txt>
      <Row gap={6} style={{ flex: 1, justifyContent: 'flex-end' }}>
        {icon}
        <Txt variant="label" numberOfLines={1} style={{ fontSize: 15, flexShrink: 1, textAlign: 'right', fontVariant: ['tabular-nums'] }}>
          {value}
        </Txt>
      </Row>
    </Row>
  );
}
