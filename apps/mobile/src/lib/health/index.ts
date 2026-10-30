import type { HealthBridge } from './types';

/** Web and unsupported platforms: no health store. */
export const health: HealthBridge = {
  source: null,
  storeName: '',
  isAvailable: async () => false,
  connect: async () => false,
  readDay: async () => ({ steps: null, activeKcal: null, restingKcal: null, weightKg: null }),
  writeMeal: async () => undefined,
};

export type { DayHealth, HealthBridge } from './types';
