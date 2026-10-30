import { z } from 'zod';

import type { DayHydration, HydrationTrend, MoodCheckIn, MoodTrend, SleepNight, SleepTrend } from './life';
import { NutrientKeySchema, NutrientsSchema, type NutrientKey, type Nutrients } from './nutrients';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
/** Device-local timestamp with its UTC offset, e.g. 2026-10-30T16:05:00+01:00 */
const localDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/, 'Expected ISO 8601 with offset');

export const LocalDateSchema = isoDate;
export const LocalDateTimeSchema = localDateTime;

// ---------------------------------------------------------------- Profile

export const SexSchema = z.enum(['female', 'male', 'other']);
export type Sex = z.infer<typeof SexSchema>;

export const ActivityLevelSchema = z.enum(['sedentary', 'light', 'moderate', 'active', 'athlete']);
export type ActivityLevel = z.infer<typeof ActivityLevelSchema>;

export const LocaleSchema = z.enum(['fr', 'en']);
export type Locale = z.infer<typeof LocaleSchema>;

/** Local clock time, "HH:MM". */
export const ClockTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM');

/**
 * The proactive coach (« Coach proactif »): off until switched on. Inside it,
 * the morning check-in and the Monday review default on; the craving heads-up
 * follows the goals when left unset (see `cravingHeadsUpByDefault`).
 */
export const ProactiveSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  morning: z.boolean().default(true),
  cravings: z.boolean().optional(),
  weekly: z.boolean().default(true),
  /** A morning time the person picked; null follows their usual wake time. */
  morningTime: ClockTimeSchema.nullable().default(null),
  /** Nothing is sent between these two times. */
  quietStart: ClockTimeSchema.default('22:00'),
  quietEnd: ClockTimeSchema.default('07:00'),
});
export type ProactiveSettings = z.output<typeof ProactiveSettingsSchema>;
export type ProactiveSettingsInput = z.input<typeof ProactiveSettingsSchema>;

export const ProfileSchema = z.object({
  name: z.string().trim().max(60).default(''),
  sex: SexSchema,
  birthYear: z.number().int().min(1900).max(2100),
  heightCm: z.number().min(80).max(260),
  weightKg: z.number().min(25).max(400),
  activityLevel: ActivityLevelSchema,
  locale: LocaleSchema.default('fr'),
  timezone: z.string().max(64).default('Europe/Paris'),
  /** Opt-in: blood pressure shows up in insights and AI advice only when true. */
  trackBloodPressure: z.boolean().optional(),
  /** Opt-in life modules, off by default (see `life.ts`). */
  trackSleep: z.boolean().optional(),
  trackHydration: z.boolean().optional(),
  trackMood: z.boolean().optional(),
  /** The proactive coach; absent means off. */
  proactive: ProactiveSettingsSchema.optional(),
});
export type Profile = z.infer<typeof ProfileSchema>;

// ---------------------------------------------------------------- Physical activity

export const WorkoutTypeSchema = z.enum(['walking', 'running', 'cycling', 'strength', 'swimming', 'hiit', 'yoga', 'sports', 'other']);
export type WorkoutType = z.infer<typeof WorkoutTypeSchema>;

export const WorkoutIntensitySchema = z.enum(['light', 'moderate', 'vigorous']);
export type WorkoutIntensity = z.infer<typeof WorkoutIntensitySchema>;

export const WorkoutSourceSchema = z.enum(['healthkit', 'health_connect', 'manual']);

/** A workout session, from the watch (via the health store) or added by hand. */
export const WorkoutInputSchema = z.object({
  /** Health store identifier (HealthKit UUID, Health Connect id), used to deduplicate imports. */
  externalId: z.string().min(1).max(120).nullable().default(null),
  type: WorkoutTypeSchema,
  /** Device-local start time with offset. */
  startedAt: localDateTime,
  localDate: isoDate,
  durationMin: z.number().min(1).max(1440),
  intensity: WorkoutIntensitySchema.nullable().default(null),
  /** Measured by the watch, or estimated from METs for manual entries. */
  activeKcal: z.number().min(0).max(10_000).nullable().default(null),
  distanceKm: z.number().min(0).max(1000).nullable().default(null),
  avgHeartRate: z.number().min(30).max(250).nullable().default(null),
  source: WorkoutSourceSchema,
});
export type WorkoutInput = z.input<typeof WorkoutInputSchema>;

export const WorkoutsImportSchema = z.object({ workouts: z.array(WorkoutInputSchema).min(1).max(1000) });

export interface Workout extends z.output<typeof WorkoutInputSchema> {
  id: string;
  createdAt: string;
}

/** Simple, goal-dependent activity guardrails that live in the plan. */
export const ActivityGoalsSchema = z.object({
  /** WHO: at least 150 min of moderate activity a week. */
  weeklyActiveMinutes: z.number().int().min(0).max(3000),
  dailySteps: z.number().int().min(0).max(50_000).nullable(),
  weeklyStrengthSessions: z.number().int().min(0).max(14).nullable(),
});
export type ActivityGoals = z.infer<typeof ActivityGoalsSchema>;

/** Rolling 7 days ending on a given day. */
export interface ActivityWeek {
  /** Minutes of workouts that count as active (see `countsAsActive`). */
  activeMinutes: number;
  strengthSessions: number;
  workouts: number;
  /** Average daily steps over the days that have step data. */
  avgSteps: number | null;
  goals: ActivityGoals;
}

export interface InsightsActivity {
  goals: ActivityGoals;
  days: { date: string; activeMinutes: number; steps: number | null; workouts: number }[];
  byType: { type: WorkoutType; sessions: number; minutes: number }[];
  totalMinutes: number;
  /** Average active minutes per 7 days over the period. */
  weeklyMinutes: number;
  /** Cravings per day on days with vs without a workout (logged days only); null without enough data. */
  cravingsOnActiveDays: { active: number; inactive: number } | null;
}

// ---------------------------------------------------------------- Goals

export const GoalTagSchema = z.enum([
  'lose_weight',
  'gain_muscle',
  'maintain',
  'reduce_sugar',
  'eat_balanced',
  'more_protein',
  'more_fiber',
  'reduce_salt',
  'energy',
  'custom',
]);
export type GoalTag = z.infer<typeof GoalTagSchema>;

export const NutrientRuleSchema = z.object({
  nutrient: NutrientKeySchema,
  kind: z.enum(['max', 'min']),
  /** Daily amount, in the nutrient's unit (kcal, g or mg). */
  value: z.number().min(0),
  reason: z.string().max(240).default(''),
});
export type NutrientRule = z.infer<typeof NutrientRuleSchema>;

export const HabitSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(160),
  kind: z.enum(['avoid', 'do']),
});
export type Habit = z.infer<typeof HabitSchema>;

export const CalorieModeSchema = z.enum(['maintain', 'deficit', 'surplus']);

/**
 * A goal plan is the structured interpretation of what the user wants, in
 * their own words. The AI proposes the strategy; numbers are always derived
 * deterministically by `computeTargets`.
 */
export const GoalPlanSchema = z.object({
  intentions: z.string().max(2000),
  title: z.string().max(80),
  summary: z.string().max(500),
  tags: z.array(GoalTagSchema).max(5),
  calorieMode: CalorieModeSchema,
  /** Magnitude of the deficit / surplus, as % of maintenance energy. */
  caloriePercent: z.number().min(0).max(25),
  proteinPerKg: z.number().min(0.8).max(2.4),
  /** Share of energy coming from fat. */
  fatPercent: z.number().min(20).max(45),
  rules: z.array(NutrientRuleSchema).max(9),
  /** Nutrients shown first everywhere in the app. */
  focus: z.array(NutrientKeySchema).min(1).max(3),
  habits: z.array(HabitSchema).max(6),
  coachTone: z.enum(['gentle', 'direct', 'scientific']),
  /** Use watch / phone activity data to adapt the energy budget day by day. */
  adjustForActivity: z.boolean(),
  /** Manual target values set by the user; they win over everything else. */
  overrides: z.partialRecord(NutrientKeySchema, z.number().min(0)).default({}),
  /** Activity guardrails; null means the goal-based defaults (`activityGoalsFor`). */
  activity: ActivityGoalsSchema.nullable().default(null),
  /**
   * Opt-in: maintenance follows the expenditure measured from logged meals and the weight
   * trend (`estimateExpenditure`), from `since` on and by small weekly steps. Null or absent: off.
   */
  adaptiveEnergy: z.object({ since: isoDate }).nullable().optional(),
});
export type GoalPlan = z.infer<typeof GoalPlanSchema>;

export const TargetKindSchema = z.enum(['target', 'min', 'max']);
export type TargetKind = z.infer<typeof TargetKindSchema>;

export const TargetSchema = z.object({ value: z.number(), kind: TargetKindSchema });
export type Target = z.infer<typeof TargetSchema>;
export type Targets = Record<NutrientKey, Target>;

export interface EnergyBreakdown {
  bmr: number;
  /** Maintenance energy (total daily energy expenditure). */
  tdee: number;
  /** Where the maintenance estimate comes from. */
  source: 'profile' | 'activity';
  activeKcal: number | null;
  goalKcal: number;
  /** Added to the formula's maintenance from the measured expenditure (adaptive energy); 0 when off. */
  adaptiveKcal?: number;
}

// ---------------------------------------------------------------- Food & meals

export const FoodSourceSchema = z.enum(['ai', 'barcode', 'manual', 'library']);

export const FoodItemSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  emoji: z.string().max(16).default(''),
  /** Human description of the portion, e.g. "1 bowl", "2 slices". */
  portion: z.string().max(60).default(''),
  grams: z.number().min(0).max(5000),
  per100g: NutrientsSchema,
  source: FoodSourceSchema,
  /** 0..1, how sure the estimate is (AI only). */
  confidence: z.number().min(0).max(1).nullable().default(null),
  brand: z.string().max(80).nullable().default(null),
  barcode: z.string().max(32).nullable().default(null),
});
export type FoodItem = z.infer<typeof FoodItemSchema>;
export type FoodItemInput = z.input<typeof FoodItemSchema>;

export const MealTypeSchema = z.enum(['breakfast', 'lunch', 'dinner', 'snack']);
export type MealType = z.infer<typeof MealTypeSchema>;

export const VerdictSchema = z.enum(['great', 'good', 'ok', 'watch']);
export type Verdict = z.infer<typeof VerdictSchema>;

export const MealFlagSchema = z.object({
  nutrient: NutrientKeySchema,
  /** Share of the daily target / limit this meal represents (0..n). */
  share: z.number(),
  kind: TargetKindSchema,
});
export type MealFlag = z.infer<typeof MealFlagSchema>;

/** One quick question that would materially sharpen the estimate. */
export const ClarificationSchema = z.object({
  question: z.string().max(160),
  options: z.array(z.string().max(40)).min(2).max(4),
});
export type Clarification = z.infer<typeof ClarificationSchema>;

export const MealInsightSchema = z.object({
  verdict: VerdictSchema,
  headline: z.string().max(240),
  tips: z.array(z.string().max(240)).max(3),
  flags: z.array(MealFlagSchema).max(4),
  clarification: ClarificationSchema.nullable().default(null),
});
export type MealInsight = z.infer<typeof MealInsightSchema>;

export interface Meal {
  id: string;
  eatenAt: string;
  localDate: string;
  mealType: MealType;
  title: string;
  items: FoodItem[];
  photoId: string | null;
  note: string | null;
  insight: MealInsight | null;
  favorite: boolean;
  totals: Nutrients;
  createdAt: string;
  updatedAt: string;
}

export const CreateMealInputSchema = z
  .object({
    eatenAt: localDateTime,
    localDate: isoDate,
    mealType: MealTypeSchema.optional(),
    /** Free text: "un café avec deux sucres et un croissant". */
    text: z.string().trim().max(1000).optional(),
    /** JPEG, base64 encoded (no data: prefix). */
    photoBase64: z.string().max(12_000_000).optional(),
    /** Already-known items (barcode, library, manual entry). */
    items: z.array(FoodItemSchema).max(40).optional(),
    title: z.string().trim().max(120).optional(),
  })
  .refine((v) => Boolean(v.text || v.photoBase64 || v.items?.length), {
    message: 'A meal needs a photo, a description or items',
  });
export type CreateMealInput = z.input<typeof CreateMealInputSchema>;

export const UpdateMealInputSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  mealType: MealTypeSchema.optional(),
  eatenAt: localDateTime.optional(),
  localDate: isoDate.optional(),
  items: z.array(FoodItemSchema).max(40).optional(),
  favorite: z.boolean().optional(),
  note: z.string().max(1000).nullable().optional(),
});
export type UpdateMealInput = z.input<typeof UpdateMealInputSchema>;

export const RefineMealInputSchema = z.object({
  correction: z.string().trim().min(1).max(1000),
});

export const DuplicateMealInputSchema = z.object({
  eatenAt: localDateTime,
  localDate: isoDate,
  mealType: MealTypeSchema.optional(),
});

// ---------------------------------------------------------------- Activity (watch / phone)

export const ActivityInputSchema = z.object({
  localDate: isoDate,
  steps: z.number().int().min(0).max(200_000).nullable().default(null),
  activeKcal: z.number().min(0).max(10_000).nullable().default(null),
  restingKcal: z.number().min(0).max(10_000).nullable().default(null),
  weightKg: z.number().min(25).max(400).nullable().default(null),
  source: z.enum(['healthkit', 'health_connect', 'manual']),
});
export type ActivityInput = z.input<typeof ActivityInputSchema>;

export interface DayActivity {
  localDate: string;
  steps: number | null;
  activeKcal: number | null;
  restingKcal: number | null;
  weightKg: number | null;
  source: string;
  updatedAt: string;
}

// ---------------------------------------------------------------- Weight

export const WeightSourceSchema = z.enum(['healthkit', 'health_connect', 'manual']);

/** Body weight readings (from a connected scale via the health store, or typed in). */
export const WeightInputSchema = z.object({
  samples: z
    .array(
      z.object({
        /** ISO timestamp of the reading. */
        measuredAt: z.string().min(10).max(40),
        localDate: isoDate,
        kg: z.number().min(25).max(400),
      }),
    )
    .min(1)
    .max(2000),
  source: WeightSourceSchema,
});
export type WeightInput = z.input<typeof WeightInputSchema>;

export interface WeightPoint {
  date: string;
  kg: number;
}

export interface WeightTrend {
  /** One point per day with a reading, oldest first. */
  points: WeightPoint[];
  latest: WeightPoint | null;
  /** Difference between the average of the last 7 days and of the first 7 days of the window. */
  changeKg: number | null;
  windowDays: number;
}

// ---------------------------------------------------------------- Adaptive energy expenditure

export type ExpenditureConfidence = 'low' | 'medium' | 'high';

/** Why there is no estimate yet. */
export type ExpenditureReason = 'few_days' | 'few_complete_days' | 'few_weigh_ins' | 'weigh_ins_bunched';

/** Maintenance measured from logged meals and the weight trend (`estimateExpenditure`). */
export interface ExpenditureEstimate {
  /** kcal/day; null until the data is good enough (see `reasons`). */
  estimate: number | null;
  /** The formula's maintenance (Mifflin–St Jeor × activity) over the same days. */
  formula: number;
  /** estimate − formula. */
  difference: number | null;
  confidence: ExpenditureConfidence | null;
  /** The raw measure fell outside ±25 % of the formula or physiological bounds and was pulled back. */
  clamped: boolean;
  /** Ends the day before the date it is computed for: that day isn't over. */
  window: { from: string; to: string; days: number };
  data: {
    loggedDays: number;
    /** Days that look completely logged; only they count toward the intake. */
    completeDays: number;
    weighIns: number;
    /** Average over the complete days. */
    avgIntake: number | null;
    /** From the smoothed trend line, not raw weigh-ins. */
    trendChangeKg: number | null;
    trendKgPerWeek: number | null;
  };
  reasons: ExpenditureReason[];
  /** What's still needed: days of history, complete days, weigh-ins. */
  missing: { days: number; completeDays: number; weighIns: number };
}

/** The estimate as served, with the person's opt-in. */
export interface AdaptiveEnergy extends ExpenditureEstimate {
  /** Their budget follows the estimate (`plan.adaptiveEnergy`). */
  enabled: boolean;
  /** Shift applied today to the formula's maintenance (0 when off or not trusted yet). */
  appliedKcal: number;
  /** The applied shift moves by at most this much a week. */
  stepKcal: number;
}

// ---------------------------------------------------------------- Blood pressure (opt-in)

export const BloodPressureSourceSchema = z.enum(['healthkit', 'health_connect', 'manual']);
export type BloodPressureSource = z.infer<typeof BloodPressureSourceSchema>;

export const BloodPressureReadingInputSchema = z.object({
  /** Health store identifier (HealthKit UUID, Health Connect id), used to deduplicate imports. */
  externalId: z.string().min(1).max(120).nullable().default(null),
  measuredAt: localDateTime,
  localDate: isoDate,
  /** mmHg */
  systolic: z.number().min(60).max(260),
  diastolic: z.number().min(30).max(160),
  /** Beats per minute, when the cuff reports it. */
  pulse: z.number().min(30).max(220).nullable().default(null),
});
export type BloodPressureReadingInput = z.input<typeof BloodPressureReadingInputSchema>;

export const BloodPressureInputSchema = z.object({
  readings: z.array(BloodPressureReadingInputSchema).min(1).max(2000),
  source: BloodPressureSourceSchema,
});
export type BloodPressureInput = z.input<typeof BloodPressureInputSchema>;

export interface BloodPressureReading extends z.output<typeof BloodPressureReadingInputSchema> {
  id: string;
  source: BloodPressureSource;
  createdAt: string;
}

/** ESC/ESH 2018 office blood pressure categories, lowest first. */
export const BloodPressureCategorySchema = z.enum(['optimal', 'normal', 'high_normal', 'grade1', 'grade2', 'grade3']);
export type BloodPressureCategory = z.infer<typeof BloodPressureCategorySchema>;

export interface BloodPressureTrend {
  /** Daily averages over the window, oldest first. */
  points: { date: string; systolic: number; diastolic: number }[];
  /** Most recent reading in the window. */
  latest: BloodPressureReading | null;
  /** Average of the readings of the last 7 days of the window. */
  average7: { systolic: number; diastolic: number } | null;
  /** Category of `average7`, or of `latest` when the last 7 days have fewer than 3 readings. */
  category: BloodPressureCategory | null;
  windowDays: number;
}

// ---------------------------------------------------------------- Cravings

export const CravingInputSchema = z.object({
  at: localDateTime,
  localDate: isoDate,
  what: z.string().trim().min(1).max(200),
  intensity: z.number().int().min(1).max(3),
});
export type CravingInput = z.input<typeof CravingInputSchema>;

export const CravingOutcomeSchema = z.enum(['pending', 'resisted', 'gave_in']);
export type CravingOutcome = z.infer<typeof CravingOutcomeSchema>;

export interface Craving {
  id: string;
  at: string;
  localDate: string;
  what: string;
  intensity: number;
  outcome: CravingOutcome;
  tip: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------- Day & insights

export interface NutrientProgress {
  nutrient: NutrientKey;
  consumed: number;
  target: Target;
  /** consumed / target.value */
  ratio: number;
  status: 'under' | 'on_track' | 'reached' | 'over';
}

export interface DaySummary {
  date: string;
  targets: Targets;
  energy: EnergyBreakdown;
  totals: Nutrients;
  progress: NutrientProgress[];
  meals: Meal[];
  activity: DayActivity | null;
  workouts: Workout[];
  activityWeek: ActivityWeek;
  cravings: { total: number; resisted: number; items: Craving[] };
  streak: number;
  /** The night that ended this day; null unless sleep is tracked and recorded. */
  sleep?: SleepNight | null;
  /** Null unless hydration is tracked. */
  hydration?: DayHydration | null;
  /** The day's check-in; null when mood isn't tracked or nothing was checked in yet. */
  mood?: MoodCheckIn | null;
}

export interface FoodSuggestion {
  key: string;
  item: FoodItem;
  count: number;
  lastUsed: string;
}

export interface LibraryResponse {
  recentItems: FoodSuggestion[];
  favoriteMeals: Meal[];
}

export interface InsightsDay {
  date: string;
  logged: boolean;
  totals: Nutrients;
  kcalTarget: number;
  activeKcal: number | null;
  weightKg: number | null;
}

export interface NutrientSource {
  name: string;
  emoji: string;
  amount: number;
  count: number;
}

export interface InsightsResponse {
  from: string;
  to: string;
  days: InsightsDay[];
  loggedDays: number;
  averages: Nutrients;
  focus: NutrientKey[];
  adherence: { nutrient: NutrientKey; kind: TargetKind; target: number; daysOk: number; daysLogged: number }[];
  topSources: Partial<Record<NutrientKey, NutrientSource[]>>;
  /** For the primary focus nutrient: amount consumed per local hour (0..23). */
  byHour: { nutrient: NutrientKey; hours: number[] };
  cravings: { total: number; resisted: number; topWhat: string[] };
  weight: WeightTrend;
  activity: InsightsActivity;
  /** Null unless the person tracks blood pressure and has readings in the window. */
  bloodPressure?: BloodPressureTrend | null;
  /** Measured maintenance as of `to` (absent on older servers). */
  adaptiveEnergy?: AdaptiveEnergy;
  /** Opt-in modules: null unless tracked. Sleep and hydration follow the window, mood covers 30 days at least. */
  sleep?: SleepTrend | null;
  hydration?: HydrationTrend | null;
  mood?: MoodTrend | null;
  streak: number;
}

export const ReviewSchema = z.object({
  headline: z.string(),
  wins: z.array(z.string()),
  patterns: z.array(z.string()),
  nextSteps: z.array(z.string()),
});
export type Review = z.infer<typeof ReviewSchema>;

// ---------------------------------------------------------------- Coach

export interface CoachSuggestion {
  /** Updated intentions text to feed into the goal planner. */
  intentions: string;
  rationale: string;
}

export const CoachMealActionKindSchema = z.enum(['add', 'edit', 'delete']);
export type CoachMealActionKind = z.infer<typeof CoachMealActionKindSchema>;

/** A meal change the coach proposes when asked; nothing happens until the person confirms it. */
export interface CoachMealProposal {
  action: CoachMealActionKind;
  /** The meal to edit or delete; null for add. */
  mealId: string | null;
  /** add: what was eaten, in their words. edit: the correction ("" when only the type, date or time changes). delete: "". */
  description: string;
  mealType: MealType | null;
  /** add: the day it was eaten (the conversation's day by default). edit: the new day, or null to keep it. */
  localDate: string | null;
  /** Local "HH:mm"; null for now (add) or to keep it (edit). */
  time: string | null;
  /** One short line shown on the card. */
  summary: string;
}

export interface CoachMealAction extends CoachMealProposal {
  status: 'proposed' | 'applied' | 'dismissed';
  /** The meal created or edited once applied. */
  resultMealId: string | null;
}

/** Messages the coach writes on its own (proactive coach). */
export type CoachMessageKind = 'morning';

export interface CoachMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** A plan change, applied from the goals screen. */
  suggestion: CoachSuggestion | null;
  mealActions: CoachMealAction[];
  /** Set on proactive messages (« Point du matin »); null or absent on the conversation's turns. */
  kind?: CoachMessageKind | null;
  /** The day a proactive message is about. */
  localDate?: string | null;
  createdAt: string;
}

export const CoachInputSchema = z.object({
  text: z.string().trim().min(1).max(2000),
  localDate: isoDate,
});

export const ApplyCoachMealActionInputSchema = z.object({
  /** The device's current local time: sets the time zone, and the time when the action has none. */
  now: localDateTime.optional(),
});

export interface CoachMealActionResult {
  message: CoachMessage;
  /** The meal added or edited; null for a delete. */
  meal: Meal | null;
}

// ---------------------------------------------------------------- Auth & server

export const CredentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(8).max(200),
  name: z.string().trim().max(60).optional(),
});
export type Credentials = z.input<typeof CredentialsSchema>;

export interface User {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  profile: Profile | null;
  plan: GoalPlan | null;
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface ServerInfo {
  name: 'symbiose';
  version: string;
  ai: { enabled: boolean; model: string | null };
  signupOpen: boolean;
  hasUsers: boolean;
}

export interface GoalsResponse {
  plan: GoalPlan | null;
  targets: Targets | null;
  energy: EnergyBreakdown | null;
  /** GET only: measured maintenance as of the requested day. */
  adaptiveEnergy?: AdaptiveEnergy | null;
}

export const GoalDraftInputSchema = z.object({
  intentions: z.string().trim().min(2).max(2000),
});

export interface ApiErrorBody {
  error: { code: string; message: string };
}
