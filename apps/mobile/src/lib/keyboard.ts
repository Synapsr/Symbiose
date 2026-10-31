import { useState } from 'react';
import { Platform, type LayoutChangeEvent } from 'react-native';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaFrame } from 'react-native-safe-area-context';

/**
 * Bottom padding for a composer at the foot of a screen: it clears whichever covers more of the
 * bottom, the keyboard or what rests there (`rest`: the tab bar, the home indicator), plus `gap`.
 * `overlap` is how far above the window's bottom the screen ends (see `useBottomOverlap`): the
 * keyboard and `rest` are measured from the window's bottom, so that much of them is already clear.
 *
 * It reads the keyboard's real position on the UI thread, frame by frame and also while the
 * keyboard is dragged away, rather than keeping a "keyboard open" state from show and hide events:
 * an event missed or out of order (a drag-dismissal while a reply streams in) can't leave the
 * keyboard's space behind.
 */
export function useKeyboardLift(rest: number, gap: number, overlap = 0) {
  // From 0 (down) to minus the keyboard's height (up).
  const { height } = useReanimatedKeyboardAnimation();
  return useAnimatedStyle(() => ({ paddingBottom: Math.max(-height.value - overlap, rest - overlap, 0) + gap }));
}

/**
 * How far above the window's bottom edge a screen ends. On Android a native tab's screen stops at
 * the tab bar, which also takes the navigation bar's inset, where on iOS the tab bar floats over a
 * screen that runs to the bottom. Give `onLayout` to the screen's root view. Always 0 off Android.
 */
export function useBottomOverlap() {
  const frame = useSafeAreaFrame();
  const [overlap, setOverlap] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => {
    const view = e.currentTarget;
    if (Platform.OS !== 'android' || typeof view === 'number') return;
    view.measureInWindow((_x, y, _width, height) => setOverlap(Math.max(0, Math.round(frame.height - y - height))));
  };
  return { overlap, onLayout };
}
