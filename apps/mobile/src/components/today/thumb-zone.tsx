import { router } from 'expo-router';
import { Camera, Plus } from 'lucide-react-native';
import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import { Pressy } from '@/components/ui';
import { useI18n } from '@/i18n';
import { haptics } from '@/lib/haptics';
import { Space, useTheme } from '@/theme';

export const CAPTURE_SIZE = 68;
const PLUS_SIZE = 52;

/**
 * Two buttons, one rule: 📷 for a meal (tap = photo, the long press types it),
 * « + » for everything else. Both sit under the thumb, the camera outermost;
 * left-handed mode mirrors them. A soft ripple invites the first photo of the day.
 */
export function ThumbZone({ date, bottom, invite, side }: { date: string; bottom: number; invite: boolean; side: 'left' | 'right' }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const halo = useSharedValue(0);
  useEffect(() => {
    halo.set(invite ? withRepeat(withSequence(withTiming(1, { duration: 1600, easing: Easing.out(Easing.quad) }), withTiming(0, { duration: 0 })), -1) : withTiming(0));
  }, [invite, halo]);
  const haloStyle = useAnimatedStyle(() => ({ opacity: (1 - halo.value) * 0.3, transform: [{ scale: 1 + halo.value * 0.5 }] }));

  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', [side]: Space.xl, bottom, flexDirection: side === 'right' ? 'row' : 'row-reverse', alignItems: 'center', gap: Space.md }}>
      <Pressy
        accessibilityRole="button"
        accessibilityLabel={t('log.title')}
        accessibilityHint={t('log.hint')}
        onPress={() => router.push({ pathname: '/log', params: { date } })}
        style={{
          width: PLUS_SIZE,
          height: PLUS_SIZE,
          borderRadius: PLUS_SIZE / 2,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 8px 22px rgba(0,0,0,0.16)',
        }}>
        <Plus size={24} color={colors.text} strokeWidth={2.4} />
      </Pressy>

      <View style={{ width: CAPTURE_SIZE, height: CAPTURE_SIZE }}>
        <Animated.View
          pointerEvents="none"
          style={[{ position: 'absolute', width: CAPTURE_SIZE, height: CAPTURE_SIZE, borderRadius: CAPTURE_SIZE / 2, backgroundColor: colors.inverted }, haloStyle]}
        />
        <Pressy
          haptic={false}
          accessibilityRole="button"
          accessibilityLabel={t('capture.photo')}
          onPress={() => {
            haptics.impact();
            router.push({ pathname: '/capture', params: { date } });
          }}
          onLongPress={() => {
            haptics.impact();
            router.push({ pathname: '/capture', params: { date, mode: 'text' } });
          }}
          style={{
            width: CAPTURE_SIZE,
            height: CAPTURE_SIZE,
            borderRadius: CAPTURE_SIZE / 2,
            backgroundColor: colors.inverted,
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 10px 28px rgba(0,0,0,0.25)',
          }}>
          <Camera size={28} color={colors.onInverted} />
        </Pressy>
      </View>
    </View>
  );
}
