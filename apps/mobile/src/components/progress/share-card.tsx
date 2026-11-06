import type { MilestoneFamily } from '@symbiose/shared';
import type { Ref } from 'react';
import Svg, { Circle, Defs, G, LinearGradient, Path, Rect, Stop, Text } from 'react-native-svg';

import { BOURGEON, bourgeonPath } from '@/components/ui/bourgeon-path';
import { Fonts } from '@/theme';

/** The shared image: 4:5, the size a feed and a story both take without cropping. */
export const CARD = { width: 1080, height: 1350 } as const;

/** Lucide's glyphs (24-unit box, stroked), drawn into the card itself: the same as `FamilyIcon`. */
const GLYPHS: Record<MilestoneFamily, string[]> = {
  streak: ['M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4'],
  days: ['M8 2v3', 'M16 2v3', 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M3 9h18', 'm9 15 2 2 4-4'],
  cravings: [
    'M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z',
    'M20 2v4',
    'M22 4h-4',
    'M2 20a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
  ],
};

/** Each family's light, from top left to bottom right. */
const GRADIENTS: Record<MilestoneFamily, [string, string]> = {
  streak: ['#FFB547', '#E2560F'],
  days: ['#3CCB9C', '#0B6B59'],
  cravings: ['#A493FF', '#5B43D6'],
};

const LOGO = bourgeonPath(BOURGEON.c1x, BOURGEON.c1y, BOURGEON.r1, BOURGEON.c2x, BOURGEON.c2y, BOURGEON.r2, BOURGEON.rf);
const GLYPH_SCALE = 9;

/**
 * A milestone as an image to share: the mark, the number, what it counts and
 * the day. Nothing else: no name, no meal, no weight. Drawn in SVG so the
 * same drawing is the preview on screen and, through `toDataURL`, the PNG.
 */
export function ShareCard({ ref, family, value, unit, date, width }: { ref?: Ref<Svg>; family: MilestoneFamily; value: number; unit: string; date: string; width: number }) {
  const [from, to] = GRADIENTS[family];
  const glyphSize = 24 * GLYPH_SCALE;
  return (
    <Svg ref={ref} width={width} height={(width * CARD.height) / CARD.width} viewBox={`0 0 ${CARD.width} ${CARD.height}`}>
      <Defs>
        <LinearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={from} />
          <Stop offset="1" stopColor={to} />
        </LinearGradient>
      </Defs>
      <Rect x={0} y={0} width={CARD.width} height={CARD.height} fill="url(#bg)" />
      <Circle cx={930} cy={170} r={330} fill="#FFFFFF" fillOpacity={0.08} />
      <Circle cx={90} cy={1290} r={280} fill="#FFFFFF" fillOpacity={0.06} />

      <G transform="translate(92 92) scale(0.95)">
        <Path d={LOGO} fill="#FFFFFF" />
      </G>
      <Text x={210} y={162} fill="#FFFFFF" fontSize={60} fontFamily={Fonts.title} fontWeight="600">
        Symbiose
      </Text>

      <G transform={`translate(${(CARD.width - glyphSize) / 2} 330) scale(${GLYPH_SCALE})`}>
        {GLYPHS[family].map((d) => (
          <Path key={d} d={d} fill="none" stroke="#FFFFFF" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        ))}
      </G>

      <Text x={CARD.width / 2} y={900} fill="#FFFFFF" fontSize={value >= 1000 ? 280 : 340} fontFamily={Fonts.display} fontWeight="700" textAnchor="middle">
        {String(value)}
      </Text>
      <Text x={CARD.width / 2} y={1000} fill="#FFFFFF" fontSize={76} fontFamily={Fonts.title} fontWeight="600" textAnchor="middle">
        {unit}
      </Text>
      <Text x={CARD.width / 2} y={1078} fill="#FFFFFF" fillOpacity={0.75} fontSize={42} fontFamily={Fonts.accent} fontStyle="italic" textAnchor="middle">
        {date}
      </Text>
      <Text x={CARD.width / 2} y={1272} fill="#FFFFFF" fillOpacity={0.7} fontSize={34} letterSpacing={2} textAnchor="middle">
        symbiose.synapsr.io
      </Text>
    </Svg>
  );
}
