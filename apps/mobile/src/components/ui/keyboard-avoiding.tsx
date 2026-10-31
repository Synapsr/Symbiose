import { KeyboardAvoidingView, Platform, type ViewProps } from 'react-native';

/**
 * A screen with text fields that keeps the focused one above the keyboard.
 * iOS: React Native's own, with padding. Web: the browser handles it.
 * Android has its own file (keyboard-avoiding.android.tsx).
 */
export function KeyboardAvoiding(props: ViewProps) {
  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} {...props} />;
}
