import type { BloodPressureCategory, BloodPressureReading, BloodPressureTrend } from '@symbiose/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';

import { Pressy, Row, Txt } from '@/components/ui';
import { useI18n } from '@/i18n';
import { useApi } from '@/lib/session';
import { useHiddenIds, useUndoableDelete } from '@/lib/undo';
import { Space, useTheme, type Palette } from '@/theme';

const HEIGHT = 110;
/** Calm, distinct from the systolic line, readable in both themes. */
export const DIASTOLIC = '#7C9FD8';

/** Calm colours: green when it's good, neutral in between, amber (never red) when it's worth a doctor's look. */
export function categoryColor(category: BloodPressureCategory, colors: Palette): string {
  if (category === 'optimal' || category === 'normal') return colors.accent;
  if (category === 'grade2' || category === 'grade3') return colors.warning;
  return colors.text2;
}

export const needsDoctor = (category: BloodPressureCategory | null) => category === 'grade2' || category === 'grade3';

/** Daily averages: systolic above, diastolic below, the last day as a dot. */
export function BpChart({ points, color }: { points: BloodPressureTrend['points']; color: string }) {
  const [width, setWidth] = useState(0);
  const low = Math.min(...points.map((p) => p.diastolic)) - 6;
  const high = Math.max(...points.map((p) => p.systolic)) + 6;
  // Keep at least a 50 mmHg span so day-to-day noise doesn't look dramatic.
  const span = Math.max(high - low, 50);
  const top = (high + low) / 2 + span / 2;
  const x = (i: number) => 6 + (i / Math.max(points.length - 1, 1)) * (width - 12);
  const y = (v: number) => 6 + ((top - v) / span) * (HEIGHT - 12);
  const line = (key: 'systolic' | 'diastolic') => points.map((p, i) => `${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ');
  const last = points.at(-1)!;
  return (
    <View style={{ height: HEIGHT }} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 ? (
        <Svg width={width} height={HEIGHT}>
          {(['systolic', 'diastolic'] as const).map((key) => (
            <Polyline key={key} points={line(key)} fill="none" stroke={key === 'systolic' ? color : DIASTOLIC} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          <Circle cx={x(points.length - 1)} cy={y(last.systolic)} r={4} fill={color} />
          <Circle cx={x(points.length - 1)} cy={y(last.diastolic)} r={4} fill={DIASTOLIC} />
        </Svg>
      ) : null}
    </View>
  );
}

/** A reading typed in the app leaves at once, back with « Annuler » (see `useUndoableDelete`). */
export function useDeleteBloodPressure() {
  const api = useApi();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const remove = useUndoableDelete();
  return useCallback(
    (reading: BloodPressureReading) =>
      remove({
        id: reading.id,
        message: t('bp.deleted', { value: `${reading.systolic}/${reading.diastolic}` }),
        commit: () => api.deleteBloodPressure(reading.id).then(() => queryClient.invalidateQueries({ queryKey: ['insights'] })),
      }),
    [api, queryClient, remove, t],
  );
}

/**
 * « Dernière mesure : 132/85 · 30 oct. · pouls 68 ». A reading typed here has a
 * small bin (and the long press as a shortcut); imported ones live in the health app.
 */
export function LatestReading({ reading }: { reading: BloodPressureReading }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const remove = useDeleteBloodPressure();
  const hidden = useHiddenIds();
  if (hidden[reading.id]) return null;
  const text = (
    <Txt variant="caption" tone="secondary" style={{ fontVariant: ['tabular-nums'] }}>
      {t('bp.latest', {
        value: `${reading.systolic}/${reading.diastolic}`,
        date: new Date(reading.measuredAt).toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-US', { day: 'numeric', month: 'short' }),
      })}
      {reading.pulse ? ` · ${t('bp.pulseValue', { count: reading.pulse })}` : ''}
    </Txt>
  );
  if (reading.source !== 'manual') return text;
  return (
    <Row gap={Space.sm} style={{ justifyContent: 'space-between' }}>
      <Pressy haptic={false} delayLongPress={350} onLongPress={() => remove(reading)} accessibilityHint={t('bp.deleteAction')} style={{ flexShrink: 1, paddingVertical: 4 }}>
        {text}
      </Pressy>
      <Pressy onPress={() => remove(reading)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('bp.deleteAction')} style={{ padding: 4 }}>
        <Trash2 size={15} color={colors.text3} />
      </Pressy>
    </Row>
  );
}
