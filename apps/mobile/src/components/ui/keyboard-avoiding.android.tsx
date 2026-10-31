import type { ViewProps } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

/**
 * Android: the root KeyboardProvider takes the keyboard's insets over, so the window no longer
 * shrinks for it (adjustResize) and React Native's KeyboardAvoidingView has nothing to follow.
 * The keyboard controller's own one pads the screen frame by frame, wherever the screen sits
 * (a modal, a sheet), and the scroll view inside brings the focused field into view.
 */
export function KeyboardAvoiding(props: ViewProps) {
  return <KeyboardAvoidingView behavior="padding" automaticOffset {...props} />;
}
