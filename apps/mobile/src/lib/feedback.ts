import type { Meal } from '@symbiose/shared';
import { createAudioPlayer, setAudioModeAsync, type AudioMode, type AudioPlayer } from 'expo-audio';

import { isDictating } from './dictation';
import { LIVE_MS, mayPlay, mealCue, rewardsDue, type Cue } from './feedback-logic';
import { haptics } from './haptics';
import { useSettings } from './stores';

/**
 * The moments that feel good, each with its sound, its haptic and (on Today)
 * its glow: one call per moment, `feedback.goalReached()`, never three.
 * Sounds are quiet, mixed with whatever already plays (music keeps going),
 * muted by the silent switch, and off with « Sons » in Moi.
 */

const SOURCES: Record<Cue, number> = {
  pop: require('@/assets/sounds/pop.m4a'),
  popBright: require('@/assets/sounds/pop-bright.m4a'),
  chime: require('@/assets/sounds/chime.m4a'),
  bloom: require('@/assets/sounds/bloom.m4a'),
  rise: require('@/assets/sounds/rise.m4a'),
};

/** iOS's ambient session: mixes with other audio and follows the silent switch (Android: silent when the ringer is). */
const AMBIENT: Partial<AudioMode> = { playsInSilentMode: false, interruptionMode: 'mixWithOthers', allowsRecording: false, shouldPlayInBackground: false };

let players: Partial<Record<Cue, AudioPlayer>> | null = null;
let last: { cue: Cue; at: number } | null = null;
let actedAt = 0;

/** Loads the few sounds once, so the first reward plays on time. Silent where audio isn't available. */
function load(): Partial<Record<Cue, AudioPlayer>> {
  if (players) return players;
  players = {};
  for (const cue of Object.keys(SOURCES) as Cue[]) {
    try {
      players[cue] = createAudioPlayer(SOURCES[cue]);
    } catch {
      // No audio here (an older build, a browser without it): the haptics still speak.
    }
  }
  return players;
}

async function play(cue: Cue, volume = 1) {
  if (!useSettings.getState().sounds || isDictating()) return;
  const now = Date.now();
  if (!mayPlay(cue, now, last)) return;
  last = { cue, at: now };
  const player = load()[cue];
  if (!player) return;
  try {
    // Every time: dictation leaves the session ready to record (and deaf to the silent switch).
    await setAudioModeAsync(AMBIENT);
    player.volume = volume;
    await player.seekTo(0);
    player.play();
  } catch {
    // A sound is a bonus: never an error.
  }
}

/** Takes the reward `key` for `date` if it wasn't given yet that day; false when it was (see `rewardsDue`). */
export function claimReward(date: string, key: string): boolean {
  const { rewards, set } = useSettings.getState();
  const { due, log } = rewardsDue(rewards, date, [key], true);
  if (log !== rewards) set({ rewards: log });
  return due.length > 0;
}

/** Haptic steps at their offsets (ms), in time with the sound. */
function pattern(steps: [number, () => unknown][]) {
  for (const [at, step] of steps) {
    if (at) setTimeout(step, at);
    else step();
  }
}

export const feedback = {
  /** Loads the sounds ahead of the first reward (the tabs call it once). */
  prepare: () => void load(),

  /** Something the person just did here (a meal, a glass): a goal it reaches may be celebrated (`useGoalRewards`). */
  acted: () => {
    actedAt = Date.now();
  },
  isLive: () => Date.now() - actedAt < LIVE_MS,

  /** A meal saved and analysed: « c'est noté », brighter when it clearly suits the plan, a bloom when it marks a milestone. */
  mealLogged: (meal?: Pick<Meal, 'insight'> | null, milestone = false) => {
    feedback.acted();
    haptics.success();
    void play(milestone ? 'bloom' : mealCue(meal));
  },

  /** « Pareil » in one tap: the same « c'est noté », with the lighter haptic it always had. */
  mealRelogged: (meal?: Pick<Meal, 'insight'> | null) => {
    feedback.acted();
    haptics.soft();
    void play(mealCue(meal));
  },

  /** A session added by hand: effort, noted. */
  workoutLogged: () => {
    feedback.acted();
    haptics.soft();
    void play('pop');
  },

  /** A daily goal reached for the first time today. */
  goalReached: () => {
    haptics.success();
    void play('chime');
  },

  /** A real milestone: the plan created. */
  milestone: () => {
    pattern([
      [0, haptics.soft],
      [90, haptics.success],
    ]);
    void play('bloom');
  },

  /** Yesterday recognised as a good day, the next morning: the same bloom, softer. */
  goodDay: () => {
    haptics.soft();
    void play('bloom', 0.7);
  },

  /** « J'ai tenu »: the biggest one, a crescendo with the climbing notes, landing on their chord. */
  resisted: () => {
    pattern([
      [0, haptics.soft],
      [120, haptics.soft],
      [240, haptics.impact],
      [330, haptics.success],
    ]);
    void play('rise');
  },

  /** « Sons » switched on: a taste of what they sound like. */
  preview: () => void play('chime'),
};
