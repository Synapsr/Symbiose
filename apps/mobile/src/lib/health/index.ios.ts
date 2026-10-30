import {
  BiologicalSex,
  getBiologicalSexAsync,
  getDateOfBirthAsync,
  getMostRecentQuantitySample,
  isHealthDataAvailableAsync,
  queryCorrelationSamples,
  queryQuantitySamples,
  queryStatisticsForQuantity,
  queryWorkoutSamples,
  requestAuthorization,
  saveCorrelationSample,
  saveQuantitySample,
  WorkoutActivityType,
  type CorrelationSampleTyped,
  type QuantitySample,
  type WorkoutProxyTyped,
} from '@kingstinct/react-native-healthkit';
import type { BloodPressureReadingInput, Meal, Sex, WorkoutInput, WorkoutType } from '@symbiose/shared';

import { cleanProfile, dayBounds, mealWindow, OWN_READING_KEY, toBloodPressureInput, toWorkoutInput, type HealthBridge } from './types';

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

/**
 * Blood pressure is a correlation, but HealthKit only grants its parts:
 * asking for HKCorrelationTypeIdentifierBloodPressure itself throws.
 * Heart rate gives the pulse the cuff wrote next to the reading.
 */
const BP_READ = ['HKQuantityTypeIdentifierBloodPressureSystolic', 'HKQuantityTypeIdentifierBloodPressureDiastolic', 'HKQuantityTypeIdentifierHeartRate'] as const;
const BP_WRITE = ['HKQuantityTypeIdentifierBloodPressureSystolic', 'HKQuantityTypeIdentifierBloodPressureDiastolic'] as const;

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

const MMHG_PER_KPA = 7.50062;

function mmHg(sample: QuantitySample | undefined): number | null {
  if (!sample) return null;
  return sample.unit === 'kPa' ? sample.quantity * MMHG_PER_KPA : sample.quantity;
}

/** The pulse a cuff saved with the reading: a heart-rate sample from the same app, within two minutes. */
async function pulseNear(correlation: CorrelationSampleTyped): Promise<number | null> {
  const at = correlation.startDate.getTime();
  const samples = await queryQuantitySamples('HKQuantityTypeIdentifierHeartRate', {
    filter: { date: { startDate: new Date(at - 120_000), endDate: new Date(at + 120_000) } },
    limit: 0,
    unit: 'count/min',
  }).catch(() => []);
  const bundle = correlation.sourceRevision.source.bundleIdentifier;
  return samples.find((s) => s.sourceRevision.source.bundleIdentifier === bundle)?.quantity ?? null;
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
  storeName: { fr: 'Apple Santé', en: 'Apple Health' },

  isAvailable: () => isHealthDataAvailableAsync(),

  async connect(options) {
    if (!options?.bloodPressure) return requestAuthorization({ toRead: READ, toShare: WRITE });
    return requestAuthorization({ toRead: [...READ, ...BP_READ], toShare: [...WRITE, ...BP_WRITE] });
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

  async readBloodPressure(from, to) {
    const correlations = await queryCorrelationSamples('HKCorrelationTypeIdentifierBloodPressure', {
      filter: { date: { startDate: from, endDate: to } },
      limit: 0,
      ascending: true,
    });
    const readings = await Promise.all(
      correlations
        // Readings Symbiose wrote itself are already on the server.
        .filter((c) => !(c.metadata as Record<string, unknown> | undefined)?.[OWN_READING_KEY])
        .map(async (correlation): Promise<BloodPressureReadingInput | null> => {
          const parts = correlation.objects.filter((o): o is QuantitySample => 'quantityType' in o);
          const systolic = mmHg(parts.find((p) => p.quantityType === 'HKQuantityTypeIdentifierBloodPressureSystolic'));
          const diastolic = mmHg(parts.find((p) => p.quantityType === 'HKQuantityTypeIdentifierBloodPressureDiastolic'));
          if (systolic === null || diastolic === null) return null;
          return toBloodPressureInput({ externalId: correlation.uuid, measuredAt: correlation.startDate, systolic, diastolic, pulse: await pulseNear(correlation) });
        }),
    );
    return readings.filter((r): r is BloodPressureReadingInput => r !== null);
  },

  async writeBloodPressure(reading) {
    const at = reading.measuredAt;
    await saveCorrelationSample(
      'HKCorrelationTypeIdentifierBloodPressure',
      [
        { quantityType: 'HKQuantityTypeIdentifierBloodPressureSystolic', quantity: reading.systolic, unit: 'mmHg', startDate: at, endDate: at },
        { quantityType: 'HKQuantityTypeIdentifierBloodPressureDiastolic', quantity: reading.diastolic, unit: 'mmHg', startDate: at, endDate: at },
      ],
      at,
      at,
      { [OWN_READING_KEY]: reading.id },
    );
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

export { BP_SCOPES, HEALTH_SCOPES, inferWalkIntensity } from './types';
export type { DayHealth, HealthBridge, HealthProfile, WeightReading } from './types';
