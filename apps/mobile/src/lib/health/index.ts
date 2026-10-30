import type { HealthBridge } from './types';

/** Web and unsupported platforms: no health store. */
export const health: HealthBridge = {
  source: null,
  storeName: { fr: '', en: '' },
  isAvailable: async () => false,
  connect: async () => false,
  readDay: async () => ({ steps: null, activeKcal: null, restingKcal: null, weightKg: null }),
  readWeights: async () => [],
  readProfile: async () => ({}),
  readWorkouts: async () => [],
  readBloodPressure: async () => [],
  writeBloodPressure: async () => undefined,
  writeMeal: async () => undefined,
};

export { BP_SCOPES, HEALTH_SCOPES, inferWalkIntensity } from './types';
export type { DayHealth, HealthBridge, HealthProfile, WeightReading } from './types';
