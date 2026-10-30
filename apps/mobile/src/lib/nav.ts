import { router } from 'expo-router';

/** Closes a modal screen, or goes home when it was opened directly (deep link, web reload). */
export function dismiss() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}
