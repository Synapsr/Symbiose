import type { HealthBridge } from './types';

/** Web and unsupported platforms: no health store. */
export const health: HealthBridge = {
  source: null,
  storeName: '',
  isAvailable: async () => false,
  connect: async () => false,
  readDay: async () => ({ steps: null, activeKcal: null, restingKcal: null, weightKg: null }),
  readWeights: async () => [],
  readProfile: async () => ({}),
  readWorkouts: async () => [],
  writeMeal: async () => undefined,
};

export { HEALTH_SCOPES } from './types';
export type { DayHealth, HealthBridge, HealthProfile, WeightReading } from './types';
