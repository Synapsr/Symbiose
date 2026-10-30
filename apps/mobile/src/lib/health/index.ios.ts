import {
  getMostRecentQuantitySample,
  isHealthDataAvailableAsync,
  queryQuantitySamples,
  queryStatisticsForQuantity,
  requestAuthorization,
  saveQuantitySample,
} from '@kingstinct/react-native-healthkit';
import type { Meal } from '@symbiose/shared';

import { dayBounds, mealWindow, type HealthBridge } from './types';

const READ = [
  'HKQuantityTypeIdentifierStepCount',
  'HKQuantityTypeIdentifierActiveEnergyBurned',
  'HKQuantityTypeIdentifierBasalEnergyBurned',
  'HKQuantityTypeIdentifierBodyMass',
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

export type { DayHealth, HealthBridge, WeightReading } from './types';
