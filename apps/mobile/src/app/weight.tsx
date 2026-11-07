import { addDays, type WeightPoint } from '@symbiose/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronRight, Plus, Scale, X } from 'lucide-react-native';
import { Fragment, useState } from 'react';
import { ScrollView, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { FadeIn, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';

import { Button, Card, IconButton, Pressy, Reveal, Row, SectionTitle, Segmented, Skeleton, Toggle, Txt } from '@/components/ui';
import { useI18n, type TranslationKey } from '@/i18n';
import { formatDate, formatDay, formatKg, formatNumber, signedKg } from '@/lib/format';
import { haptics } from '@/lib/haptics';
import { dismiss } from '@/lib/nav';
import { useUser } from '@/lib/session';
import { useSettings } from '@/lib/stores';
import { useWeightHistory } from '@/lib/weight';
import {
  CHART_INSETS,
  changeTone,
  dotsPath,
  nearestReading,
  STABLE_KG,
  WEIGHT_RANGES,
  weightChart,
  weightView,
  type PlottedReading,
  type WeightRange,
  type WeightView,
} from '@/lib/weight-chart';
import { Radius, Space, useTheme } from '@/theme';

const CHART_HEIGHT = 240;
/** Weigh-ins listed before « Voir plus »: the recent ones are what people come back for. */
const LIST_STEP = 20;

const isRange = (value: string | undefined): value is WeightRange => WEIGHT_RANGES.includes(value as WeightRange);

/**
 * « Poids », from its row in Tendances: the trend over a range, big and
 * readable (a finger on the chart reads any day), the change and the pace in
 * plain words, « Lissé » to see each weigh-in as it was, and the weigh-ins
 * themselves, each one correctable. Never red: a change is green only when it
 * goes the way the plan wants.
 */
export default function WeightScreen() {
  const params = useLocalSearchParams<{ range?: string }>();
  const { t } = useI18n();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { points, error, today } = useWeightHistory();
  const [range, setRange] = useState<WeightRange>(isRange(params.range) ? params.range : '1m');

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: Space.lg, paddingTop: Space.xl, paddingBottom: insets.bottom + Space.xxxl, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
      <Row style={{ justifyContent: 'space-between', paddingHorizontal: 4, marginBottom: Space.lg }}>
        <Txt variant="title">{t('weight.title')}</Txt>
        <IconButton label={t('common.close')} icon={<X size={20} color={colors.text} />} onPress={dismiss} />
      </Row>

      {points ? (
        points.length ? (
          <Body points={points} today={today} range={range} onRange={setRange} />
        ) : (
          <Reveal>
            <Empty />
          </Reveal>
        )
      ) : error ? (
        <Card>
          <Txt tone="secondary">{t('common.error')}</Txt>
        </Card>
      ) : (
        <View style={{ gap: Space.lg }}>
          <Skeleton width="100%" height={40} radius={Radius.pill} />
          <Skeleton width="100%" height={420} radius={Radius.xl} />
        </View>
      )}
    </ScrollView>
  );
}

const addWeighIn = () => router.push({ pathname: '/log', params: { view: 'weight' } });

function Body({ points, today, range, onRange }: { points: WeightPoint[]; today: string; range: WeightRange; onRange: (range: WeightRange) => void }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const smoothed = useSettings((s) => s.weightSmoothed);
  const view = weightView(points, { range, today, smoothed });

  return (
    <>
      {/* The range scopes everything below it: the numbers, the chart and the list. */}
      <Reveal index={0}>
        <Segmented fill value={range} onChange={onRange} options={WEIGHT_RANGES.map((value) => ({ value, label: t(`weight.range.${value}` as TranslationKey) }))} />
      </Reveal>

      <Reveal index={1} style={{ marginTop: Space.lg }}>
        <TrendCard view={view} points={points} />
      </Reveal>

      <Reveal index={2} style={{ marginTop: Space.lg }}>
        <Button title={t('weight.add')} variant="secondary" icon={<Plus size={18} color={colors.text} />} onPress={addWeighIn} />
      </Reveal>

      {view.readings.length ? (
        <Reveal index={3}>
          <SectionTitle>{t('weight.list')}</SectionTitle>
          <WeighIns key={range} view={view} />
        </Reveal>
      ) : null}
    </>
  );
}

/** The headline, the chart and « Lissé », in one card: what the eye reads first. */
function TrendCard({ view, points }: { view: WeightView; points: WeightPoint[] }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const set = useSettings((s) => s.set);
  const [selected, setSelected] = useState<PlottedReading | null>(null);
  const latest = points.at(-1)!;

  if (!view.current) {
    // Weigh-ins before, none in this range.
    return (
      <Card style={{ gap: Space.xs }}>
        <Txt variant="label">{t('weight.none')}</Txt>
        <Txt variant="caption" tone="secondary" style={{ fontVariant: ['tabular-nums'] }}>
          {t('weight.lastWas', { date: formatDate(latest.date, locale), kg: formatKg(latest.kg, locale) })}
        </Txt>
      </Card>
    );
  }

  return (
    <Card style={{ paddingHorizontal: Space.lg, gap: Space.lg }}>
      <Headline view={view} selected={selected} />
      <WeightPlot view={view} onSelect={setSelected} />
      <View style={{ height: 1, backgroundColor: colors.border }} />
      <Row gap={Space.md}>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="label" style={{ fontSize: 15 }}>
            {t('weight.smoothed')}
          </Txt>
          <Txt variant="caption" tone="secondary">
            {view.smoothed ? t('weight.smoothedOn') : t('weight.smoothedOff')}
          </Txt>
        </View>
        <Toggle
          value={view.smoothed}
          accessibilityLabel={t('weight.smoothed')}
          onValueChange={(value) => {
            haptics.soft();
            set({ weightSmoothed: value });
          }}
        />
      </Row>
    </Card>
  );
}

/**
 * The number that matters, and what it means: the trend now (or the last weigh-in), its change over
 * the range, the pace. A finger on the chart turns it into that day's reading.
 */
function Headline({ view, selected }: { view: WeightView; selected: PlottedReading | null }) {
  const { t, plural, locale } = useI18n();
  const { colors } = useTheme();
  const plan = useUser().plan;
  const current = view.current!;
  const kg = (value: number) => formatKg(value, locale);

  const overline = selected
    ? capitalize(formatDate(selected.date, locale, { weekday: 'long', day: 'numeric', month: 'long' }))
    : view.smoothed
      ? t('weight.trendNow')
      : t('weight.lastOn', { date: formatDate(current.date, locale) });
  const value = selected ? (view.smoothed ? selected.trend : selected.kg) : current.value;
  const since = view.since ? formatDate(view.since, locale) : '';
  const change =
    view.change === null ? null : Math.abs(view.change) < STABLE_KG ? t('weight.stableSince', { date: since }) : t('weight.changeSince', { change: signedKg(view.change, locale), date: since });
  const tone = changeTone(view.change, plan?.calorieMode);
  // A pace in tenths reads at a glance; below a tenth, the hundredths still say which way it goes.
  const rate = view.perWeek === null ? 0 : Math.abs(view.perWeek);
  const pace =
    view.perWeek === null ? null : rate < 0.05 ? t('weight.paceStable') : t('weight.pace', { rate: `${view.perWeek > 0 ? '+' : '−'}${formatNumber(rate, locale, rate < 0.1 ? 2 : 1)}` });

  // Under the number, two lines always there, so the card keeps its height while a finger moves.
  const steady = view.change !== null && Math.abs(view.change) < STABLE_KG;
  const lines = selected
    ? [view.smoothed ? t('weight.trendThatDay') : t('weight.weighInThatDay'), view.smoothed ? t('weight.thatDay', { kg: kg(selected.kg) }) : ' ']
    : [change ?? t('weight.first'), view.smoothed && pace && !steady ? pace : plural('weight.count', view.readings.length)];

  return (
    <View style={{ gap: 2 }} accessibilityLiveRegion={selected ? 'polite' : 'none'}>
      <Txt variant="caption" tone="secondary" numberOfLines={1}>
        {overline}
      </Txt>
      <Row gap={6} style={{ alignItems: 'baseline' }}>
        <Txt variant="display">{kg(value)}</Txt>
        <Txt variant="heading" tone="secondary">
          kg
        </Txt>
      </Row>
      <Txt variant="label" color={selected ? colors.text2 : tone === 'good' ? colors.accentText : colors.text} numberOfLines={1} style={{ fontVariant: ['tabular-nums'] }}>
        {lines[0]}
      </Txt>
      <Txt variant="caption" tone="secondary" numberOfLines={1} style={{ fontVariant: ['tabular-nums'] }}>
        {lines[1]}
      </Txt>
    </View>
  );
}

/**
 * The hero chart: the trend as the line, the weigh-ins as faint dots (or the weigh-ins joined when
 * « Lissé » is off), clean kg on the right, dates underneath. Drag along it, or rest a finger,
 * to read a day: it snaps to the weigh-ins with a light tick each.
 */
function WeightPlot({ view, onSelect }: { view: WeightView; onSelect: (reading: PlottedReading | null) => void }) {
  const { locale, t } = useI18n();
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState(-1);
  // The reading under the finger, kept off React's renders: the tick fires once per step.
  const last = useSharedValue(-1);
  const chart = width > 0 ? weightChart(view, { width, height: CHART_HEIGHT }, locale) : null;
  const readings = chart?.readings ?? [];

  const select = (x: number | null) => {
    const index = x === null ? -1 : nearestReading(readings, x);
    if (index === last.get()) return;
    if (index >= 0) haptics.tap();
    last.set(index);
    setActive(index);
    onSelect(index >= 0 ? readings[index]! : null);
  };
  // A finger that slides sideways reads at once; one that rests reads after a moment, then can slide anywhere.
  // A vertical swipe stays the page's scroll. With a mouse, hovering reads too.
  const drag = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX([-6, 6])
    .failOffsetY([-12, 12])
    .onStart((e) => select(e.x))
    .onUpdate((e) => select(e.x))
    .onFinalize(() => select(null));
  const hold = Gesture.Pan()
    .runOnJS(true)
    .activateAfterLongPress(160)
    .onStart((e) => select(e.x))
    .onUpdate((e) => select(e.x))
    .onFinalize(() => select(null));
  const hover = Gesture.Hover()
    .runOnJS(true)
    .onUpdate((e) => select(e.x))
    .onFinalize(() => select(null));
  const gesture = Gesture.Simultaneous(hover, Gesture.Race(drag, hold));

  const point = active >= 0 ? readings[active] : undefined;
  const end = readings.at(-1);
  const first = view.line[0];
  const summary = first && view.current ? t('weight.chartA11y', { from: formatKg(first.value, locale), to: formatKg(view.current.value, locale), date: formatDate(first.date, locale) }) : '';

  return (
    <GestureDetector gesture={gesture}>
      <View
        style={{ height: CHART_HEIGHT }}
        onLayout={(e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width))}
        accessible
        accessibilityRole="image"
        accessibilityLabel={summary}>
        {chart ? (
          <Animated.View key={`${view.from}:${view.smoothed}`} entering={FadeIn.duration(200)} style={{ flex: 1 }}>
            <Svg width={width} height={CHART_HEIGHT}>
              <Defs>
                <LinearGradient id="weightWash" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={colors.accent} stopOpacity={0.16} />
                  <Stop offset="1" stopColor={colors.accent} stopOpacity={0} />
                </LinearGradient>
              </Defs>
              {chart.yTicks.map((tick) => (
                <Line key={tick.value} x1={chart.plot.left} x2={chart.plot.right} y1={tick.y} y2={tick.y} stroke={colors.border} strokeWidth={1} />
              ))}
              {chart.area ? <Path d={chart.area} fill="url(#weightWash)" /> : null}
              {/* Smoothed, the weigh-ins are faint dots under the trend; raw, they are the line's own points. */}
              <Path d={dotsPath(readings, view.smoothed ? 2.6 : 2.2)} fill={colors.accent} opacity={view.smoothed ? 0.32 : 1} />
              {chart.line ? <Path d={chart.line} fill="none" stroke={colors.accent} strokeWidth={view.smoothed ? 2.5 : 2} strokeLinejoin="round" strokeLinecap="round" /> : null}
              {point ? (
                <>
                  <Line x1={point.x} x2={point.x} y1={chart.plot.top} y2={chart.plot.bottom} stroke={colors.text3} strokeWidth={1} />
                  {view.smoothed ? <Circle cx={point.x} cy={point.y} r={3.5} fill={colors.text2} stroke={colors.surface} strokeWidth={1.5} /> : null}
                  <Circle cx={point.x} cy={point.lineY} r={5.5} fill={colors.accent} stroke={colors.surface} strokeWidth={2} />
                </>
              ) : end ? (
                <Circle cx={end.x} cy={end.lineY} r={4.5} fill={colors.accent} stroke={colors.surface} strokeWidth={2} />
              ) : null}
            </Svg>
            {chart.yTicks.map((tick) => (
              <Txt
                key={tick.value}
                variant="caption"
                tone="tertiary"
                style={{ position: 'absolute', right: 0, top: tick.y - 9, width: CHART_INSETS.right - 6, textAlign: 'right', fontSize: 11, fontVariant: ['tabular-nums'] }}>
                {tick.label}
              </Txt>
            ))}
            {chart.xTicks.map((tick) => (
              <Txt
                key={tick.date}
                variant="caption"
                tone="tertiary"
                numberOfLines={1}
                style={[
                  { position: 'absolute', top: chart.plot.bottom + 6, width: 72, fontSize: 11 },
                  tick.anchor === 'start' ? { left: tick.x, textAlign: 'left' } : tick.anchor === 'end' ? { left: tick.x - 72, textAlign: 'right' } : { left: tick.x - 36, textAlign: 'center' },
                ]}>
                {tick.label}
              </Txt>
            ))}
          </Animated.View>
        ) : null}
      </View>
    </GestureDetector>
  );
}

/** The weigh-ins of the range, newest first, by month; a tap corrects or deletes one. */
function WeighIns({ view }: { view: WeightView }) {
  const { t, plural, locale } = useI18n();
  const { colors } = useTheme();
  const [limit, setLimit] = useState(LIST_STEP);
  const all = [...view.readings].reverse();
  const shown = all.slice(0, limit);
  const thisYear = view.to.slice(0, 4);
  const months: { key: string; label: string; readings: typeof shown }[] = [];
  for (const reading of shown) {
    const key = reading.date.slice(0, 7);
    if (months.at(-1)?.key !== key) {
      const label = formatDate(`${key}-01`, locale, key.startsWith(thisYear) ? { month: 'long' } : { month: 'long', year: 'numeric' });
      months.push({ key, label: capitalize(label), readings: [] });
    }
    months.at(-1)!.readings.push(reading);
  }
  const yesterday = addDays(view.to, -1);

  return (
    <View style={{ gap: Space.md }}>
      <Card padded={false} style={{ paddingVertical: Space.xs }}>
        {months.map((month, m) => (
          <Fragment key={month.key}>
            <Txt variant="overline" tone="tertiary" style={{ paddingHorizontal: Space.lg, paddingTop: m ? Space.lg : Space.md, paddingBottom: Space.xs }}>
              {month.label}
            </Txt>
            {month.readings.map((reading, i) => (
              <Pressy
                key={reading.date}
                onPress={() => router.push({ pathname: '/log', params: { view: 'weight', date: reading.date, kg: String(reading.kg) } })}
                accessibilityRole="button"
                accessibilityHint={t('weight.editHint')}
                style={{ flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingHorizontal: Space.lg, minHeight: 48 }}>
                {i ? <View style={{ position: 'absolute', top: 0, left: Space.lg, right: 0, height: 1, backgroundColor: colors.border }} /> : null}
                <Txt style={{ flex: 1 }} numberOfLines={1}>
                  {reading.date === view.to || reading.date === yesterday
                    ? formatDay(reading.date, locale, { today: t('common.today'), yesterday: t('common.yesterday') })
                    : capitalize(formatDate(reading.date, locale, { weekday: 'long', day: 'numeric' }))}
                </Txt>
                <Txt variant="label" style={{ fontSize: 16, fontVariant: ['tabular-nums'] }}>
                  {formatKg(reading.kg, locale)} kg
                </Txt>
                <ChevronRight size={16} color={colors.text3} />
              </Pressy>
            ))}
          </Fragment>
        ))}
      </Card>
      {all.length > limit ? <Button title={plural('weight.more', all.length - limit)} variant="ghost" size="md" onPress={() => setLimit(limit + LIST_STEP * 2)} /> : null}
    </View>
  );
}

/** No weigh-in yet: what this screen will show, and the one way to start. */
function Empty() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const health = useSettings((s) => s.healthEnabled);
  return (
    <Card style={{ gap: Space.lg, alignItems: 'flex-start' }}>
      <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Scale size={22} color={colors.accentText} />
      </View>
      <View style={{ gap: Space.sm }}>
        <Txt variant="heading">{t('weight.emptyTitle')}</Txt>
        <Txt tone="secondary">{t('weight.emptyBody')}</Txt>
        {health ? (
          <Txt variant="caption" tone="secondary">
            {t('weight.emptyHealth')}
          </Txt>
        ) : null}
      </View>
      <Button title={t('weight.add')} size="md" icon={<Plus size={18} color={colors.onInverted} />} onPress={addWeighIn} />
    </Card>
  );
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
