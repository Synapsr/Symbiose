import { addDays, type MoodTrend } from '@symbiose/shared';
import { FaceSlightlySmiling, HeartHandshake } from 'lucide-react-native';
import { useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';

import { MoodFace, moodColor } from '@/components/mood-face';
import { Card, Row, Txt } from '@/components/ui';
import { useI18n, type TranslationKey } from '@/i18n';
import { formatNumber } from '@/lib/format';
import { Radius, Space, useTheme } from '@/theme';

const HEIGHT = 84;
const DOT = 4.5;

/** One slot per day of the window: a coloured dot at the day's level, a faint thread between check-ins. */
function MoodChart({ trend, to }: { trend: MoodTrend; to: string }) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const first = addDays(to, -(trend.windowDays - 1));
  const slot = (date: string) => Math.round((Date.parse(date) - Date.parse(first)) / 86_400_000);
  const x = (i: number) => DOT + (i / Math.max(trend.windowDays - 1, 1)) * (width - DOT * 2);
  const y = (mood: number) => DOT + ((5 - mood) / 4) * (HEIGHT - DOT * 2);
  const points = trend.days.map((d) => ({ x: x(slot(d.date)), y: y(d.mood), mood: d.mood, date: d.date }));
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

/**
 * Mood over 30 days: the average, the days, one gentle « Les jours où… »
 * when there is enough data, and a soft word if very low days keep coming.
 */
export function MoodCard({ trend, to }: { trend: MoodTrend; to: string }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const link = trend.link;

  return (
    <Card style={{ gap: Space.lg }}>
      <View style={{ gap: 2 }}>
        <Row gap={6}>
          <FaceSlightlySmiling size={14} color={colors.text2} />
          <Txt variant="label" tone="secondary">
            {t('mood.title')}
          </Txt>
        </Row>
        {trend.average !== null ? (
          <Row gap={Space.md} style={{ marginTop: 2 }}>
            <MoodFace mood={trend.average} size={40} color={moodColor(trend.average, colors)} filled />
            <View style={{ flex: 1 }}>
              <Row gap={6} style={{ alignItems: 'baseline' }}>
                <Txt variant="display" style={{ fontSize: 36 }}>
                  {formatNumber(trend.average, locale, 1)}
                </Txt>
                <Txt tone="secondary" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {t('mood.average')}
                </Txt>
              </Row>
              <Txt variant="caption" tone="tertiary">
                {t('mood.days', { count: trend.days.length })}
              </Txt>
            </View>
          </Row>
        ) : (
          <Txt tone="secondary" style={{ marginTop: Space.xs }}>
            {t('mood.empty')}
          </Txt>
        )}
      </View>

      {trend.days.length ? <MoodChart trend={trend} to={to} /> : null}

      {link ? (
        <Txt variant="accent" tone="secondary" style={{ fontSize: 17, lineHeight: 24 }}>
          {t(`mood.link.${link.factor}` as TranslationKey, { with: formatNumber(link.withAvg, locale, 1), without: formatNumber(link.withoutAvg, locale, 1) })}
        </Txt>
      ) : null}

      {trend.persistentLow ? (
        <Row gap={Space.md} style={{ alignItems: 'flex-start', padding: Space.md, borderRadius: Radius.md, backgroundColor: colors.surface2 }}>
          <HeartHandshake size={18} color={colors.text2} style={{ marginTop: 1 }} />
          <Txt variant="caption" tone="secondary" style={{ flex: 1 }}>
            {t('mood.support')}
          </Txt>
        </Row>
      ) : null}
    </Card>
  );
}
