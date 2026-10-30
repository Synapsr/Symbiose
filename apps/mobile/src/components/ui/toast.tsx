import { useEffect } from 'react';
import { Platform } from 'react-native';
import Animated, { Easing, FadeInDown, FadeOutDown, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSettings, useToast } from '@/lib/stores';
import { Radius, Space, useTheme } from '@/theme';

import { Pressy, Txt } from './index';

/**
 * Global, non-blocking confirmation with an optional undo action. On Today it
 * rises above the thumb buttons, so it never covers the camera.
 */
export function ToastHost() {
  const toast = useToast((s) => s.current);
  const hide = useToast((s) => s.hide);
  const act = useToast((s) => s.act);
  const lift = useToast((s) => s.lift);
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const leftHanded = useSettings((s) => s.leftHanded);
  const bottom = Math.max(insets.bottom + (Platform.OS === 'web' ? 96 : 72), lift);
  const offset = useSharedValue(bottom);
  useEffect(() => {
    offset.set(withTiming(bottom, { duration: 220, easing: Easing.out(Easing.cubic) }));
  }, [bottom, offset]);
  const position = useAnimatedStyle(() => ({ bottom: offset.value }));
  if (!toast) return null;
  // The undo button sits on the thumb's side.
  const actionPad = toast.action ? 6 : Space.xl;
  return (
    <Animated.View
      key={toast.id}
      entering={FadeInDown.duration(220)}
      exiting={FadeOutDown.duration(180)}
      pointerEvents="box-none"
      style={[{ position: 'absolute', left: Space.lg, right: Space.lg, alignItems: 'center' }, position]}>
      <Pressy
        haptic={false}
        onPress={() => {
          toast.onPress?.();
          hide();
        }}
        style={{
          flexDirection: leftHanded ? 'row-reverse' : 'row',
          alignItems: 'center',
          gap: Space.md,
          maxWidth: '100%',
          backgroundColor: colors.inverted,
          borderRadius: Radius.pill,
          paddingLeft: leftHanded ? actionPad : Space.xl,
          paddingRight: leftHanded ? Space.xl : actionPad,
          paddingVertical: 6,
          minHeight: 48,
          boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
        }}>
        <Txt variant="label" color={colors.onInverted} numberOfLines={1} style={{ flexShrink: 1 }}>
          {toast.message}
        </Txt>
        {toast.action ? (
          <Pressy
            onPress={act}
            accessibilityRole="button"
            style={{ paddingHorizontal: Space.lg, height: 36, borderRadius: Radius.pill, justifyContent: 'center', backgroundColor: 'rgba(127,127,127,0.25)' }}>
            <Txt variant="label" color={colors.onInverted}>
              {toast.action.label}
            </Txt>
          </Pressy>
        ) : null}
      </Pressy>
    </Animated.View>
  );
}
