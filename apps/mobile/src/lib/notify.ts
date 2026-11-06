import * as Notifications from 'expo-notifications';
import { AndroidImportance, IosAuthorizationStatus } from 'expo-notifications';
import { useEffect, useRef } from 'react';
import { Linking, Platform } from 'react-native';

import { ACTION_CRAVING, ACTION_FINE, CRAVING_CATEGORY, PROACTIVE_PREFIX, type PlannedNotification, type ProactiveData } from './proactive-plan';
import { STREAK_PREFIX } from './progress-logic';

/**
 * Local notifications for the proactive coach (no push, no server): planned
 * a week ahead on the phone, replaced whenever the plan changes. Web has no
 * such notifications (see notify.web.ts).
 */

export const notificationsSupported = true;

export type NotificationPermission = 'granted' | 'denied' | 'undetermined';

const CHANNEL = 'coach';

// The coach doesn't interrupt someone already in the app: Today's coach line says the same thing.
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const { identifier } = notification.request;
    // Nor does the streak reminder: Today already shows the flame waiting for its meal.
    const quiet = identifier.startsWith(PROACTIVE_PREFIX) || identifier.startsWith(STREAK_PREFIX);
    return { shouldShowBanner: !quiet, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false };
  },
});

export async function notificationPermission(): Promise<NotificationPermission> {
  const status = await Notifications.getPermissionsAsync();
  const ios = status.ios?.status;
  if (status.granted || ios === IosAuthorizationStatus.PROVISIONAL) return 'granted';
  return status.canAskAgain ? 'undetermined' : 'denied';
}

/** Asked at the moment it helps: when the person says « Oui » to a feature that notifies. */
export async function askNotificationPermission(): Promise<boolean> {
  // Android 13 only shows the prompt once a channel exists.
  await ensureChannel();
  if ((await notificationPermission()) === 'granted') return true;
  const status = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: false, allowSound: false } });
  return status.granted || status.ios?.status === IosAuthorizationStatus.PROVISIONAL;
}

export function openNotificationSettings() {
  void Linking.openSettings();
}

async function ensureChannel() {
  if (Platform.OS !== 'android') return;
  // Quiet by design: no sound, no vibration.
  await Notifications.setNotificationChannelAsync(CHANNEL, {
    name: 'Coach',
    importance: AndroidImportance.DEFAULT,
    sound: null,
    enableVibrate: false,
  });
}

/** The heads-up's two buttons, in the person's language. */
export async function setupCategories(labels: { craving: string; fine: string }) {
  await ensureChannel();
  await Notifications.setNotificationCategoryAsync(CRAVING_CATEGORY, [
    { identifier: ACTION_CRAVING, buttonTitle: labels.craving, options: { opensAppToForeground: true } },
    { identifier: ACTION_FINE, buttonTitle: labels.fine, options: { opensAppToForeground: false } },
  ]);
}

const localDate = (date: string, time: string) => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [h, min] = time.split(':').map(Number) as [number, number];
  return new Date(y, m - 1, d, h, min);
};

let replacing: Promise<void> = Promise.resolve();

/** A notification planned on the phone: the coach's (`PlannedNotification`) or the streak reminder's. */
export interface LocalNotification {
  id: string;
  date: string;
  time: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  category?: string;
}

/**
 * Makes the pending notifications whose identifier starts with `prefix` exactly
 * `planned`: one replacement at a time, so two plans never interleave.
 */
export function replaceNotifications(prefix: string, planned: readonly LocalNotification[]): Promise<void> {
  replacing = replacing.then(async () => {
    if ((await notificationPermission()) !== 'granted') return;
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(pending.filter((n) => n.identifier.startsWith(prefix)).map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)));
    const now = Date.now();
    for (const n of planned) {
      const date = localDate(n.date, n.time);
      if (date.getTime() <= now) continue;
      await Notifications.scheduleNotificationAsync({
        identifier: n.id,
        content: { title: n.title, body: n.body, data: n.data, sound: false, ...(n.category ? { categoryIdentifier: n.category } : null) },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date, channelId: CHANNEL },
      });
    }
  }).catch(() => {
    // A bonus, never a blocker: the app shows the same thing when it opens.
  });
  return replacing;
}

/** Makes the pending proactive notifications exactly `planned`. */
export function replaceScheduled(planned: PlannedNotification[]): Promise<void> {
  return replaceNotifications(PROACTIVE_PREFIX, planned);
}

export type NotificationResponse = { data: ProactiveData; action: 'open' | typeof ACTION_CRAVING | typeof ACTION_FINE };

/** Taps on the coach's notifications and on their buttons, including the one that launched the app. */
export function useNotificationResponses(onResponse: (response: NotificationResponse) => void) {
  const handler = useRef(onResponse);
  useEffect(() => {
    handler.current = onResponse;
  });
  useEffect(() => {
    const handle = (response: Notifications.NotificationResponse) => {
      const { identifier, content } = response.notification.request;
      if (!identifier.startsWith(PROACTIVE_PREFIX)) return;
      const action = response.actionIdentifier === ACTION_CRAVING || response.actionIdentifier === ACTION_FINE ? response.actionIdentifier : 'open';
      handler.current({ data: content.data as ProactiveData, action });
      Notifications.clearLastNotificationResponse();
    };
    const launch = Notifications.getLastNotificationResponse();
    if (launch) handle(launch);
    const sub = Notifications.addNotificationResponseReceivedListener(handle);
    return () => sub.remove();
  }, []);
}
