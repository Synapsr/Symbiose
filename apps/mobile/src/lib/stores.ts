import type { CreateMealInput } from '@symbiose/shared';
import { create } from 'zustand';

import { storage } from './storage';

// ---------------------------------------------------------------- Settings (per device)

interface SettingsState {
  loaded: boolean;
  hideCalories: boolean;
  healthEnabled: boolean;
  lastHealthSync: number;
  lastWeightSync: number;
  lastWorkoutSync: number;
  /** Version of the health permissions granted (see `HEALTH_SCOPES`). */
  healthScopes: number;
  set: (patch: Partial<Pick<SettingsState, 'hideCalories' | 'healthEnabled' | 'lastHealthSync' | 'lastWeightSync' | 'lastWorkoutSync' | 'healthScopes'>>) => void;
  load: () => Promise<void>;
}

const SETTINGS_KEY = 'symbiose.settings';

export const useSettings = create<SettingsState>()((set, get) => ({
  loaded: false,
  hideCalories: false,
  healthEnabled: false,
  lastHealthSync: 0,
  lastWeightSync: 0,
  lastWorkoutSync: 0,
  healthScopes: 0,
  set: (patch) => {
    set(patch);
    const { hideCalories, healthEnabled, lastWeightSync, lastWorkoutSync, healthScopes } = get();
    void storage.set(SETTINGS_KEY, JSON.stringify({ hideCalories, healthEnabled, lastWeightSync, lastWorkoutSync, healthScopes })).catch(() => undefined);
  },
  load: async () => {
    try {
      const raw = await storage.get(SETTINGS_KEY);
      if (raw) set(JSON.parse(raw) as Partial<SettingsState>);
    } finally {
      set({ loaded: true });
    }
  },
}));

// ---------------------------------------------------------------- Meals being analysed

export interface PendingMeal {
  id: string;
  input: CreateMealInput;
  photoUri: string | null;
  label: string;
  status: 'analyzing' | 'error';
  error: string | null;
  startedAt: number;
}

interface PendingState {
  items: PendingMeal[];
  upsert: (item: PendingMeal) => void;
  remove: (id: string) => void;
}

export const usePending = create<PendingState>()((set) => ({
  items: [],
  upsert: (item) => set((s) => ({ items: [...s.items.filter((i) => i.id !== item.id), item] })),
  remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
}));

// ---------------------------------------------------------------- Toasts

export interface Toast {
  id: number;
  message: string;
  action?: { label: string; onPress: () => void };
  onPress?: () => void;
}

interface ToastState {
  current: Toast | null;
  show: (toast: Omit<Toast, 'id'>) => void;
  hide: () => void;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useToast = create<ToastState>()((set) => ({
  current: null,
  show: (toast) => {
    clearTimeout(toastTimer);
    set({ current: { ...toast, id: Date.now() } });
    toastTimer = setTimeout(() => set({ current: null }), 4500);
  },
  hide: () => {
    clearTimeout(toastTimer);
    set({ current: null });
  },
}));

// ---------------------------------------------------------------- Server QR scan result

export const useScannedServer = create<{ url: string | null; set: (url: string | null) => void }>()((set) => ({
  url: null,
  set: (url) => set({ url }),
}));
