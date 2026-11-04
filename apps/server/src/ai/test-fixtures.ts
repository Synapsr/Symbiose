import type { GoalPlan, InsightsResponse, Nutrients, Profile, Targets } from '@symbiose/shared';

import type { CoachInput, CravingInput, MealAnalysisInput, MorningInput, NudgesInput, PlanDraftInput, ReviewInput, UserContext } from './types';

/** Inputs for the AI adapters' tests: every feature, with enough context to show what each one sends. */

const nutrients = (kcal: number): Nutrients => ({ kcal, protein: 20, carbs: 50, sugar: 12, addedSugar: 6, fat: 15, satFat: 5, fiber: 6, sodium: 700 });

const profile: Profile = { name: 'Léa', sex: 'female', birthYear: 1990, heightCm: 168, weightKg: 62, activityLevel: 'moderate', locale: 'fr', timezone: 'Europe/Paris' };

const plan: GoalPlan = {
  intentions: 'Moins de sucre l’après-midi',
  title: 'Moins de sucre',
  summary: 'Moins de 25 g de sucres ajoutés par jour.',
  tags: ['reduce_sugar'],
  calorieMode: 'maintain',
  caloriePercent: 0,
  proteinPerKg: 1.2,
  fatPercent: 30,
  rules: [{ nutrient: 'addedSugar', kind: 'max', value: 25, reason: 'OMS' }],
  focus: ['addedSugar'],
  habits: [{ id: 'h1', label: 'Un fruit à 16 h', kind: 'do' }],
  coachTone: 'gentle',
  adjustForActivity: false,
  overrides: {},
  activity: null,
} as GoalPlan;

const targets = { kcal: { value: 2000, kind: 'target' }, addedSugar: { value: 25, kind: 'max' } } as unknown as Targets;

export const context: UserContext = { locale: 'fr', profile, plan, targets };

export const mealInput: MealAnalysisInput = {
  ...context,
  photos: [{ base64: 'aGVsbG8=', mime: 'image/jpeg' }],
  text: 'Pâtes carbonara et un coca',
  localTime: '12:30',
  mealTypeHint: 'lunch',
  dayTotalsBefore: nutrients(450),
  recentWorkout: null,
  activityToday: { steps: 4200, activeKcal: 180, workouts: 0 },
  bloodPressureCategory: null,
};

export const mealOutput = {
  isFood: true,
  reusedMeal: null,
  title: 'Pâtes carbonara',
  mealType: 'lunch',
  courses: [],
  items: [{ name: 'Pâtes carbonara', emoji: '🍝', portion: '1 assiette', grams: 320, confidence: 0.7, per100g: nutrients(190), course: 1 }],
  verdict: 'ok',
  headline: 'Assez riche, pense aux légumes ce soir.',
  tips: ['Ajoute une salade.'],
  clarification: null,
};

const food = (name: string, grams: number, kcal: number) => ({ id: name, name, emoji: '', portion: '', grams, per100g: nutrients(kcal), source: 'ai' as const, confidence: 0.8, brand: null, barcode: null });

/** A correction of a meal in three courses, with words that refer to yesterday: each photo labelled, every course, the last days' meals. */
export const mealCorrectionInput: MealAnalysisInput = {
  ...mealInput,
  photos: [
    { base64: 'aGVsbG8=', mime: 'image/jpeg', course: 1 },
    { base64: 'd29ybGQ=', mime: 'image/jpeg', course: 3 },
  ],
  text: null,
  previous: {
    title: 'Salade, gratin et tarte',
    items: [],
    courses: [
      { course: 1, label: 'Entrée', time: '12:30', text: null, items: [food('Salade verte', 80, 20)] },
      { course: 2, label: 'Plat', time: '12:50', text: 'le gratin', items: [food('Gratin dauphinois', 300, 145)] },
      { course: 3, label: 'Dessert', time: '13:10', text: null, items: [food('Tarte aux pommes', 120, 255)] },
    ],
  },
  correction: 'le gratin c’était le reste d’hier soir, et le dessert une demi-part',
  history: {
    today: 'Sat 2026-10-31',
    meals: [{ ref: 'h1', when: 'Fri 2026-10-30 19:45', type: 'dinner', title: 'Gratin et salade', items: 'Gratin dauphinois 350 g · Salade verte 80 g' }],
  },
};

/** A course joining a meal: the courses before it, its own words. */
export const courseInput: MealAnalysisInput = {
  ...mealInput,
  photos: [],
  text: 'une tarte aux pommes',
  meal: { title: 'Salade et gratin', courses: [{ course: 1, label: 'Entrée', time: '12:30', items: 'Salade verte 80 g', nutrients: nutrients(16) }] },
};

export const planInput: PlanDraftInput = {
  locale: 'fr',
  profile,
  intentions: 'Je veux perdre 3 kg sans frustration',
  previousPlan: plan,
  weight: { latest: { date: '2026-10-30', kg: 62 }, changeKg: -0.8, points: [{ date: '2026-10-30', kg: 62 }] } as unknown as PlanDraftInput['weight'],
  bloodPressure: null,
};

export const planOutput = {
  title: 'Perdre 3 kg en douceur',
  summary: 'Un léger déficit.',
  tags: ['lose_weight'],
  calorieMode: 'deficit',
  caloriePercent: 12,
  proteinPerKg: 1.6,
  fatPercent: 30,
  rules: [],
  focus: ['kcal'],
  habits: [],
  coachTone: 'gentle',
  adjustForActivity: true,
  activity: { weeklyActiveMinutes: 150, dailySteps: 8000, weeklyStrengthSessions: 2 },
  carbsPerMeal: null,
};

export const coachInput: CoachInput = {
  ...context,
  history: [
    { role: 'user', content: 'Salut' },
    { role: 'assistant', content: 'Salut Léa !' },
  ],
  message: 'Ajoute un yaourt à 16 h',
  bloodPressure: null,
  energyExpenditure: null,
  life: {},
  journal: null,
  recovery: null,
  today: { date: '2026-10-31', totals: nutrients(900), progress: {}, activity: null, workouts: [] } as unknown as CoachInput['today'],
  recentMeals: [{ id: 'meal-1', date: '2026-10-31', time: '12:30', type: 'lunch', title: 'Pâtes', kcal: 610, addedSugar: 4 }],
  week: { averages: nutrients(1800), loggedDays: 5 } as unknown as CoachInput['week'],
};

export const cravingInput: CravingInput = {
  ...context,
  what: 'chocolat',
  intensity: 2,
  localTime: '16:10',
  activityToday: null,
  life: {},
};

export const reviewInput: ReviewInput = {
  ...context,
  insights: {
    from: '2026-10-25',
    to: '2026-10-31',
    focus: ['addedSugar'],
    loggedDays: 6,
    averages: nutrients(1850),
    days: [{ date: '2026-10-31', logged: true, totals: nutrients(1900), kcalTarget: 2000 }],
    activity: { days: [{ date: '2026-10-31', activeMinutes: 40, steps: 9000, workouts: 1 }], averageSteps: 9000 },
    bloodPressure: null,
    adaptiveEnergy: null,
    sleep: null,
    hydration: null,
    mood: null,
  } as unknown as InsightsResponse,
  bloodPressure: null,
  energyExpenditure: null,
  journal: null,
};

export const reviewOutput = { headline: '6 jours notés.', wins: ['Régulier'], patterns: ['Sucre à 16 h'], nextSteps: ['Un fruit à 16 h'] };

export const morningInput: MorningInput = {
  ...context,
  date: '2026-10-31',
  weekday: 'Saturday',
  sleepTracked: true,
  night: { asleepMin: 380, bedtime: '00:10', wakeTime: '06:30', usualAsleepMin: 450 },
  recovery: null,
  cravingsAfterShortNights: { short: 1.5, normal: 0.6 },
  yesterday: { date: '2026-10-30', meals: 3, hero: { nutrient: 'addedSugar', consumed: 30, target: 25, kind: 'max' }, cravings: { total: 1, resisted: 1, what: ['chocolat'] } },
  cravingWindow: { start: '16:00', end: '17:00' },
};

export const nudgesInput: NudgesInput = {
  ...context,
  cravingWindow: { start: '16:00', end: '17:00', source: 'cravings' },
  topCravings: ['chocolat', 'biscuits'],
};
