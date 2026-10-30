import type {
  DaySummary,
  FoodItem,
  GoalPlan,
  InsightsResponse,
  Locale,
  MealType,
  Nutrients,
  Profile,
  Review,
  Targets,
  Verdict,
  WeightTrend,
} from '@symbiose/shared';

/** What the AI knows about the person when it reasons about a meal. */
export interface UserContext {
  locale: Locale;
  profile: Profile | null;
  plan: GoalPlan | null;
  targets: Targets | null;
}

export interface MealAnalysisInput extends UserContext {
  photo: { base64: string; mime: 'image/jpeg' | 'image/png' | 'image/webp' } | null;
  text: string | null;
  localTime: string;
  mealTypeHint: MealType;
  /** What was already eaten today before this meal. */
  dayTotalsBefore: Nutrients;
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
}

export type PlanDraft = Omit<GoalPlan, 'intentions' | 'overrides'>;

export interface CoachTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface CoachInput extends UserContext {
  history: CoachTurn[];
  message: string;
  today: Pick<DaySummary, 'date' | 'totals' | 'progress' | 'activity'> & { meals: { time: string; title: string; kcal: number }[] };
  week: Pick<InsightsResponse, 'averages' | 'loggedDays' | 'adherence' | 'topSources' | 'byHour' | 'cravings' | 'weight'>;
}

export interface CoachOutput {
  reply: string;
  planChange: { intentions: string; rationale: string } | null;
}

export interface CravingInput extends UserContext {
  what: string;
  intensity: number;
  localTime: string;
}

export interface CravingOutput {
  tip: string;
  alternative: string;
}

export interface ReviewInput extends UserContext {
  insights: InsightsResponse;
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
}
