import { DEFAULT_GLASS_ML, type CreateMealInput } from '@symbiose/shared';
import { AppState } from 'react-native';
import { create } from 'zustand';

import type { RewardLog } from './feedback-logic';
import type { HeroChoice } from './hero-logic';
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
  /** What one tap on the water pill logs; the « + » sheet (or a long press) picks another size and remembers it. */
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
  /** Sign-up on request: the goals written while the account waits, drafted into a plan once approved. */
  waitingIntentions: string;
  /** Feedback: the reward sounds (the silent switch still mutes them), and the rewards already given today (`rewardsDue`). */
  sounds: boolean;
  rewards: RewardLog;
  /** Photo words: times the camera said, beside its mic, that words can go with the photo (`DESCRIBE_HINTS` at most). */
  describeHints: number;
  /** Today's hero card: the page swiped to (null: the goal's own), and whether its one-time swipe hint has played. */
  heroPage: HeroChoice | null;
  heroHinted: boolean;
  /** On a phone without a server: when the last backup was made (ISO), for « Dernière sauvegarde ». */
  lastBackupAt: string;
  /** With a server: the server whose AI the person was told about (what it receives, and who answers). */
  aiNoticeFor: string;
  /** « Séries et étapes »: the flame, the milestones and their celebrations. Off, Symbiose stays factual. */
  motivation: boolean;
  /** The milestones already celebrated (or found already reached) on this phone: each one is celebrated once (`milestoneDue`). */
  milestonesSeen: string[];
  /** The evening reminder when the streak still waits for today's meal (`STREAK_REMINDER_AT`). */
  streakReminder: boolean;
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
  waitingIntentions: '',
  sounds: true,
  rewards: { date: '', keys: [] },
  describeHints: 0,
  heroPage: null,
  heroHinted: false,
  lastBackupAt: '',
  aiNoticeFor: '',
  motivation: true,
  milestonesSeen: [],
  streakReminder: false,
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
      waitingIntentions: s.waitingIntentions,
      sounds: s.sounds,
      rewards: s.rewards,
      describeHints: s.describeHints,
      heroPage: s.heroPage,
      heroHinted: s.heroHinted,
      lastBackupAt: s.lastBackupAt,
      aiNoticeFor: s.aiNoticeFor,
      motivation: s.motivation,
      milestonesSeen: s.milestonesSeen,
      streakReminder: s.streakReminder,
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
  /** Joining a meal as its next course: « ton déjeuner ». */
  joining?: string | null;
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
  /** Runs when the toast leaves without its action: timed out, replaced, tapped away or the app left. */
  onExpire?: () => void;
}

interface ToastState {
  current: Toast | null;
  /** Distance from the bottom of the screen the toast keeps clear of (Today's thumb buttons); 0 elsewhere. */
  lift: number;
  show: (toast: Omit<Toast, 'id'>) => void;
  hide: () => void;
  /** The action was used: it runs instead of `onExpire`. */
  act: () => void;
  setLift: (lift: number) => void;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
let toastSeq = 0;

export const useToast = create<ToastState>()((set, get) => {
  const leave = () => {
    clearTimeout(toastTimer);
    const toast = get().current;
    set({ current: null });
    return toast;
  };
  return {
    current: null,
    lift: 0,
    show: (toast) => {
      const previous = leave();
      set({ current: { ...toast, id: ++toastSeq } });
      previous?.onExpire?.();
      toastTimer = setTimeout(() => get().hide(), 4500);
    },
    hide: () => leave()?.onExpire?.(),
    act: () => leave()?.action?.onPress(),
    setLift: (lift) => set({ lift }),
  };
});

// Leaving the app closes the undo window: what was deleted is deleted for real.
AppState.addEventListener('change', (state) => {
  if (state === 'background') useToast.getState().hide();
});

// ---------------------------------------------------------------- Server QR scan result

export const useScannedServer = create<{ url: string | null; set: (url: string | null) => void }>()((set) => ({
  url: null,
  set: (url) => set({ url }),
}));
