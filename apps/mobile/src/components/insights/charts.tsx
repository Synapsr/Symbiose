import { View } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';

import { Row, Txt } from '@/components/ui';
import { Radius, Space, useTheme } from '@/theme';

/** Daily bars with a dashed target line; days above a "max" target turn amber, days under a "min" one can fade (`softUnder`). */
export function DayBars({
  values,
  labels,
  target,
  kind,
  color,
  softUnder = false,
}: {
  values: (number | null)[];
  labels: string[];
  target: number;
  kind: 'max' | 'min' | 'target';
  color: string;
  softUnder?: boolean;
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
          const under = softUnder && value !== null && kind === 'min' && value < target;
          return (
            <View key={i} style={{ flex: 1, height: '100%', justifyContent: 'flex-end' }}>
              <View
                style={{
                  height: value === null ? 3 : Math.max(3, (value / max) * height),
                  borderRadius: dense ? 3 : Radius.sm / 2,
                  backgroundColor: value === null ? colors.surface2 : over ? colors.warning : under ? `${color}66` : color,
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

const HOUR_LABELS = [0, 6, 12, 18, 23];

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
      {/* Same 24 slots as the bars, so each label sits under its own hour. */}
      <View style={{ flexDirection: 'row', gap: 2, height: 16 }}>
        {hours.map((_, hour) => (
          <View key={hour} style={{ flex: 1 }}>
            {HOUR_LABELS.includes(hour) ? (
              // Wider than its slot: centred on the bar, free to overflow it.
              <Txt variant="caption" tone="tertiary" style={{ position: 'absolute', left: '50%', width: 40, marginLeft: -20, textAlign: 'center', fontSize: 11 }}>
                {hour}h
              </Txt>
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- Mini charts for compact rows

const MINI_WIDTH = 72;
const MINI_HEIGHT = 28;

/** Tiny daily bars: days without data stay a faint stub. */
export function MiniBars({ values, color, max }: { values: (number | null)[]; color: string; max?: number }) {
  const { colors } = useTheme();
  const top = Math.max(max ?? 0, ...values.map((v) => v ?? 0), 1);
  return (
    <View style={{ width: MINI_WIDTH, height: MINI_HEIGHT, flexDirection: 'row', alignItems: 'flex-end', gap: values.length > 10 ? 1 : 3 }}>
      {values.map((value, i) => (
        <View key={i} style={{ flex: 1, height: value ? Math.max(3, (value / top) * MINI_HEIGHT) : 3, borderRadius: 2, backgroundColor: value ? color : colors.surface2 }} />
      ))}
    </View>
  );
}

/**
 * Tiny line over the period: `x` is each point's place in it (0..1), the last point is stressed.
 * `dots` draws dots alone, for values that are levels (a mood), each in its own colour.
 */
export function MiniLine({ points, color, dots = false, range }: { points: { x: number; y: number; color?: string }[]; color: string; dots?: boolean; range?: [number, number] }) {
  const { colors } = useTheme();
  const ys = points.map((p) => p.y);
  const [low, high] = range ?? [Math.min(...ys), Math.max(...ys)];
  const span = high - low || 1;
  const xy = points.map((p) => ({ x: 3 + p.x * (MINI_WIDTH - 6), y: 3 + ((high - p.y) / span) * (MINI_HEIGHT - 6), color: p.color ?? color }));
  const last = xy.at(-1);
  return (
    <View style={{ width: MINI_WIDTH, height: MINI_HEIGHT }}>
      <Svg width={MINI_WIDTH} height={MINI_HEIGHT}>
        {!dots && xy.length > 1 ? <Polyline points={xy.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" /> : null}
        {dots ? xy.map((p, i) => <Circle key={i} cx={p.x} cy={p.y} r={2.6} fill={p.color} />) : null}
        {last && !dots ? <Circle cx={last.x} cy={last.y} r={3} fill={color} stroke={colors.surface} strokeWidth={1.5} /> : null}
      </Svg>
    </View>
  );
}
