import { useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';

import { Row, Txt } from '@/components/ui';
import { Radius, Space, useTheme } from '@/theme';

/** Daily bars with a dashed target line; days above a "max" target turn amber. */
export function DayBars({
  values,
  labels,
  target,
  kind,
  color,
}: {
  values: (number | null)[];
  labels: string[];
  target: number;
  kind: 'max' | 'min' | 'target';
  color: string;
}) {
  const { colors } = useTheme();
  const height = 140;
  const max = Math.max(target * 1.25, ...values.map((v) => v ?? 0), 1);
  const targetY = height - (target / max) * height;
  const dense = values.length > 10;
  return (
    <View style={{ gap: Space.sm }}>
      <View style={{ height, flexDirection: 'row', alignItems: 'flex-end', gap: dense ? 2 : 8 }}>
        <View style={{ position: 'absolute', left: 0, right: 0, top: targetY, borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: colors.text3 }} />
        {values.map((value, i) => {
          const over = value !== null && kind === 'max' && value > target;
          return (
            <View key={i} style={{ flex: 1, height: '100%', justifyContent: 'flex-end' }}>
              <View
                style={{
                  height: value === null ? 3 : Math.max(3, (value / max) * height),
                  borderRadius: dense ? 3 : Radius.sm / 2,
                  backgroundColor: value === null ? colors.surface2 : over ? colors.warning : color,
                }}
              />
            </View>
          );
        })}
      </View>
      {!dense ? (
        <Row gap={8}>
          {labels.map((label, i) => (
            <Txt key={i} variant="caption" tone="tertiary" style={{ flex: 1, textAlign: 'center', fontSize: 11 }}>
              {label}
            </Txt>
          ))}
        </Row>
      ) : null}
    </View>
  );
}

/** 24 bars, one per hour; the peak is highlighted. */
export function HourBars({ hours, color }: { hours: number[]; color: string }) {
  const { colors } = useTheme();
  const max = Math.max(...hours, 1);
  const peak = hours.indexOf(Math.max(...hours));
  return (
    <View style={{ gap: Space.sm }}>
      <View style={{ height: 90, flexDirection: 'row', alignItems: 'flex-end', gap: 2 }}>
        {hours.map((value, hour) => (
          <View key={hour} style={{ flex: 1, height: Math.max(2, (value / max) * 90), borderRadius: 3, backgroundColor: hour === peak && value > 0 ? color : value > 0 ? `${color}66` : colors.surface2 }} />
        ))}
      </View>
      <Row style={{ justifyContent: 'space-between' }}>
        {['0h', '6h', '12h', '18h', '23h'].map((label) => (
          <Txt key={label} variant="caption" tone="tertiary" style={{ fontSize: 11 }}>
            {label}
          </Txt>
        ))}
      </Row>
    </View>
  );
}

export function Sparkline({ values, color }: { values: number[]; color: string }) {
  const [width, setWidth] = useState(0);
  const height = 56;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values.map((v, i) => `${(i / Math.max(values.length - 1, 1)) * width},${height - 6 - ((v - min) / span) * (height - 12)}`);
  const last = points[points.length - 1]?.split(',').map(Number) ?? [0, 0];
  return (
    <View style={{ height }} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 ? (
        <Svg width={width} height={height}>
          <Polyline points={points.join(' ')} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
          <Circle cx={last[0]} cy={last[1]} r={4} fill={color} />
        </Svg>
      ) : null}
    </View>
  );
}
