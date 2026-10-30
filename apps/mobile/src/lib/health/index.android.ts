import type { Meal } from '@symbiose/shared';
import { aggregateRecord, getSdkStatus, initialize, insertRecords, readRecords, requestPermission, SdkAvailabilityStatus } from 'react-native-health-connect';

import { dayBounds, mealWindow, type HealthBridge } from './types';

const MEAL_TYPE = { breakfast: 1, lunch: 2, dinner: 3, snack: 4 } as const;

let initialized = false;
async function ensureInit(): Promise<boolean> {
  if (!initialized) initialized = await initialize();
  return initialized;
}

export const health: HealthBridge = {
  source: 'health_connect',
  storeName: 'Health Connect',

  async isAvailable() {
    try {
      return (await getSdkStatus()) === SdkAvailabilityStatus.SDK_AVAILABLE;
    } catch {
      return false;
    }
  },

  async connect() {
    if (!(await ensureInit())) return false;
    const granted = await requestPermission([
      { accessType: 'read', recordType: 'Steps' },
      { accessType: 'read', recordType: 'ActiveCaloriesBurned' },
      { accessType: 'read', recordType: 'Weight' },
      { accessType: 'write', recordType: 'Nutrition' },
    ]);
    return granted.length > 0;
  },

  async readDay(day) {
    await ensureInit();
    const { start, end } = dayBounds(day);
    const timeRangeFilter = { operator: 'between' as const, startTime: start.toISOString(), endTime: end.toISOString() };
    const [steps, active, weight] = await Promise.all([
      aggregateRecord({ recordType: 'Steps', timeRangeFilter }).catch(() => null),
      aggregateRecord({ recordType: 'ActiveCaloriesBurned', timeRangeFilter }).catch(() => null),
      readRecords('Weight', {
        timeRangeFilter: { operator: 'after', startTime: new Date(Date.now() - 30 * 86_400_000).toISOString() },
        ascendingOrder: false,
        pageSize: 1,
      }).catch(() => null),
    ]);
    return {
      steps: steps?.COUNT_TOTAL ?? null,
      activeKcal: active ? Math.round(active.ACTIVE_CALORIES_TOTAL.inKilocalories) : null,
      restingKcal: null,
      weightKg: weight?.records[0]?.weight.inKilograms ?? null,
    };
  },

  async readWeights(from, to) {
    await ensureInit();
    const { records } = await readRecords('Weight', {
      timeRangeFilter: { operator: 'between', startTime: from.toISOString(), endTime: to.toISOString() },
      ascendingOrder: true,
    });
    return records.map((record) => ({ measuredAt: new Date(record.time), kg: record.weight.inKilograms }));
  },

  async writeMeal(meal: Meal) {
    await ensureInit();
    const { start, end } = mealWindow(meal);
    const t = meal.totals;
    const grams = (value: number) => ({ value, unit: 'grams' as const });
    await insertRecords([
      {
        recordType: 'Nutrition',
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        name: meal.title,
        mealType: MEAL_TYPE[meal.mealType],
        energy: { value: t.kcal, unit: 'kilocalories' },
        protein: grams(t.protein),
        totalCarbohydrate: grams(t.carbs),
        sugar: grams(t.sugar),
        totalFat: grams(t.fat),
        saturatedFat: grams(t.satFat),
        dietaryFiber: grams(t.fiber),
        sodium: grams(t.sodium / 1000),
      },
    ]);
  },
};

export type { DayHealth, HealthBridge, WeightReading } from './types';
