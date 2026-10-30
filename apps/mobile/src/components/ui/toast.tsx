import { Platform } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useToast } from '@/lib/stores';
import { Radius, Space, useTheme } from '@/theme';

import { Pressy, Txt } from './index';

/** Global, non-blocking confirmation with an optional undo action. */
export function ToastHost() {
  const toast = useToast((s) => s.current);
  const hide = useToast((s) => s.hide);
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  if (!toast) return null;
  return (
    <Animated.View
      key={toast.id}
      entering={FadeInDown.duration(220)}
      exiting={FadeOutDown.duration(180)}
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: Space.lg,
        right: Space.lg,
        bottom: insets.bottom + (Platform.OS === 'web' ? 96 : 72),
        alignItems: 'center',
      }}>
      <Pressy
        haptic={false}
        onPress={() => {
          toast.onPress?.();
          hide();
        }}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: Space.md,
          maxWidth: '100%',
          backgroundColor: colors.inverted,
          borderRadius: Radius.pill,
          paddingLeft: Space.xl,
          paddingRight: toast.action ? 6 : Space.xl,
          paddingVertical: 6,
          minHeight: 48,
          boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
        }}>
        <Txt variant="label" color={colors.onInverted} numberOfLines={1} style={{ flexShrink: 1 }}>
          {toast.message}
        </Txt>
        {toast.action ? (
          <Pressy
            onPress={() => {
              toast.action?.onPress();
              hide();
            }}
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
