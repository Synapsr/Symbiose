import type {
  ActivityInput,
  AuthResponse,
  CoachMessage,
  CreateMealInput,
  Craving,
  CravingInput,
  CravingOutcome,
  DayActivity,
  DaySummary,
  FoodItem,
  GoalPlan,
  GoalsResponse,
  InsightsResponse,
  LibraryResponse,
  Meal,
  MealType,
  Profile,
  Review,
  ServerInfo,
  UpdateMealInput,
  User,
} from '@symbiose/shared';

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
    throw new ApiError(0, 'network', error instanceof Error ? error.message : 'Network error');
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? 'http_error', err?.message ?? `HTTP ${res.status}`);
  }
  return data as T;
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
    createMeal: (input: CreateMealInput) => call<Meal>('POST', '/api/meals', input, AI_TIMEOUT),
    meal: (id: string) => call<Meal>('GET', `/api/meals/${id}`),
    updateMeal: (id: string, input: UpdateMealInput) => call<Meal>('PATCH', `/api/meals/${id}`, input),
    refineMeal: (id: string, correction: string) => call<Meal>('POST', `/api/meals/${id}/refine`, { correction }, AI_TIMEOUT),
    duplicateMeal: (id: string, body: { eatenAt: string; localDate: string; mealType?: MealType }) =>
      call<Meal>('POST', `/api/meals/${id}/duplicate`, body),
    deleteMeal: (id: string) => call<void>('DELETE', `/api/meals/${id}`),

    library: (today: string) => call<LibraryResponse>('GET', `/api/foods/library?today=${today}`),
    barcode: (code: string) => call<FoodItem>('GET', `/api/foods/barcode/${code}`),

    putActivity: (input: ActivityInput) => call<DayActivity>('PUT', '/api/activity', input),

    createCraving: (input: CravingInput) => call<{ craving: Craving; alternative: string }>('POST', '/api/cravings', input, 60_000),
    updateCraving: (id: string, outcome: CravingOutcome) => call<Craving>('PATCH', `/api/cravings/${id}`, { outcome }),

    insights: (days: number, to: string) => call<InsightsResponse>('GET', `/api/insights?days=${days}&to=${to}`),
    review: (days: number, to: string) => call<Review>('POST', '/api/insights/review', { days, to }, AI_TIMEOUT),

    coachMessages: () => call<CoachMessage[]>('GET', '/api/coach/messages'),
    sendCoach: (text: string, localDate: string) =>
      call<{ user: CoachMessage; reply: CoachMessage }>('POST', '/api/coach/messages', { text, localDate }, AI_TIMEOUT),
    clearCoach: () => call<void>('DELETE', '/api/coach/messages'),
  };
}

export type Api = ReturnType<typeof createApi>;
