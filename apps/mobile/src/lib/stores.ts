import { DEFAULT_GLASS_ML, type CreateMealInput } from '@symbiose/shared';
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
  lastBpSync: number;
  lastSleepSync: number;
  lastWaterSync: number;
  /** Version of the health permissions granted (see `HEALTH_SCOPES`). */
  healthScopes: number;
  /** Version of the blood pressure permissions granted (see `BP_SCOPES`). */
  bpScopes: number;
  /** Same for sleep and water (`SLEEP_SCOPES`, `WATER_SCOPES`). */
  sleepScopes: number;
  waterScopes: number;
  /** What one tap on the water button logs; a long press picks another size and remembers it. */
  glassMl: number;
  /** Mirrors the thumb-reach controls (camera button, capture tools, toast action) to the left. */
  leftHanded: boolean;
  /** Proactive coach: the nightly vitals' permissions (`VITALS_SCOPES`) and last import. */
  vitalsScopes: number;
  lastVitalsSync: number;
  /** The day the morning check-in was read in the app: no notification needed for it then. */
  morningSeen: string;
  /** What was swiped off Today's coach line, for that day only. */
  lineDismissed: { date: string; kinds: string[] };
  /** The week's craving nudges, kept for the notifications scheduled ahead. */
  nudges: { week: string; lines: string[] } | null;
  set: (patch: Partial<Omit<SettingsState, 'loaded' | 'set' | 'load'>>) => void;
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
  lastBpSync: 0,
  lastSleepSync: 0,
  lastWaterSync: 0,
  healthScopes: 0,
  bpScopes: 0,
  sleepScopes: 0,
  waterScopes: 0,
  glassMl: DEFAULT_GLASS_ML,
  leftHanded: false,
  vitalsScopes: 0,
  lastVitalsSync: 0,
  morningSeen: '',
  lineDismissed: { date: '', kinds: [] },
  nudges: null,
  set: (patch) => {
    set(patch);
    const s = get();
    const persisted = {
      hideCalories: s.hideCalories,
      healthEnabled: s.healthEnabled,
      lastWeightSync: s.lastWeightSync,
      lastWorkoutSync: s.lastWorkoutSync,
      lastBpSync: s.lastBpSync,
      lastSleepSync: s.lastSleepSync,
      lastWaterSync: s.lastWaterSync,
      healthScopes: s.healthScopes,
      bpScopes: s.bpScopes,
      sleepScopes: s.sleepScopes,
      waterScopes: s.waterScopes,
      glassMl: s.glassMl,
      leftHanded: s.leftHanded,
      vitalsScopes: s.vitalsScopes,
      lastVitalsSync: s.lastVitalsSync,
      morningSeen: s.morningSeen,
      lineDismissed: s.lineDismissed,
      nudges: s.nudges,
    };
    void storage.set(SETTINGS_KEY, JSON.stringify(persisted)).catch(() => undefined);
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
