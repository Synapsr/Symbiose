import type { JournalEntry, TransitSummary } from './journal';
import type { HydrationTrend, MoodTrend, SleepTrend } from './life';
import type { Nutrients } from './nutrients';
import type {
  ActivityGoals,
  ActivityLevel,
  BloodPressureReading,
  CravingOutcome,
  GoalPlan,
  MealType,
  Sex,
  Targets,
  WeightPoint,
  Workout,
} from './schemas';

/**
 * The PDF report (« Exporter », from Tendances): everything one period holds,
 * assembled by `GET /api/report` and drawn into pages on the phone. Factual
 * data only: no AI prose, no streaks.
 */

/** Longest period a report covers: a year, and a day for leap years. */
export const REPORT_MAX_DAYS = 366;

/** Weigh-ins before the period that start the weight trend, so its first days aren't one raw reading. */
export const REPORT_WEIGHT_LEAD_DAYS = 28;

export interface ReportPerson {
  name: string;
  sex: Sex;
  /** Age in the year the period ends. */
  age: number;
  heightCm: number;
  /** The profile's weight: the latest weigh-in, or what was typed in. */
  weightKg: number;
  activityLevel: ActivityLevel;
}

export interface ReportDay {
  date: string;
  /** At least one meal noted. */
  logged: boolean;
  meals: number;
  totals: Nutrients;
  /** That day's targets (energy follows the day's activity when the plan says so). */
  targets: Targets;
}

/** A food of a meal: its name, its edible grams and what they hold. */
export interface ReportFood {
  name: string;
  grams: number;
  nutrients: Nutrients;
}

export interface ReportMeal {
  localDate: string;
  /** Local "HH:MM" of its first course. */
  time: string;
  mealType: MealType;
  title: string;
  /** Every course's foods, in order. */
  items: ReportFood[];
  totals: Nutrients;
}

export interface ReportDayActivity {
  date: string;
  /** Minutes of workouts that count as active (see `countsAsActive`). */
  activeMinutes: number;
  /** As `daySteps` counts them; null without step data. */
  steps: number | null;
}

export interface ReportCraving {
  localDate: string;
  /** Local "HH:MM". */
  time: string;
  /** Empty when not said. */
  what: string;
  intensity: number | null;
  outcome: CravingOutcome;
}

export interface ReportData {
  from: string;
  to: string;
  generatedAt: string;
  person: ReportPerson;
  plan: GoalPlan | null;
  /** The targets as of `to`. */
  targets: Targets;
  /** Every day of the period, oldest first. */
  days: ReportDay[];
  /** Oldest first. */
  meals: ReportMeal[];
  /** Weigh-ins from `REPORT_WEIGHT_LEAD_DAYS` before `from` to `to`, oldest first. */
  weights: WeightPoint[];
  /** Null unless blood pressure is tracked; oldest first. */
  bloodPressure: BloodPressureReading[] | null;
  activity: { goals: ActivityGoals; days: ReportDayActivity[] };
  /** Oldest first. */
  workouts: Workout[];
  /** Null unless the module is on. */
  sleep: SleepTrend | null;
  hydration: HydrationTrend | null;
  /** There when the Humeur module is on, and whenever a mood was logged. */
  mood: MoodTrend | null;
  /** Oldest first. */
  cravings: ReportCraving[];
  /** The health journal's notes, oldest first, without the older « Ressenti » notes already read as a day's mood. */
  journal: JournalEntry[];
  /** Bowel movements over the period; null when none is noted. */
  transit: TransitSummary | null;
}
