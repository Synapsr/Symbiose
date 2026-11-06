import type { ACTION_CRAVING, ACTION_FINE, PlannedNotification, ProactiveData } from './proactive-plan';

// The web app has no local notifications: the coach line on Today is the only surface.

export const notificationsSupported = false;

export type NotificationPermission = 'granted' | 'denied' | 'undetermined';

export async function notificationPermission(): Promise<NotificationPermission> {
  return 'denied';
}

export async function askNotificationPermission(): Promise<boolean> {
  return false;
}

export function openNotificationSettings() {}

export async function setupCategories(_labels: { craving: string; fine: string }) {}

export interface LocalNotification {
  id: string;
  date: string;
  time: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  category?: string;
}

export async function replaceNotifications(_prefix: string, _planned: readonly LocalNotification[]): Promise<void> {}

export async function replaceScheduled(_planned: PlannedNotification[]): Promise<void> {}

export type NotificationResponse = { data: ProactiveData; action: 'open' | typeof ACTION_CRAVING | typeof ACTION_FINE };

export function useNotificationResponses(_onResponse: (response: NotificationResponse) => void) {}
