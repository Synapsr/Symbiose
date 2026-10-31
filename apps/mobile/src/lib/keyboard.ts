import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { useAnimatedStyle } from 'react-native-reanimated';

/**
 * Bottom padding for a composer at the foot of a screen: it clears whichever covers more of the
 * bottom, the keyboard or what rests there (`rest`: the tab bar, the home indicator), plus `gap`.
 *
 * It reads the keyboard's real position on the UI thread, frame by frame and also while the
 * keyboard is dragged away, rather than keeping a "keyboard open" state from show and hide events:
 * an event missed or out of order (a drag-dismissal while a reply streams in) can't leave the
 * keyboard's space behind.
 */
export function useKeyboardLift(rest: number, gap: number) {
  // From 0 (down) to minus the keyboard's height (up).
  const { height } = useReanimatedKeyboardAnimation();
  return useAnimatedStyle(() => ({ paddingBottom: Math.max(-height.value, rest) + gap }));
}
