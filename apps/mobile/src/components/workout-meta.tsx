import type { WorkoutIntensity, WorkoutType } from '@symbiose/shared';
import { Activity, Bike, Dumbbell, Flower2, Footprints, SportShoe, Volleyball, Waves, Zap, type LucideIcon } from 'lucide-react-native';

import type { TranslationKey } from '@/i18n';

/** In the order people pick them most. */
export const WORKOUT_TYPES: WorkoutType[] = ['walking', 'running', 'cycling', 'strength', 'swimming', 'hiit', 'yoga', 'sports', 'other'];

export const WORKOUT_INTENSITIES: WorkoutIntensity[] = ['light', 'moderate', 'vigorous'];

export const WORKOUT_ICONS: Record<WorkoutType, LucideIcon> = {
  walking: Footprints,
  running: SportShoe,
  cycling: Bike,
  strength: Dumbbell,
  swimming: Waves,
  hiit: Zap,
  yoga: Flower2,
  sports: Volleyball,
  other: Activity,
};

export const workoutTypeKey = (type: WorkoutType) => `workout.type.${type}` as TranslationKey;
export const intensityKey = (intensity: WorkoutIntensity) => `workout.${intensity}` as TranslationKey;
