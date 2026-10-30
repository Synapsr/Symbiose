import { toLocalDate, toLocalDateTime, type BloodPressureCategory, type BloodPressureReading, type BloodPressureTrend } from '@symbiose/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { HeartPulse, Plus } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, Platform, TextInput, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';

import { Button, Card, Dot, IconButton, Pressy, Row, Txt, webInput } from '@/components/ui';
import { useI18n, type TranslationKey } from '@/i18n';
import { haptics } from '@/lib/haptics';
import { health } from '@/lib/health';
import { useApi } from '@/lib/session';
import { useSettings } from '@/lib/stores';
import { Radius, Space, useTheme, type Palette } from '@/theme';

const HEIGHT = 110;
/** Calm, distinct from the systolic line, readable in both themes. */
const DIASTOLIC = '#7C9FD8';

/** Calm colours: green when it's good, neutral in between, amber (never red) when it's worth a doctor's look. */
function categoryColor(category: BloodPressureCategory, colors: Palette): string {
  if (category === 'optimal' || category === 'normal') return colors.accent;
  if (category === 'grade2' || category === 'grade3') return colors.warning;
  return colors.text2;
}

const needsDoctor = (category: BloodPressureCategory | null) => category === 'grade2' || category === 'grade3';

/** Daily averages: systolic above, diastolic below, the last day as a dot. */
function BpChart({ points, color }: { points: BloodPressureTrend['points']; color: string }) {
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

function parse(value: string): number | null {
  const n = Number(value.replace(',', '.'));
  return value.trim() && Number.isFinite(n) ? Math.round(n) : null;
}

/** Opt-in blood pressure: the 7-day average in plain words, the trend, the last reading, and a manual entry. */
export function BloodPressureCard({ trend }: { trend: BloodPressureTrend | null }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const api = useApi();
  const queryClient = useQueryClient();
  const healthEnabled = useSettings((s) => s.healthEnabled);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ systolic: '', diastolic: '', pulse: '' });

  const systolic = parse(form.systolic);
  const diastolic = parse(form.diastolic);
  const pulse = parse(form.pulse);
  const inRange = systolic !== null && diastolic !== null && systolic >= 60 && systolic <= 260 && diastolic >= 30 && diastolic <= 160;
  const pulseOk = !form.pulse.trim() || (pulse !== null && pulse >= 30 && pulse <= 220);
  const valid = inRange && diastolic < systolic && pulseOk;
  const problem =
    systolic === null || diastolic === null ? null : !inRange || !pulseOk ? t('bp.invalid') : diastolic >= systolic ? t('bp.swapped') : null;

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['insights'] });
  const save = useMutation({
    mutationFn: () => {
      const now = new Date();
      return api.createBloodPressure({ externalId: null, measuredAt: toLocalDateTime(now), localDate: toLocalDate(now), systolic: systolic!, diastolic: diastolic!, pulse: form.pulse.trim() ? pulse : null });
    },
    onSuccess: (reading) => {
      haptics.success();
      setAdding(false);
      setForm({ systolic: '', diastolic: '', pulse: '' });
      refresh();
      // Both ways: a reading typed here also lands in the health store (and isn't imported back).
      if (healthEnabled && health.source) {
        void health.writeBloodPressure({ id: reading.id, measuredAt: new Date(reading.measuredAt), systolic: reading.systolic, diastolic: reading.diastolic }).catch(() => undefined);
      }
    },
    onError: () => haptics.warning(),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteBloodPressure(id),
    onSuccess: () => {
      haptics.success();
      refresh();
    },
  });

  const shown = trend?.average7 ?? (trend?.latest ? { systolic: trend.latest.systolic, diastolic: trend.latest.diastolic } : null);
  const category = trend?.category ?? null;
  const latest = trend?.latest ?? null;

  const confirmDelete = (reading: BloodPressureReading) => {
    haptics.impact();
    const label = `${reading.systolic}/${reading.diastolic}`;
    if (Platform.OS === 'web') {
      if (globalThis.confirm?.(`${t('bp.delete')}\n${label}`)) remove.mutate(reading.id);
      return;
    }
    Alert.alert(t('bp.delete'), label, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => remove.mutate(reading.id) },
    ]);
  };

  const input = (key: keyof typeof form, placeholder: string, label: string) => (
    <View style={{ flex: 1, gap: 4 }}>
      <Txt variant="caption" tone="secondary" numberOfLines={1} style={{ marginLeft: 4 }}>
        {label}
      </Txt>
      <TextInput
        value={form[key]}
        onChangeText={(value) => setForm((f) => ({ ...f, [key]: value }))}
        placeholder={placeholder}
        placeholderTextColor={colors.text3}
        keyboardType="number-pad"
        maxLength={3}
        accessibilityLabel={label}
        style={[
          { height: 48, borderRadius: Radius.md, backgroundColor: colors.surface2, paddingHorizontal: Space.lg, fontSize: 18, color: colors.text, fontVariant: ['tabular-nums'] },
          webInput,
        ]}
      />
    </View>
  );

  return (
    <Card style={{ gap: Space.lg }}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ gap: 2, flex: 1 }}>
          <Row gap={6}>
            <HeartPulse size={14} color={colors.text2} />
            <Txt variant="label" tone="secondary">
              {t('bp.title')}
            </Txt>
          </Row>
          {shown ? (
            <>
              <Row gap={6} style={{ alignItems: 'baseline' }}>
                <Txt variant="display" style={{ fontSize: 36 }}>
                  {Math.round(shown.systolic)}/{Math.round(shown.diastolic)}
                </Txt>
                <Txt tone="secondary">mmHg</Txt>
              </Row>
              {trend?.average7 ? (
                <Txt variant="caption" tone="tertiary">
                  {t('bp.average7')}
                </Txt>
              ) : null}
            </>
          ) : (
            <Txt tone="secondary" style={{ marginTop: Space.xs, maxWidth: 260 }}>
              {health.source ? t('bp.empty', { store: health.storeName[locale] }) : t('bp.emptyManual')}
            </Txt>
          )}
        </View>
        <IconButton label={t('bp.add')} icon={<Plus size={20} color={colors.text} />} onPress={() => setAdding(!adding)} />
      </Row>

      {category ? (
        <View style={{ gap: 4 }}>
          <Row gap={8}>
            <Dot color={categoryColor(category, colors)} />
            <Txt variant="label" color={needsDoctor(category) ? colors.warning : colors.text}>
              {t(`bp.category.${category}` as TranslationKey)}
            </Txt>
          </Row>
          {needsDoctor(category) ? (
            <Txt variant="caption" tone="secondary" style={{ marginLeft: 16 }}>
              {t('bp.doctor')}
            </Txt>
          ) : null}
        </View>
      ) : null}

      {trend && trend.points.length > 1 ? (
        <View style={{ gap: Space.sm }}>
          <BpChart points={trend.points} color={colors.accent} />
          <Row gap={Space.lg}>
            <Row gap={6}>
              <Dot color={colors.accent} size={6} />
              <Txt variant="caption" tone="secondary">
                {t('bp.systolic')}
              </Txt>
            </Row>
            <Row gap={6}>
              <Dot color={DIASTOLIC} size={6} />
              <Txt variant="caption" tone="secondary">
                {t('bp.diastolic')}
              </Txt>
            </Row>
          </Row>
        </View>
      ) : null}

      {latest ? <LatestReading reading={latest} onDelete={confirmDelete} /> : null}

      {adding ? (
        <View style={{ gap: Space.md }}>
          <Row gap={Space.sm} style={{ alignItems: 'flex-end' }}>
            {input('systolic', '120', t('bp.systolic'))}
            {input('diastolic', '80', t('bp.diastolic'))}
            {input('pulse', '70', t('bp.pulse'))}
          </Row>
          {problem ? (
            <Txt variant="caption" tone="warning">
              {problem}
            </Txt>
          ) : null}
          <Button title={t('common.save')} size="md" onPress={() => save.mutate()} disabled={!valid} loading={save.isPending} />
        </View>
      ) : null}
    </Card>
  );
}

/** « Dernière mesure : 132/85 · 30 oct. · pouls 68 ». Readings typed here can be deleted with a long press; imported ones live in the health app. */
function LatestReading({ reading, onDelete }: { reading: BloodPressureReading; onDelete: (reading: BloodPressureReading) => void }) {
  const { t, locale } = useI18n();
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
    <Pressy haptic={false} delayLongPress={350} onLongPress={() => onDelete(reading)} accessibilityRole="button" accessibilityHint={t('bp.delete')} style={{ alignSelf: 'flex-start', paddingVertical: 4 }}>
      {text}
    </Pressy>
  );
}
