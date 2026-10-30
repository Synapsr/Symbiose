import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  Text as RNText,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import Animated, { Easing, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { keepTogether } from '@/lib/format';
import { haptics } from '@/lib/haptics';
import { Fonts, Motion, Radius, Space, useTheme, type Palette } from '@/theme';

// ---------------------------------------------------------------- Text

type Variant = 'display' | 'title' | 'accent' | 'heading' | 'body' | 'label' | 'caption' | 'number' | 'overline';

const VARIANTS: Record<Variant, TextStyle> = {
  display: { fontSize: 48, fontFamily: Fonts.display, letterSpacing: -1.2, fontVariant: ['tabular-nums'] },
  number: { fontSize: 22, fontFamily: Fonts.title, letterSpacing: -0.3, fontVariant: ['tabular-nums'] },
  title: { fontSize: 32, fontFamily: Fonts.title, letterSpacing: -0.6, lineHeight: 38 },
  accent: { fontSize: 32, fontFamily: Fonts.accent, letterSpacing: -0.4, lineHeight: 38 },
  heading: { fontSize: 18, fontWeight: '700', letterSpacing: -0.2 },
  body: { fontSize: 16, lineHeight: 22 },
  label: { fontSize: 14, fontWeight: '600' },
  caption: { fontSize: 13, lineHeight: 18 },
  overline: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
};

type Tone = 'primary' | 'secondary' | 'tertiary' | 'accent' | 'warning' | 'danger' | 'inverted';

function toneColor(tone: Tone, colors: Palette): string {
  return {
    primary: colors.text,
    secondary: colors.text2,
    tertiary: colors.text3,
    accent: colors.accent,
    warning: colors.warning,
    danger: colors.danger,
    inverted: colors.onInverted,
  }[tone];
}

/** Fraunces barely draws U+202F: its texts get a regular no-break space instead. */
const SERIF: Partial<Record<Variant, true>> = { display: true, number: true, title: true, accent: true };

export function Txt({
  variant = 'body',
  tone = 'primary',
  color,
  style,
  children,
  ...props
}: TextProps & { variant?: Variant; tone?: Tone; color?: string }) {
  const { colors } = useTheme();
  return (
    <RNText {...props} style={[VARIANTS[variant], { color: color ?? toneColor(tone, colors) }, style]}>
      {typeof children === 'string' ? keepTogether(children, SERIF[variant] === true) : children}
    </RNText>
  );
}

/** Counts smoothly to its value (eased), so changes feel alive instead of jumping. */
export function AnimatedNumber({ value, format, style, variant = 'display', tone, color }: { value: number; format: (n: number) => string } & Pick<Parameters<typeof Txt>[0], 'style' | 'variant' | 'tone' | 'color'>) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (start === value) return;
    const begin = Date.now();
    let frame = 0;
    const tick = () => {
      const t = Math.min(1, (Date.now() - begin) / 700);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = start + (value - start) * eased;
      setShown(next);
      from.current = next;
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return (
    <Txt variant={variant} tone={tone} color={color} style={style}>
      {format(shown)}
    </Txt>
  );
}

// ---------------------------------------------------------------- Layout

export function Card({ style, padded = true, ...props }: ViewProps & { padded?: boolean }) {
  const { colors, elevation } = useTheme();
  return <View {...props} style={[{ backgroundColor: colors.surface, borderRadius: Radius.xl, borderCurve: 'continuous' }, elevation, padded && { padding: Space.xl }, style]} />;
}

export function Row({ style, gap = Space.sm, ...props }: ViewProps & { gap?: number }) {
  return <View {...props} style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]} />;
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <Row style={{ justifyContent: 'space-between', marginTop: Space.xxl, marginBottom: Space.md, paddingHorizontal: 4 }}>
      <Txt variant="heading">{children}</Txt>
      {right}
    </Row>
  );
}

/** Staggered entrance for screen sections: fade + small rise, ~70 ms apart. `instant` shows it as is (a screen seen many times a day). */
export function Reveal({ index = 0, children, style, instant = false }: { index?: number; children: ReactNode; style?: StyleProp<ViewStyle>; instant?: boolean }) {
  const progress = useSharedValue(instant ? 1 : 0);
  useEffect(() => {
    if (instant) return;
    progress.set(withDelay(index * Motion.stagger, withTiming(1, { duration: 520, easing: Easing.out(Easing.cubic) })));
  }, [index, progress, instant]);
  const animated = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 12 }],
  }));
  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

// ---------------------------------------------------------------- Pressables

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const PRESS = { duration: 150, easing: Easing.out(Easing.quad) };

/** Cross-fades between two icons on state change: scale 0.25→1 and opacity, no bounce. */
export function SwapIcon({ on, onIcon, offIcon }: { on: boolean; onIcon: ReactNode; offIcon: ReactNode }) {
  const value = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    value.set(withTiming(on ? 1 : 0, { duration: 300, easing: Easing.bezier(0.2, 0, 0, 1) }));
  }, [on, value]);
  const onStyle = useAnimatedStyle(() => ({ opacity: value.value, transform: [{ scale: 0.25 + 0.75 * value.value }] }));
  const offStyle = useAnimatedStyle(() => ({ opacity: 1 - value.value, transform: [{ scale: 1 - 0.75 * value.value }] }));
  return (
    <View>
      <Animated.View style={offStyle}>{offIcon}</Animated.View>
      <Animated.View style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }, onStyle]}>{onIcon}</Animated.View>
    </View>
  );
}

/** Every touchable: eases to 0.96 on press (interruptible), with a selection haptic. */
export function Pressy({ style, onPress, onPressIn, onPressOut, haptic = true, children, ...props }: PressableProps & { haptic?: boolean; style?: StyleProp<ViewStyle> }) {
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <AnimatedPressable
      {...props}
      onPressIn={(e) => {
        scale.set(withTiming(0.96, PRESS));
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.set(withTiming(1, PRESS));
        onPressOut?.(e);
      }}
      onPress={(e) => {
        if (haptic) haptics.tap();
        onPress?.(e);
      }}
      style={[style, animated, props.disabled ? { opacity: 0.45 } : null]}>
      {children}
    </AnimatedPressable>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'accent' | 'danger';

export function Button({
  title,
  onPress,
  variant = 'primary',
  icon,
  loading,
  disabled,
  size = 'lg',
  style,
}: {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  icon?: ReactNode;
  loading?: boolean;
  disabled?: boolean;
  size?: 'md' | 'lg';
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const inactive = disabled && !loading;
  const bg = inactive ? colors.surface2 : { primary: colors.inverted, secondary: colors.surface2, ghost: 'transparent', accent: colors.accent, danger: colors.surface2 }[variant];
  const fg = inactive ? colors.text3 : { primary: colors.onInverted, secondary: colors.text, ghost: colors.text2, accent: colors.onAccent, danger: colors.danger }[variant];
  return (
    <Pressy
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={[
        {
          height: size === 'lg' ? 56 : 44,
          paddingHorizontal: size === 'lg' ? Space.xxl : Space.lg,
          borderRadius: Radius.pill,
          backgroundColor: bg,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: Space.sm,
        },
        inactive ? { opacity: 1 } : null,
        style,
      ]}>
      {loading ? <ActivityIndicator color={fg} /> : icon}
      <Txt variant="label" color={fg} style={{ fontSize: size === 'lg' ? 17 : 15 }}>
        {title}
      </Txt>
    </Pressy>
  );
}

export function IconButton({
  icon,
  onPress,
  onLongPress,
  label,
  size = 44,
  variant = 'surface',
  style,
}: {
  icon: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  label: string;
  size?: number;
  variant?: 'surface' | 'inverted' | 'glass' | 'plain';
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const bg = { surface: colors.surface2, inverted: colors.inverted, glass: 'rgba(0,0,0,0.35)', plain: 'transparent' }[variant];
  return (
    <Pressy
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }, style]}>
      {icon}
    </Pressy>
  );
}

export function Chip({ label, selected, onPress, icon, color }: { label: string; selected?: boolean; onPress?: () => void; icon?: ReactNode; color?: string }) {
  const { colors, elevation } = useTheme();
  return (
    <Pressy
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[
        { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, height: 40, borderRadius: Radius.pill, backgroundColor: selected ? (color ?? colors.inverted) : colors.surface },
        selected ? null : elevation,
      ]}>
      {icon}
      <Txt variant="label" color={selected ? colors.onInverted : colors.text}>
        {label}
      </Txt>
    </Pressy>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  const { colors, elevation } = useTheme();
  return (
    <Row gap={2} style={{ backgroundColor: colors.surface2, borderRadius: Radius.pill, padding: 3, alignSelf: 'flex-start' }}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressy
            key={option.value}
            onPress={() => onChange(option.value)}
            style={[{ paddingHorizontal: Space.lg, height: 34, borderRadius: Radius.pill, justifyContent: 'center', backgroundColor: active ? colors.surface : 'transparent' }, active ? elevation : null]}>
            <Txt variant="label" tone={active ? 'primary' : 'secondary'}>
              {option.label}
            </Txt>
          </Pressy>
        );
      })}
    </Row>
  );
}

// ---------------------------------------------------------------- Inputs

/**
 * Web text fields draw no browser focus ring: Chrome paints `outline-style: auto`
 * whatever the width, so the style is set too. Fields show focus their own way.
 */
export const webInput = Platform.OS === 'web' ? ({ outlineWidth: 0, outlineStyle: 'solid' } as const) : null;

/** A web textarea defaults to two rows: start at one, like on native. */
export const webSingleRow = Platform.OS === 'web' ? { numberOfLines: 1 } : null;

export function Field({ label, style, onFocus, onBlur, ...props }: TextInputProps & { label?: string }) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      {label ? (
        <Txt variant="caption" tone="secondary" style={{ marginLeft: 4 }}>
          {label}
        </Txt>
      ) : null}
      <TextInput
        placeholderTextColor={colors.text3}
        {...props}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[
          {
            minHeight: 56,
            borderRadius: Radius.lg,
            backgroundColor: colors.surface,
            borderWidth: 1.5,
            borderColor: focused ? colors.text : colors.border,
            paddingHorizontal: Space.lg,
            fontSize: 17,
            color: colors.text,
          },
          webInput,
          props.multiline && { paddingTop: 16, paddingBottom: 16, minHeight: 120, textAlignVertical: 'top' },
          style,
        ]}
      />
    </View>
  );
}

// ---------------------------------------------------------------- Progress

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** Progress ring that fills with an ease-out when its value changes. */
export function Ring({ progress, size = 160, stroke = 14, color, track, children }: { progress: number; size?: number; stroke?: number; color: string; track?: string; children?: ReactNode }) {
  const { colors } = useTheme();
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const value = useSharedValue(0);
  useEffect(() => {
    value.set(withTiming(Math.max(0, Math.min(progress, 1)), { duration: Motion.dataDuration, easing: Easing.out(Easing.cubic) }));
  }, [progress, value]);
  const animatedProps = useAnimatedProps(() => ({ strokeDashoffset: circumference * (1 - value.value) }));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke={track ?? colors.surface2} strokeWidth={stroke} fill="none" />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          animatedProps={animatedProps}
        />
      </Svg>
      {children}
    </View>
  );
}

/** Horizontal progress bar with a springy fill. */
export function Bar({ progress, color, height = 8 }: { progress: number; color: string; height?: number }) {
  const { colors } = useTheme();
  const value = useSharedValue(0);
  useEffect(() => {
    value.set(withTiming(Math.max(0, Math.min(progress, 1)), { duration: Motion.dataDuration, easing: Easing.out(Easing.cubic) }));
  }, [progress, value]);
  const fill = useAnimatedStyle(() => ({ width: `${value.value * 100}%` }));
  return (
    <View style={{ height, borderRadius: height, backgroundColor: colors.surface2, overflow: 'hidden' }}>
      <Animated.View style={[{ height, borderRadius: height, backgroundColor: color }, fill]} />
    </View>
  );
}

/** Soft colored light behind hero content. */
export function Glow({ color, size = 260, opacity = 0.28, style }: { color: string; size?: number; opacity?: number; style?: StyleProp<ViewStyle> }) {
  const id = `glow-${color.replace('#', '')}`;
  return (
    <View pointerEvents="none" style={[{ position: 'absolute', width: size, height: size }, style]}>
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={color} stopOpacity={opacity} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width={size} height={size} fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

export function Dot({ color, size = 8 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}

export function Skeleton({ width, height, radius = Radius.sm }: { width: number | `${number}%`; height: number; radius?: number }) {
  const { colors } = useTheme();
  const pulse = useSharedValue(0.5);
  useEffect(() => {
    pulse.set(withRepeat(withTiming(1, { duration: 800 }), -1, true));
  }, [pulse]);
  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return <Animated.View style={[{ width, height, borderRadius: radius, backgroundColor: colors.surface2 }, style]} />;
}
