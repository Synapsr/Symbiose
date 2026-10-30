import { addDays, type MoodTrend } from '@symbiose/shared';
import { FaceSlightlySmiling, HeartHandshake } from 'lucide-react-native';
import { useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';

import { MiniLine } from '@/components/insights/charts';
import { ExpandRow } from '@/components/insights/expand-row';
import { moodColor } from '@/components/mood-face';
import { Row, Txt } from '@/components/ui';
import { useI18n, type TranslationKey } from '@/i18n';
import { formatNumber } from '@/lib/format';
import { Radius, Space, useTheme } from '@/theme';

const HEIGHT = 84;
const DOT = 4.5;

/** One slot per day of the window: a coloured dot at the day's level, a faint thread between check-ins. */
function MoodChart({ days, windowDays, to }: { days: MoodTrend['days']; windowDays: number; to: string }) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const first = addDays(to, -(windowDays - 1));
  const slot = (date: string) => Math.round((Date.parse(date) - Date.parse(first)) / 86_400_000);
  const x = (i: number) => DOT + (i / Math.max(windowDays - 1, 1)) * (width - DOT * 2);
  const y = (mood: number) => DOT + ((5 - mood) / 4) * (HEIGHT - DOT * 2);
  const points = days.map((d) => ({ x: x(slot(d.date)), y: y(d.mood), mood: d.mood, date: d.date }));
  return (
    <View style={{ height: HEIGHT }} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 ? (
        <Svg width={width} height={HEIGHT}>
          {/* The middle line: « ça va ». */}
          <Line x1={0} x2={width} y1={y(3)} y2={y(3)} stroke={colors.border} strokeWidth={1} strokeDasharray="3 4" />
          {points.length > 1 ? <Polyline points={points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} fill="none" stroke={colors.text3} strokeOpacity={0.45} strokeWidth={1.5} strokeLinejoin="round" /> : null}
          {points.map((p) => (
            <Circle key={p.date} cx={p.x} cy={p.y} r={DOT} fill={moodColor(p.mood, colors)} />
          ))}
        </Svg>
      ) : null}
    </View>
  );
}

/** The check-ins of the period, from the trend the server keeps over 30 days at least. */
export function moodDaysIn(trend: MoodTrend, from: string): MoodTrend['days'] {
  return trend.days.filter((d) => d.date >= from);
}

/**
 * Mood of the period in one line: the average and how many check-ins; the days and one gentle
 * « Les jours où… » underneath. A soft word stays visible when very low days keep coming.
 */
export function MoodTrendRow({ trend, from, to, first }: { trend: MoodTrend; from: string; to: string; first?: boolean }) {
  const { t, plural, locale } = useI18n();
  const { colors } = useTheme();
  const days = moodDaysIn(trend, from);
  const average = days.length ? days.reduce((sum, d) => sum + d.mood, 0) / days.length : null;
  const windowDays = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  const link = trend.link;

  return (
    <>
      <ExpandRow
        first={first}
        icon={<FaceSlightlySmiling size={17} color={colors.text} />}
        label={t('mood.title')}
        value={average !== null ? `${formatNumber(average, locale, 1)} ${t('mood.average')}` : '—'}
        caption={plural('mood.checkIns', days.length)}
        chart={days.length ? <MiniLine dots range={[1, 5]} color={colors.text2} points={days.map((d) => ({ x: (Date.parse(d.date) - Date.parse(from)) / Math.max(1, Date.parse(to) - Date.parse(from)), y: d.mood, color: moodColor(d.mood, colors) }))} /> : null}>
        {days.length ? <MoodChart days={days} windowDays={windowDays} to={to} /> : null}
        {link ? (
          <Txt variant="accent" tone="secondary" style={{ fontSize: 17, lineHeight: 24 }}>
            {t(`mood.link.${link.factor}` as TranslationKey, { with: formatNumber(link.withAvg, locale, 1), without: formatNumber(link.withoutAvg, locale, 1) })}
          </Txt>
        ) : null}
      </ExpandRow>
      {trend.persistentLow ? (
        <Row gap={Space.md} style={{ alignItems: 'flex-start', padding: Space.md, marginBottom: Space.md, borderRadius: Radius.md, backgroundColor: colors.surface2 }}>
          <HeartHandshake size={18} color={colors.text2} style={{ marginTop: 1 }} />
          <Txt variant="caption" tone="secondary" style={{ flex: 1 }}>
            {t('mood.support')}
          </Txt>
        </Row>
      ) : null}
    </>
  );
}
