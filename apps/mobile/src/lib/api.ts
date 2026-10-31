import type {
  ActivityInput,
  AuthResponse,
  BloodPressureInput,
  BloodPressureReading,
  BloodPressureReadingInput,
  BloodPressureTrend,
  CoachMealActionResult,
  CoachMessage,
  CravingNudges,
  CreateMealInput,
  Craving,
  CravingInput,
  CravingPatch,
  CravingTipRequest,
  DayActivity,
  DaySummary,
  FoodItem,
  Glance,
  GoalPlan,
  GoalsResponse,
  InsightsResponse,
  HydrationTrend,
  JournalEntry,
  JournalEntryInput,
  JournalEntryPatch,
  JournalKind,
  LibraryResponse,
  Meal,
  MealType,
  MoodCheckIn,
  MoodInput,
  MoodTrend,
  ProactiveSchedule,
  ProactiveSettingsPatch,
  Profile,
  Review,
  ServerInfo,
  SleepInput,
  SleepTrend,
  UpdateMealInput,
  User,
  WeeklyReview,
  WeeklyReviewState,
  VitalsInput,
  WaterEntry,
  WaterImport,
  WaterInput,
  WeightInput,
  Workout,
  WorkoutInput,
} from '@symbiose/shared';
import { toLocalDateTime } from '@symbiose/shared';
import { fetch as streamingFetch } from 'expo/fetch';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function normalizeServerUrl(input: string): string {
  let url = input.trim().replace(/\/+$/, '');
  if (url && !/^https?:\/\//i.test(url)) url = `http://${url}`;
  return url;
}

async function request<T>(baseUrl: string, token: string | null, method: string, path: string, body?: unknown, timeoutMs = 30_000): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        accept: 'application/json',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    throw new ApiError(0, timedOut ? 'timeout' : 'network', error instanceof Error ? error.message : 'Network error');
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    // A proxy's HTML error page keeps its status; a 200 that isn't JSON is a captive portal (plane, hotel Wi-Fi): no real network.
    if (res.ok) throw new ApiError(0, 'network', 'Unexpected response');
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? 'http_error', err?.message ?? `HTTP ${res.status}`);
  }
  return data as T;
}

/**
 * POSTs and reads Server-Sent Events: `delta` events go to `onDelta` as the
 * text is written, `done` resolves with its payload, `error` throws.
 */
async function postStream<T>(url: string, token: string, body: unknown, onDelta: (text: string) => void, signal?: AbortSignal): Promise<T> {
  let res;
  try {
    res = await streamingFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    throw new ApiError(0, 'network', error instanceof Error ? error.message : 'Network error');
  }
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    throw new ApiError(res.status, data?.error?.code ?? 'http_error', data?.error?.message ?? `HTTP ${res.status}`);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffer += value;
    // Events are separated by a blank line; each has `event:` and `data:` lines.
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf('\n\n');
      const event = /^event: ?(.*)$/m.exec(block)?.[1];
      const data = /^data: ?(.*)$/m.exec(block)?.[1];
      if (!event || data === undefined) continue;
      const payload = JSON.parse(data) as Record<string, unknown>;
      if (event === 'delta') onDelta(String(payload.text ?? ''));
      if (event === 'done') return payload as T;
      if (event === 'error') throw new ApiError(424, String(payload.code ?? 'ai_error'), String(payload.message ?? 'Error'));
    }
    if (done) break;
  }
  throw new ApiError(0, 'stream_ended', 'The reply was interrupted');
}

export function getServerInfo(baseUrl: string) {
  return request<ServerInfo>(baseUrl, null, 'GET', '/api/info', undefined, 8000);
}

export function authenticate(baseUrl: string, mode: 'login' | 'register', body: { email: string; password: string; name?: string }) {
  return request<AuthResponse>(baseUrl, null, 'POST', `/api/auth/${mode}`, body);
}

/** AI calls can take a while (vision + reasoning). */
const AI_TIMEOUT = 150_000;

export function createApi(baseUrl: string, token: string) {
  const call = <T,>(method: string, path: string, body?: unknown, timeout?: number) => request<T>(baseUrl, token, method, path, body, timeout);
  return {
    baseUrl,
    token,
    photoUrl: (id: string) => `${baseUrl}/api/photos/${id}`,
    authHeaders: { authorization: `Bearer ${token}` },

    me: () => call<User>('GET', '/api/me'),
    saveProfile: (profile: Profile) => call<User>('PUT', '/api/me/profile', profile),
    deleteAccount: () => call<void>('DELETE', '/api/me'),
    exportUrl: () => `${baseUrl}/api/me/export`,

    goals: (date?: string) => call<GoalsResponse>('GET', `/api/goals${date ? `?date=${date}` : ''}`),
    draftGoals: (intentions: string) => call<GoalsResponse & { aiGenerated: boolean }>('POST', '/api/goals/draft', { intentions }, AI_TIMEOUT),
    saveGoals: (plan: GoalPlan) => call<GoalsResponse>('PUT', '/api/goals', { plan }),

    day: (date: string) => call<DaySummary>('GET', `/api/days/${date}`),
    /** A day's meals alone: what the offline queue checks before sending a capture again. */
    meals: (date: string) => call<Meal[]>('GET', `/api/meals?date=${date}`),
    createMeal: (input: CreateMealInput) => call<Meal>('POST', '/api/meals', input, AI_TIMEOUT),
    meal: (id: string) => call<Meal>('GET', `/api/meals/${id}`),
    updateMeal: (id: string, input: UpdateMealInput) => call<Meal>('PATCH', `/api/meals/${id}`, input),
    refineMeal: (id: string, correction: string) => call<Meal>('POST', `/api/meals/${id}/refine`, { correction }, AI_TIMEOUT),
    duplicateMeal: (id: string, body: { eatenAt: string; localDate: string; mealType?: MealType }) =>
      call<Meal>('POST', `/api/meals/${id}/duplicate`, body),
    deleteMeal: (id: string) => call<void>('DELETE', `/api/meals/${id}`),

    library: (today: string) => call<LibraryResponse>('GET', `/api/foods/library?today=${today}`),
    glance: (date: string, hideCalories: boolean) => call<Glance>('GET', `/api/glance?date=${date}&hideCalories=${hideCalories ? 1 : 0}`),
    barcode: (code: string) => call<FoodItem>('GET', `/api/foods/barcode/${code}`),

    putActivity: (input: ActivityInput) => call<DayActivity>('PUT', '/api/activity', input),
    putWeights: (input: WeightInput) => call<{ written: number }>('PUT', '/api/weights', input),

    /** Bulk import from the health store; the server de-duplicates by `externalId`. */
    putWorkouts: (workouts: WorkoutInput[]) => call<{ written: number }>('PUT', '/api/workouts', { workouts }),
    /** Manual entry; the server estimates `activeKcal` when it's null. */
    createWorkout: (input: WorkoutInput) => call<Workout>('POST', '/api/workouts', input),
    deleteWorkout: (id: string) => call<void>('DELETE', `/api/workouts/${id}`),
    workouts: (from: string, to: string) => call<Workout[]>('GET', `/api/workouts?from=${from}&to=${to}`),

    /** Opt-in blood pressure: import (de-duplicated by `externalId`), manual entry, trend. */
    bloodPressure: (days = 90) => call<BloodPressureTrend>('GET', `/api/blood-pressure?days=${days}`),
    putBloodPressure: (input: BloodPressureInput) => call<{ written: number }>('PUT', '/api/blood-pressure', input),
    createBloodPressure: (reading: BloodPressureReadingInput) => call<BloodPressureReading>('POST', '/api/blood-pressure', reading),
    deleteBloodPressure: (id: string) => call<void>('DELETE', `/api/blood-pressure/${id}`),

    /** Opt-in life modules. Sleep only comes from the health store; drinks too, plus glasses logged here. */
    sleep: (days = 30) => call<SleepTrend>('GET', `/api/sleep?days=${days}`),
    putSleep: (input: SleepInput) => call<{ written: number }>('PUT', '/api/sleep', input),
    hydration: (days = 30) => call<HydrationTrend>('GET', `/api/hydration?days=${days}`),
    addWater: (input: WaterInput) => call<WaterEntry>('POST', '/api/hydration', input),
    putWater: (input: WaterImport) => call<{ written: number }>('PUT', '/api/hydration', input),
    deleteWater: (id: string) => call<void>('DELETE', `/api/hydration/${id}`),
    mood: (days = 30) => call<MoodTrend>('GET', `/api/mood?days=${days}`),
    /** The day's check-in; checking in again replaces it. */
    saveMood: (input: MoodInput) => call<MoodCheckIn>('PUT', '/api/mood', input),
    deleteMood: (date: string) => call<void>('DELETE', `/api/mood/${date}`),

    /** The day's check-ins between two days, newest first, for « Historique ». */
    moodCheckIns: (from: string, to: string) => call<MoodCheckIn[]>('GET', `/api/mood/check-ins?from=${from}&to=${to}`),

    /** Saved at once (`tip: 'stream'`): the tip comes from `streamCravingTip`. */
    createCraving: (input: CravingInput) => call<{ craving: Craving; alternative: string | null }>('POST', '/api/cravings', input),
    updateCraving: (id: string, patch: CravingPatch) => call<Craving>('PATCH', `/api/cravings/${id}`, patch),
    /** The tip, a line break, the alternative, as they are written; `done` has the craving with its tip saved. */
    streamCravingTip: (id: string, request: CravingTipRequest, onDelta: (text: string) => void, signal?: AbortSignal) =>
      postStream<{ craving: Craving; alternative: string }>(`${baseUrl}/api/cravings/${id}/tip/stream`, token, request, onDelta, signal),

    /** Health journal (the notes of « Historique »): newest first, optionally between two days and of one kind. */
    journal: (range: { from?: string; to?: string; kind?: JournalKind } = {}) => {
      const query = new URLSearchParams(Object.entries(range).filter((entry): entry is [string, string] => Boolean(entry[1]))).toString();
      return call<JournalEntry[]>('GET', `/api/journal${query ? `?${query}` : ''}`);
    },
    createNote: (input: JournalEntryInput) => call<JournalEntry>('POST', '/api/journal', input),
    updateNote: (id: string, patch: JournalEntryPatch) => call<JournalEntry>('PATCH', `/api/journal/${id}`, patch),
    deleteNote: (id: string) => call<void>('DELETE', `/api/journal/${id}`),

    insights: (days: number, to: string, hideCalories = false) => call<InsightsResponse>('GET', `/api/insights?days=${days}&to=${to}&hideCalories=${hideCalories ? 1 : 0}`),
    /** The saved « Bilan de la semaine » and whether to (re)write it now. */
    weeklyReview: (to: string, hideCalories = false) => call<WeeklyReviewState>('GET', `/api/insights/review?to=${to}&hideCalories=${hideCalories ? 1 : 0}`),
    /** Writes the review of the 7 days ending on `to` and saves it (older servers return the review alone). */
    review: (to: string) => call<Review & Partial<WeeklyReview>>('POST', '/api/insights/review', { days: 7, to }, AI_TIMEOUT),

    coachMessages: () => call<CoachMessage[]>('GET', '/api/coach/messages'),
    sendCoach: (text: string, localDate: string) =>
      call<{ user: CoachMessage; reply: CoachMessage }>('POST', '/api/coach/messages', { text, localDate }, AI_TIMEOUT),
    clearCoach: () => call<void>('DELETE', '/api/coach/messages'),
    /** Confirms a meal the coach proposed to add, edit or delete; adds and edits go through the AI. */
    applyCoachMealAction: (messageId: string, index: number) =>
      call<CoachMealActionResult>('POST', `/api/coach/messages/${messageId}/meal-actions/${index}/apply`, { now: toLocalDateTime() }, AI_TIMEOUT),
    dismissCoachMealAction: (messageId: string, index: number) => call<CoachMessage>('POST', `/api/coach/messages/${messageId}/meal-actions/${index}/dismiss`),

    /** Coach reply as Server-Sent Events: `onDelta` receives the text as it is written. */
    streamCoach: (text: string, localDate: string, onDelta: (text: string) => void) =>
      postStream<{ user: CoachMessage; reply: CoachMessage }>(`${baseUrl}/api/coach/messages/stream`, token, { text, localDate }, onDelta),

    /** Proactive coach: the schedule the phone plans its notifications from, and its settings. */
    proactive: (date: string) => call<ProactiveSchedule>('GET', `/api/proactive?date=${date}`),
    saveProactive: (patch: ProactiveSettingsPatch, localDate: string) => call<ProactiveSchedule>('PUT', '/api/proactive/settings', { ...patch, localDate }),
    /** The day's morning check-in, written on the first call, streamed as it is written. */
    streamMorning: (localDate: string, hideCalories: boolean, onDelta: (text: string) => void) =>
      postStream<{ message: CoachMessage }>(`${baseUrl}/api/proactive/morning/stream`, token, { localDate, hideCalories }, onDelta),
    nudges: (localDate: string) => call<CravingNudges>('POST', '/api/proactive/nudges', { localDate }, AI_TIMEOUT),
    putVitals: (input: VitalsInput) => call<{ written: number }>('PUT', '/api/vitals', input),
  };
}

export type Api = ReturnType<typeof createApi>;
