import type { BloodPressureReadingInput, Meal, WorkoutInput, WorkoutType } from '@symbiose/shared';
import {
  aggregateRecord,
  ExerciseType,
  getSdkStatus,
  initialize,
  insertRecords,
  readRecords,
  requestPermission,
  SdkAvailabilityStatus,
  type Permission,
  type RecordResult,
  type ReadRecordsOptions,
  type RecordType,
} from 'react-native-health-connect';

import { cleanProfile, dayBounds, mealWindow, OWN_RECORD_PREFIX, toBloodPressureInput, toWorkoutInput, type HealthBridge } from './types';

const MEAL_TYPE = { breakfast: 1, lunch: 2, dinner: 3, snack: 4 } as const;

/** Health Connect exercise types → our nine simple types. Anything unlisted is "other". */
const E = ExerciseType;
const TYPES: [WorkoutType, number[]][] = [
  ['walking', [E.WALKING, E.HIKING, E.SNOWSHOEING, E.WHEELCHAIR]],
  ['running', [E.RUNNING, E.RUNNING_TREADMILL]],
  ['cycling', [E.BIKING, E.BIKING_STATIONARY]],
  [
    'strength',
    [
      E.STRENGTH_TRAINING, E.WEIGHTLIFTING, E.CALISTHENICS, E.BACK_EXTENSION, E.BARBELL_SHOULDER_PRESS, E.BENCH_PRESS,
      E.BENCH_SIT_UP, E.CRUNCH, E.DEADLIFT, E.DUMBBELL_CURL_LEFT_ARM, E.DUMBBELL_CURL_RIGHT_ARM, E.DUMBBELL_FRONT_RAISE,
      E.DUMBBELL_LATERAL_RAISE, E.DUMBBELL_TRICEPS_EXTENSION_LEFT_ARM, E.DUMBBELL_TRICEPS_EXTENSION_RIGHT_ARM,
      E.DUMBBELL_TRICEPS_EXTENSION_TWO_ARM, E.FORWARD_TWIST, E.LAT_PULL_DOWN, E.LUNGE, E.PLANK, E.SQUAT, E.UPPER_TWIST,
    ],
  ],
  ['swimming', [E.SWIMMING_POOL, E.SWIMMING_OPEN_WATER]],
  ['hiit', [E.HIGH_INTENSITY_INTERVAL_TRAINING, E.BOOT_CAMP, E.BURPEE, E.JUMPING_JACK, E.JUMP_ROPE, E.EXERCISE_CLASS]],
  ['yoga', [E.YOGA, E.PILATES, E.STRETCHING, E.GUIDED_BREATHING]],
  [
    'sports',
    [
      E.SOCCER, E.BASKETBALL, E.TENNIS, E.BADMINTON, E.VOLLEYBALL, E.RUGBY, E.HANDBALL, E.ICE_HOCKEY, E.ROLLER_HOCKEY,
      E.FOOTBALL_AMERICAN, E.FOOTBALL_AUSTRALIAN, E.BASEBALL, E.SOFTBALL, E.CRICKET, E.SQUASH, E.RACQUETBALL,
      E.TABLE_TENNIS, E.GOLF, E.MARTIAL_ARTS, E.BOXING, E.FENCING, E.ROCK_CLIMBING, E.FRISBEE_DISC, E.WATER_POLO,
      E.ICE_SKATING, E.SKATING, E.SKIING, E.SNOWBOARDING, E.SURFING, E.PADDLING, E.ROWING, E.SAILING, E.GYMNASTICS,
    ],
  ],
];
const TYPE_BY_EXERCISE = new Map<number, WorkoutType>(TYPES.flatMap(([type, list]) => list.map((e) => [e, type] as const)));

/** Every page of a read (Health Connect pages at 1000 records by default). */
async function readAll<T extends RecordType>(recordType: T, timeRangeFilter: ReadRecordsOptions['timeRangeFilter']): Promise<RecordResult<T>[]> {
  const records: RecordResult<T>[] = [];
  let pageToken: string | undefined;
  do {
    const page = await readRecords(recordType, { timeRangeFilter, ascendingOrder: true, pageToken });
    records.push(...page.records);
    pageToken = page.pageToken || undefined;
  } while (pageToken && records.length < 5000);
  return records;
}

let initialized = false;
async function ensureInit(): Promise<boolean> {
  if (!initialized) initialized = await initialize();
  return initialized;
}

/** Active energy recorded during a session (Health Connect de-duplicates overlapping sources). */
async function sessionKcal(session: RecordResult<'ExerciseSession'>): Promise<number | null> {
  try {
    const result = await aggregateRecord({
      recordType: 'ActiveCaloriesBurned',
      timeRangeFilter: { operator: 'between', startTime: session.startTime, endTime: session.endTime },
    });
    return result.ACTIVE_CALORIES_TOTAL.inKilocalories || null;
  } catch {
    return null;
  }
}

export const health: HealthBridge = {
  source: 'health_connect',
  storeName: { fr: 'Health Connect', en: 'Health Connect' },

  async isAvailable() {
    try {
      return (await getSdkStatus()) === SdkAvailabilityStatus.SDK_AVAILABLE;
    } catch {
      return false;
    }
  },

  async connect(options) {
    if (!(await ensureInit())) return false;
    const permissions: Permission[] = [
      { accessType: 'read', recordType: 'Steps' },
      { accessType: 'read', recordType: 'ActiveCaloriesBurned' },
      { accessType: 'read', recordType: 'Weight' },
      { accessType: 'read', recordType: 'Height' },
      { accessType: 'read', recordType: 'ExerciseSession' },
      { accessType: 'write', recordType: 'Nutrition' },
    ];
    if (options?.bloodPressure) {
      permissions.push({ accessType: 'read', recordType: 'BloodPressure' }, { accessType: 'write', recordType: 'BloodPressure' });
    }
    const granted = await requestPermission(permissions);
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

  /** Health Connect stores neither sex nor birth date: only height and weight. */
  async readProfile() {
    if (!(await ensureInit())) return {};
    // Without the history permission, Health Connect only serves the 30 days before the grant; ask wide anyway.
    const since = { operator: 'after' as const, startTime: new Date(Date.now() - 5 * 365 * 86_400_000).toISOString() };
    const [height, weight] = await Promise.all([
      readRecords('Height', { timeRangeFilter: since, ascendingOrder: false, pageSize: 1 }).catch(() => null),
      readRecords('Weight', { timeRangeFilter: since, ascendingOrder: false, pageSize: 1 }).catch(() => null),
    ]);
    const meters = height?.records[0]?.height.inMeters;
    return cleanProfile({ heightCm: meters ? meters * 100 : undefined, weightKg: weight?.records[0]?.weight.inKilograms });
  },

  async readWorkouts(from, to) {
    await ensureInit();
    const sessions = await readAll('ExerciseSession', { operator: 'between', startTime: from.toISOString(), endTime: to.toISOString() });

    const inputs = await Promise.all(
      sessions.map(async (session): Promise<WorkoutInput | null> => {
        const id = session.metadata?.id;
        if (!id) return null;
        const start = new Date(session.startTime);
        return toWorkoutInput({
          externalId: id,
          type: TYPE_BY_EXERCISE.get(session.exerciseType) ?? 'other',
          start,
          durationSec: (new Date(session.endTime).getTime() - start.getTime()) / 1000,
          activeKcal: await sessionKcal(session),
          distanceM: null,
          source: 'health_connect',
        });
      }),
    );
    return inputs.filter((w): w is WorkoutInput => w !== null);
  },

  async readBloodPressure(from, to) {
    await ensureInit();
    const records = await readAll('BloodPressure', { operator: 'between', startTime: from.toISOString(), endTime: to.toISOString() });
    return records
      // Readings Symbiose wrote itself are already on the server.
      .filter((record) => record.metadata?.id && !record.metadata.clientRecordId?.startsWith(OWN_RECORD_PREFIX))
      .map((record) =>
        toBloodPressureInput({
          externalId: record.metadata!.id!,
          measuredAt: new Date(record.time),
          systolic: record.systolic.inMillimetersOfMercury,
          diastolic: record.diastolic.inMillimetersOfMercury,
          pulse: null,
        }),
      )
      .filter((r): r is BloodPressureReadingInput => r !== null);
  },

  async writeBloodPressure(reading) {
    await ensureInit();
    await insertRecords([
      {
        recordType: 'BloodPressure',
        time: reading.measuredAt.toISOString(),
        systolic: { value: reading.systolic, unit: 'millimetersOfMercury' },
        diastolic: { value: reading.diastolic, unit: 'millimetersOfMercury' },
        bodyPosition: 0,
        measurementLocation: 0,
        metadata: { clientRecordId: `${OWN_RECORD_PREFIX}${reading.id}` },
      },
    ]);
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

export { BP_SCOPES, HEALTH_SCOPES, inferWalkIntensity } from './types';
export type { DayHealth, HealthBridge, HealthProfile, WeightReading } from './types';
