import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

const enabled = Platform.OS !== 'web';

export const haptics = {
  tap: () => enabled && void Haptics.selectionAsync().catch(() => undefined),
  /** The faintest knock: a step of a build-up. */
  light: () => enabled && void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined),
  /** A rounded, low thud: a glass poured, a mood picked. */
  soft: () => enabled && void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(() => undefined),
  impact: () => enabled && void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined),
  /** The big one, kept for the peak of a celebration: the flame catching, a milestone's card landing. */
  heavy: () => enabled && void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => undefined),
  success: () => enabled && void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined),
  warning: () => enabled && void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined),
};
