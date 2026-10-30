import { ChevronDown } from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Pressy, Txt } from '@/components/ui';
import { Radius, Space, useTheme } from '@/theme';

/**
 * One line of a compact card: an icon, the number that matters, a short caption and a mini chart.
 * A tap opens the details underneath (when there are some); the chevron turns with it.
 */
export function ExpandRow({
  icon,
  label,
  value,
  caption,
  captionColor,
  chart,
  children,
  first = false,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  caption?: string | null;
  captionColor?: string;
  chart?: ReactNode;
  children?: ReactNode;
  /** No hairline above the first row of a card. */
  first?: boolean;
}) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const turn = useSharedValue(0);
  useEffect(() => {
    turn.set(withTiming(open ? 1 : 0, { duration: 240, easing: Easing.bezier(0.2, 0, 0, 1) }));
  }, [open, turn]);
  const chevron = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value * 180}deg` }] }));
  const expandable = Boolean(children);

  const row = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingVertical: Space.md }}>
      <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }}>{icon}</View>
      <View style={{ flex: 1, gap: 1 }}>
        <Txt variant="caption" tone="secondary" numberOfLines={1}>
          {label}
        </Txt>
        <Txt variant="label" numberOfLines={1} style={{ fontSize: 16, fontVariant: ['tabular-nums'] }}>
          {value}
        </Txt>
        {caption ? (
          <Txt variant="caption" color={captionColor ?? colors.text2} numberOfLines={2} style={{ fontVariant: ['tabular-nums'] }}>
            {caption}
          </Txt>
        ) : null}
      </View>
      {chart}
      {expandable ? (
        <Animated.View style={chevron}>
          <ChevronDown size={18} color={colors.text3} />
        </Animated.View>
      ) : null}
    </View>
  );

  return (
    <View style={first ? null : { borderTopWidth: 1, borderTopColor: colors.border }}>
      {expandable ? (
        <Pressy onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityLabel={`${label}, ${value}`} accessibilityState={{ expanded: open }}>
          {row}
        </Pressy>
      ) : (
        row
      )}
      {open ? (
        <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(140)} style={{ gap: Space.lg, paddingBottom: Space.lg }}>
          {children}
        </Animated.View>
      ) : null}
    </View>
  );
}

/** A compact card: a small title, then rows. */
export function RowsCard({ title, children }: { title?: string; children: ReactNode }) {
  const { colors, elevation } = useTheme();
  return (
    <View style={[{ backgroundColor: colors.surface, borderRadius: Radius.xl, borderCurve: 'continuous', paddingHorizontal: Space.xl, paddingTop: title ? Space.lg : Space.xs, paddingBottom: Space.xs }, elevation]}>
      {title ? (
        <Txt variant="label" tone="secondary">
          {title}
        </Txt>
      ) : null}
      {children}
    </View>
  );
}
