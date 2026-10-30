import type {
  ActivityWeek,
  BloodPressureCategory,
  CoachMealProposal,
  DaySummary,
  ExpenditureConfidence,
  FoodItem,
  GoalPlan,
  InsightsResponse,
  JournalKind,
  Locale,
  MealType,
  MoodLink,
  NutrientKey,
  Nutrients,
  ProactiveConfidence,
  Profile,
  RecoveryReason,
  RecoveryStatus,
  Review,
  StoolConsistency,
  TargetKind,
  Targets,
  TransitEase,
  TransitSummary,
  Verdict,
  WeightTrend,
  WorkoutType,
} from '@symbiose/shared';

/** What the AI knows about the person when it reasons about a meal. */
export interface UserContext {
  locale: Locale;
  profile: Profile | null;
  plan: GoalPlan | null;
  targets: Targets | null;
}

/** Blood pressure, only for people who opted in and have recent readings. */
export interface BloodPressureBrief {
  average7: { systolic: number; diastolic: number } | null;
  category: BloodPressureCategory | null;
  latest: { date: string; systolic: number; diastolic: number; pulse: number | null };
  /** Readings over the last 30 days. */
  readings: number;
  /** Readings at or above 180/110 over the last 7 days. */
  severeLast7Days: number;
}

/** Maintenance measured from logged meals and the weight trend; present once estimated, or when the person opted in. */
export interface EnergyExpenditureBrief {
  /** kcal/day; null until there is enough data (`missing` says what's needed). */
  estimateKcal: number | null;
  /** The formula's maintenance over the same days. */
  formulaKcal: number;
  confidence: ExpenditureConfidence | null;
  windowDays: number;
  completeDays: number;
  weighIns: number;
  trendKgPerWeek: number | null;
  /** Their budget follows the estimate, by at most 100 kcal a week. */
  autoAdjust: boolean;
  /** Shift applied to today's maintenance so far. */
  appliedKcal: number;
  missing?: { days: number; completeDays: number; weighIns: number };
}

/** One note of the health journal, compact: structured fields when given, the words cut short. */
export interface JournalNoteBrief {
  date: string;
  time: string;
  kind: JournalKind;
  consistency?: StoolConsistency;
  /** Bristol stool type, 1–7. */
  bristol?: number;
  ease?: TransitEase;
  /** 1 (very low) to 5 (very good). */
  feeling?: number;
  text?: string;
}

/** The health journal over a few days, for the coach and the review; null when empty. */
export interface JournalBrief {
  /** Oldest first; past an overall size cap, the oldest are left out. */
  entries: JournalNoteBrief[];
  /** Notes left out by the cap. */
  omitted: number;
  /** Bowel movements over the same days (or since tracking started); null when none is tracked. */
  transit: Omit<TransitSummary, 'counts' | 'to'> | null;
}

/**
 * Sleep, hydration and mood, for the modules the person turned on: a key is
 * absent when its module is off, so the AI never hears about it.
 */
export interface LifeBrief {
  sleep?: {
    /** The night that ended on the day of the request. */
    lastNight: { date: string; asleepMin: number; bedtime: string; wakeTime: string } | null;
    average7Min: number | null;
    nights7: number;
    /** Nights under 7 h over the last 7. */
    shortNights7: number;
    /** Cravings per day after short nights vs the others, over 30 days. */
    cravingsAfterShortNights: { short: number; normal: number } | null;
  };
  hydration?: {
    todayMl: number;
    goalMl: number;
    /** Over the 7 days before today, days with drinks only. */
    average7Ml: number | null;
    daysReached7: number;
  };
  mood?: {
    /** Check-in from 1 (very low) to 5 (very good). */
    today: { mood: number; note: string | null; time: string } | null;
    last7: { date: string; mood: number }[];
    average7: number | null;
    /** Very low moods that last: the only case where talking to someone is suggested. */
    persistentLow: boolean;
    link: MoodLink | null;
  };
}

/** Last night's vitals against the person's own baseline; only when reliable. */
export interface RecoveryBrief {
  status: RecoveryStatus;
  confidence: ProactiveConfidence;
  /** What moved: hrv_below, rhr_above, short_night. */
  reasons: RecoveryReason[];
}

/** Movement so far on a given day. */
export interface ActivityToday {
  steps: number | null;
  /** The watch's daily total, else the logged workouts' energy. */
  activeKcal: number | null;
  workouts: number;
}

export interface MealAnalysisInput extends UserContext {
  photo: { base64: string; mime: 'image/jpeg' | 'image/png' | 'image/webp' } | null;
  text: string | null;
  localTime: string;
  mealTypeHint: MealType;
  /** What was already eaten today before this meal. */
  dayTotalsBefore: Nutrients;
  /** The workout that ended in the 3 hours before the meal. */
  recentWorkout: { type: WorkoutType; durationMin: number; activeKcal: number | null; endedMinutesAgo: number } | null;
  activityToday: ActivityToday | null;
  bloodPressureCategory: BloodPressureCategory | null;
  /** For refinements: the previous analysis and the user's correction. */
  previous?: { title: string; items: FoodItem[] };
  correction?: string;
}

export interface AnalyzedItem {
  name: string;
  emoji: string;
  portion: string;
  grams: number;
  confidence: number;
  per100g: Nutrients;
}

export interface MealAnalysis {
  isFood: boolean;
  title: string;
  mealType: MealType;
  items: AnalyzedItem[];
  verdict: Verdict;
  headline: string;
  tips: string[];
  clarification: { question: string; options: string[] } | null;
}

export interface PlanDraftInput {
  locale: Locale;
  profile: Profile;
  intentions: string;
  previousPlan: GoalPlan | null;
  weight: WeightTrend;
  bloodPressure: BloodPressureBrief | null;
}

export type PlanDraft = Omit<GoalPlan, 'intentions' | 'overrides'>;

export interface CoachTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface CoachInput extends UserContext {
  history: CoachTurn[];
  message: string;
  bloodPressure: BloodPressureBrief | null;
  energyExpenditure: EnergyExpenditureBrief | null;
  life: LifeBrief;
  /** Health journal notes of the last 14 days. */
  journal: JournalBrief | null;
  /** Last night's vitals, when the morning check-in imports them and there is enough history. */
  recovery: RecoveryBrief | null;
  today: Pick<DaySummary, 'date' | 'totals' | 'progress' | 'activity'> & {
    workouts: { time: string; type: WorkoutType; minutes: number; kcal: number | null }[];
  };
  /** Meals of the conversation's day and the 2 days before: the ones the coach may edit or delete. */
  recentMeals: CoachMealBrief[];
  week: Pick<InsightsResponse, 'averages' | 'loggedDays' | 'adherence' | 'topSources' | 'byHour' | 'cravings' | 'weight'> & {
    activity: ActivityWeek;
    workouts: { date: string; type: WorkoutType; minutes: number; kcal: number | null }[];
  };
}

/** A logged meal as the coach sees it: kcal plus the nutrients the plan focuses on. */
export type CoachMealBrief = { id: string; date: string; time: string; type: MealType; title: string; kcal: number } & Partial<Record<NutrientKey, number>>;

export interface CoachOutput {
  reply: string;
  planChange: { intentions: string; rationale: string } | null;
  /** Unchecked: the route keeps only the valid ones (known meal ids, at most 5). */
  mealActions: CoachMealProposal[];
}

export interface CravingInput extends UserContext {
  what: string;
  intensity: number;
  localTime: string;
  activityToday: ActivityToday | null;
  life: LifeBrief;
}

export interface CravingOutput {
  tip: string;
  alternative: string;
}

export interface ReviewInput extends UserContext {
  insights: InsightsResponse;
  bloodPressure: BloodPressureBrief | null;
  energyExpenditure: EnergyExpenditureBrief | null;
  /** Health journal notes of the period. */
  journal: JournalBrief | null;
}

/** What the morning check-in (« Point du matin ») is written from. */
export interface MorningInput extends UserContext {
  date: string;
  /** In English, e.g. "Monday". */
  weekday: string;
  sleepTracked: boolean;
  /** Last night against their usual; null when sleep isn't tracked or the night isn't in yet. */
  night: {
    asleepMin: number;
    bedtime: string;
    wakeTime: string;
    /** Median over the 14 nights before; null with fewer than 5. */
    usualAsleepMin: number | null;
  } | null;
  recovery: RecoveryBrief | null;
  /** Their own cravings per day after short nights vs the others (30 days), when known. */
  cravingsAfterShortNights: { short: number; normal: number } | null;
  yesterday: {
    date: string;
    meals: number;
    /** Their hero metric (the one Today shows first) against its target. */
    hero: { nutrient: NutrientKey; consumed: number; target: number; kind: TargetKind } | null;
    cravings: { total: number; resisted: number; what: string[] };
  };
  /** Their usual sugar-craving slot, local "HH:MM". */
  cravingWindow: { start: string; end: string } | null;
}

/** What the week's one-line craving nudges are written from. */
export interface NudgesInput extends UserContext {
  cravingWindow: { start: string; end: string; source: 'cravings' | 'sugar' };
  /** What they crave most over the last 28 days. */
  topCravings: string[];
}

export interface Ai {
  readonly enabled: boolean;
  readonly model: string | null;
  analyzeMeal(input: MealAnalysisInput): Promise<MealAnalysis>;
  draftPlan(input: PlanDraftInput): Promise<PlanDraft>;
  /** Streams the reply text through `onText` as it is written. */
  coach(input: CoachInput, onText?: (delta: string) => void): Promise<CoachOutput>;
  cravingTip(input: CravingInput): Promise<CravingOutput>;
  review(input: ReviewInput): Promise<Review>;
  /** The morning check-in, 3 to 5 short lines, streamed through `onText`. */
  morning(input: MorningInput, onText?: (delta: string) => void): Promise<{ text: string }>;
  /** 5 to 7 one-line nudges for the craving heads-up, written once a week. */
  cravingNudges(input: NudgesInput): Promise<{ lines: string[] }>;
}
