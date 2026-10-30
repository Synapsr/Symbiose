import { toLocalDate, toLocalDateTime, type GoalPlan, type WeightTrend } from '@symbiose/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Scale } from 'lucide-react-native';
import { useState } from 'react';
import { TextInput, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import { Button, Card, IconButton, Row, Txt, webInput } from '@/components/ui';
import { useI18n } from '@/i18n';
import { formatNumber } from '@/lib/format';
import { haptics } from '@/lib/haptics';
import { useApi } from '@/lib/session';
import { Radius, Space, useTheme } from '@/theme';

const HEIGHT = 120;

/** A smooth line with a soft area under it; every reading is a dot. */
function WeightChart({ points, color }: { points: WeightTrend['points']; color: string }) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const values = points.map((p) => p.kg);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // Keep at least a 2 kg span so tiny variations don't look dramatic.
  const span = Math.max(max - min, 2);
  const mid = (max + min) / 2;
  const top = mid + span / 2;
  const first = points[0]?.date ?? '';
  const last = points.at(-1)?.date ?? first;
  const days = Math.max(1, (Date.parse(last) - Date.parse(first)) / 86_400_000);
  const xy = points.map((p) => ({
    x: 6 + ((Date.parse(p.date) - Date.parse(first)) / 86_400_000 / days) * (width - 12),
    y: 8 + ((top - p.kg) / span) * (HEIGHT - 16),
  }));
  const line = xy.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = xy.length ? `${line} L${xy.at(-1)!.x.toFixed(1)},${HEIGHT} L${xy[0]!.x.toFixed(1)},${HEIGHT} Z` : '';

  return (
    <View style={{ height: HEIGHT }} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 && xy.length ? (
        <Svg width={width} height={HEIGHT}>
          <Defs>
            <LinearGradient id="weightArea" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={color} stopOpacity={0.22} />
              <Stop offset="1" stopColor={color} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          {xy.length > 1 ? <Path d={area} fill="url(#weightArea)" /> : null}
          {xy.length > 1 ? <Path d={line} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" /> : null}
          {xy.map((p, i) => (
            <Circle key={points[i]!.date} cx={p.x} cy={p.y} r={i === xy.length - 1 ? 5 : 2.5} fill={i === xy.length - 1 ? color : colors.surface} stroke={color} strokeWidth={1.5} />
          ))}
        </Svg>
      ) : null}
    </View>
  );
}

/** Weight over ~30 days: latest reading, trend in the direction of the goal, and manual entry. */
export function WeightCard({ weight, plan }: { weight: WeightTrend; plan: GoalPlan | null }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const api = useApi();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState('');

  const save = useMutation({
    mutationFn: (kg: number) => {
      const now = new Date();
      return api.putWeights({ source: 'manual', samples: [{ measuredAt: toLocalDateTime(now), localDate: toLocalDate(now), kg }] });
    },
    onSuccess: () => {
      haptics.success();
      setAdding(false);
      setValue('');
      void queryClient.invalidateQueries({ queryKey: ['insights'] });
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });
  const kg = Number(value.replace(',', '.'));
  const valid = kg >= 25 && kg <= 400;

  const change = weight.changeKg;
  // Green when the trend goes the way the plan wants, neutral otherwise.
  const wanted = plan?.calorieMode === 'deficit' ? -1 : plan?.calorieMode === 'surplus' ? 1 : 0;
  const changeColor = change === null || Math.abs(change) < 0.2 || wanted === 0 ? colors.text2 : Math.sign(change) === wanted ? colors.accent : colors.warning;

  return (
    <Card style={{ gap: Space.lg }}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ gap: 2 }}>
          <Row gap={6}>
            <Scale size={14} color={colors.text2} />
            <Txt variant="label" tone="secondary">
              {t('insights.weight')}
            </Txt>
          </Row>
          {weight.latest ? (
            <Row gap={6} style={{ alignItems: 'baseline' }}>
              <Txt variant="display" style={{ fontSize: 36 }}>
                {formatNumber(weight.latest.kg, locale, 1)}
              </Txt>
              <Txt tone="secondary">kg</Txt>
            </Row>
          ) : (
            <Txt tone="secondary" style={{ marginTop: Space.xs, maxWidth: 240 }}>
              {t('weight.empty')}
            </Txt>
          )}
          {change !== null ? (
            <Txt variant="label" color={changeColor}>
              {change > 0 ? '+' : change < 0 ? '−' : '±'}
              {formatNumber(Math.abs(change), locale, 1)} kg · {t('weight.window', { days: weight.windowDays })}
            </Txt>
          ) : null}
        </View>
        <IconButton label={t('weight.add')} icon={<Plus size={20} color={colors.text} />} onPress={() => setAdding(!adding)} />
      </Row>

      {weight.points.length ? <WeightChart points={weight.points} color={colors.accent} /> : null}

      {adding ? (
        <Row gap={Space.sm}>
          <TextInput
            value={value}
            onChangeText={setValue}
            placeholder={weight.latest ? formatNumber(weight.latest.kg, locale, 1) : '70'}
            placeholderTextColor={colors.text3}
            keyboardType="decimal-pad"
            autoFocus
            style={[{ flex: 1, height: 48, borderRadius: Radius.md, backgroundColor: colors.surface2, paddingHorizontal: Space.lg, fontSize: 18, color: colors.text }, webInput]}
          />
          <Button title={t('common.save')} size="md" onPress={() => save.mutate(kg)} disabled={!valid} loading={save.isPending} />
        </Row>
      ) : null}
    </Card>
  );
}
