import {
  BiologicalSex,
  getBiologicalSexAsync,
  getDateOfBirthAsync,
  getMostRecentQuantitySample,
  isHealthDataAvailableAsync,
  queryQuantitySamples,
  queryStatisticsForQuantity,
  queryWorkoutSamples,
  requestAuthorization,
  saveQuantitySample,
  WorkoutActivityType,
  type WorkoutProxyTyped,
} from '@kingstinct/react-native-healthkit';
import type { Meal, Sex, WorkoutInput, WorkoutType } from '@symbiose/shared';

import { cleanProfile, dayBounds, mealWindow, toWorkoutInput, type HealthBridge } from './types';

const READ = [
  'HKQuantityTypeIdentifierStepCount',
  'HKQuantityTypeIdentifierActiveEnergyBurned',
  'HKQuantityTypeIdentifierBasalEnergyBurned',
  'HKQuantityTypeIdentifierBodyMass',
  'HKQuantityTypeIdentifierHeight',
  'HKCharacteristicTypeIdentifierBiologicalSex',
  'HKCharacteristicTypeIdentifierDateOfBirth',
  'HKWorkoutTypeIdentifier',
] as const;

const WRITE = [
  'HKQuantityTypeIdentifierDietaryEnergyConsumed',
  'HKQuantityTypeIdentifierDietaryProtein',
  'HKQuantityTypeIdentifierDietaryCarbohydrates',
  'HKQuantityTypeIdentifierDietarySugar',
  'HKQuantityTypeIdentifierDietaryFatTotal',
  'HKQuantityTypeIdentifierDietaryFatSaturated',
  'HKQuantityTypeIdentifierDietaryFiber',
  'HKQuantityTypeIdentifierDietarySodium',
] as const;

const SEX: Partial<Record<BiologicalSex, Sex>> = {
  [BiologicalSex.female]: 'female',
  [BiologicalSex.male]: 'male',
  [BiologicalSex.other]: 'other',
};

/** HKWorkoutActivityType → our nine simple types. Anything unlisted is "other". */
const T = WorkoutActivityType;
const TYPES: [WorkoutType, WorkoutActivityType[]][] = [
  ['walking', [T.walking, T.hiking, T.wheelchairWalkPace]],
  ['running', [T.running, T.wheelchairRunPace, T.trackAndField]],
  ['cycling', [T.cycling, T.handCycling]],
  ['strength', [T.traditionalStrengthTraining, T.functionalStrengthTraining, T.coreTraining, T.crossTraining]],
  ['swimming', [T.swimming, T.waterFitness, T.swimBikeRun]],
  ['hiit', [T.highIntensityIntervalTraining, T.mixedCardio, T.mixedMetabolicCardioTraining, T.jumpRope, T.kickboxing, T.stepTraining]],
  ['yoga', [T.yoga, T.pilates, T.mindAndBody, T.flexibility, T.taiChi, T.barre, T.cooldown, T.preparationAndRecovery]],
  [
    'sports',
    [
      T.soccer, T.basketball, T.tennis, T.badminton, T.volleyball, T.rugby, T.handball, T.hockey, T.americanFootball,
      T.australianFootball, T.baseball, T.softball, T.cricket, T.squash, T.racquetball, T.tableTennis, T.pickleball,
      T.golf, T.lacrosse, T.martialArts, T.boxing, T.wrestling, T.fencing, T.climbing, T.discSports, T.waterPolo,
      T.skatingSports, T.snowSports, T.downhillSkiing, T.crossCountrySkiing, T.snowboarding, T.surfingSports,
      T.paddleSports, T.rowing, T.sailing, T.equestrianSports,
    ],
  ],
];
const TYPE_BY_ACTIVITY = new Map<WorkoutActivityType, WorkoutType>(TYPES.flatMap(([type, list]) => list.map((a) => [a, type] as const)));

async function sum(identifier: 'HKQuantityTypeIdentifierStepCount' | 'HKQuantityTypeIdentifierActiveEnergyBurned' | 'HKQuantityTypeIdentifierBasalEnergyBurned', day: Date) {
  const { start, end } = dayBounds(day);
  const unit = identifier === 'HKQuantityTypeIdentifierStepCount' ? 'count' : 'kcal';
  const result = await queryStatisticsForQuantity(identifier, ['cumulativeSum'], {
    filter: { date: { startDate: start, endDate: end } },
    unit,
  });
  const value = result.sumQuantity?.quantity;
  return typeof value === 'number' ? Math.round(value) : null;
}

/** `totalEnergyBurned` is deprecated since iOS 18; newer workouts may only carry it as a statistic. */
async function workoutKcal(workout: WorkoutProxyTyped): Promise<number | null> {
  const total = workout.totalEnergyBurned?.quantity;
  if (typeof total === 'number' && total > 0) return total;
  const stat = await workout.getStatistic('HKQuantityTypeIdentifierActiveEnergyBurned', 'kcal').catch(() => undefined);
  return stat?.sumQuantity?.quantity ?? null;
}

export const health: HealthBridge = {
  source: 'healthkit',
  storeName: 'Apple Santé',

  isAvailable: () => isHealthDataAvailableAsync(),

  async connect() {
    return requestAuthorization({ toRead: READ, toShare: WRITE });
  },

  async readDay(day) {
    const [steps, activeKcal, restingKcal, weight] = await Promise.all([
      sum('HKQuantityTypeIdentifierStepCount', day).catch(() => null),
      sum('HKQuantityTypeIdentifierActiveEnergyBurned', day).catch(() => null),
      sum('HKQuantityTypeIdentifierBasalEnergyBurned', day).catch(() => null),
      getMostRecentQuantitySample('HKQuantityTypeIdentifierBodyMass', 'kg').catch(() => undefined),
    ]);
    return { steps, activeKcal, restingKcal, weightKg: weight?.quantity ?? null };
  },

  async readWeights(from, to) {
    const samples = await queryQuantitySamples('HKQuantityTypeIdentifierBodyMass', {
      filter: { date: { startDate: from, endDate: to } },
      ascending: true,
      limit: 0,
      unit: 'kg',
    });
    return samples.map((sample) => ({ measuredAt: sample.startDate, kg: sample.quantity }));
  },

  async readProfile() {
    // Each read fails on its own when the person declined that type: keep whatever we can get.
    const [sex, birthDate, height, weight] = await Promise.all([
      getBiologicalSexAsync().catch(() => BiologicalSex.notSet),
      getDateOfBirthAsync().catch(() => undefined),
      getMostRecentQuantitySample('HKQuantityTypeIdentifierHeight', 'cm').catch(() => undefined),
      getMostRecentQuantitySample('HKQuantityTypeIdentifierBodyMass', 'kg').catch(() => undefined),
    ]);
    return cleanProfile({ sex: SEX[sex], birthDate, heightCm: height?.quantity, weightKg: weight?.quantity });
  },

  async readWorkouts(from, to) {
    const workouts = await queryWorkoutSamples({
      filter: { date: { startDate: from, endDate: to } },
      limit: 0,
      ascending: true,
    });
    const inputs = await Promise.all(
      workouts.map(async (workout): Promise<WorkoutInput | null> =>
        toWorkoutInput({
          externalId: workout.uuid,
          type: TYPE_BY_ACTIVITY.get(workout.workoutActivityType) ?? 'other',
          start: workout.startDate,
          durationSec: workout.duration.quantity,
          activeKcal: await workoutKcal(workout),
          distanceM: workout.totalDistance?.quantity ?? null,
          source: 'healthkit',
        }),
      ),
    );
    return inputs.filter((w): w is WorkoutInput => w !== null);
  },

  async writeMeal(meal: Meal) {
    const { start, end } = mealWindow(meal);
    const t = meal.totals;
    const metadata = { HKFoodType: meal.title };
    await Promise.all([
      saveQuantitySample('HKQuantityTypeIdentifierDietaryEnergyConsumed', 'kcal', t.kcal, start, end, metadata),
      saveQuantitySample('HKQuantityTypeIdentifierDietaryProtein', 'g', t.protein, start, end, metadata),
      saveQuantitySample('HKQuantityTypeIdentifierDietaryCarbohydrates', 'g', t.carbs, start, end, metadata),
      saveQuantitySample('HKQuantityTypeIdentifierDietarySugar', 'g', t.sugar, start, end, metadata),
      saveQuantitySample('HKQuantityTypeIdentifierDietaryFatTotal', 'g', t.fat, start, end, metadata),
      saveQuantitySample('HKQuantityTypeIdentifierDietaryFatSaturated', 'g', t.satFat, start, end, metadata),
      saveQuantitySample('HKQuantityTypeIdentifierDietaryFiber', 'g', t.fiber, start, end, metadata),
      saveQuantitySample('HKQuantityTypeIdentifierDietarySodium', 'mg', t.sodium, start, end, metadata),
    ]);
  },
};

export { HEALTH_SCOPES } from './types';
export type { DayHealth, HealthBridge, HealthProfile, WeightReading } from './types';
