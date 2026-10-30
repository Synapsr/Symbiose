import { describe, expect, it } from 'vitest';

import { hydrationGoalMl, mergeSleepSegments, moodLink, moodPersistentlyLow, nightsByWakeDate, type MoodDay, type SleepSegment } from './life';

/** Local time on 29–31 Oct 2026, whatever the machine's time zone. */
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute);
const seg = (kind: SleepSegment['kind'], from: Date, to: Date): SleepSegment => ({ kind, start: from, end: to });

describe('sleep', () => {
  it('merges stages into time asleep and time in bed, cutting out the awake moments', () => {
    const [night, ...rest] = mergeSleepSegments([
      seg('inBed', at(29, 23, 0), at(30, 7, 0)),
      seg('asleep', at(29, 23, 20), at(30, 3, 0)),
      seg('awake', at(30, 3, 0), at(30, 3, 30)),
      seg('asleep', at(30, 3, 30), at(30, 6, 50)),
    ]);
    expect(rest).toEqual([]);
    expect(night).toEqual({ start: at(29, 23, 0), end: at(30, 7, 0), asleepMin: 420, inBedMin: 480 });
  });

  it('never counts overlapping sources twice, and an awake stage wins over another source', () => {
    const [night] = mergeSleepSegments([
      // The watch's stages…
      seg('asleep', at(29, 23, 0), at(30, 2, 0)),
      seg('awake', at(30, 2, 0), at(30, 2, 20)),
      seg('asleep', at(30, 2, 20), at(30, 6, 0)),
      // …and an app that saw one long sleep.
      seg('asleep', at(29, 23, 30), at(30, 6, 0)),
    ]);
    expect(night).toMatchObject({ asleepMin: 400, inBedMin: 420 });
  });

  it('uses time in bed when nothing tracked the stages, and leaves naps out', () => {
    const nights = mergeSleepSegments([
      seg('inBed', at(29, 0, 30), at(29, 7, 30)),
      // A 40-minute nap the same afternoon.
      seg('asleep', at(29, 14, 0), at(29, 14, 40)),
      // Only asleep stages: time in bed is unknown.
      seg('asleep', at(30, 1, 0), at(30, 8, 0)),
    ]);
    expect(nights).toEqual([
      { start: at(29, 0, 30), end: at(29, 7, 30), asleepMin: 420, inBedMin: 420 },
      { start: at(30, 1, 0), end: at(30, 8, 0), asleepMin: 420, inBedMin: null },
    ]);
  });

  it('keeps one night per wake-up day, the longest one', () => {
    const wake = (n: { end: Date }) => `${n.end.getMonth() + 1}-${n.end.getDate()}`;
    const nights = nightsByWakeDate(
      mergeSleepSegments([
        seg('asleep', at(30, 0, 0), at(30, 6, 0)),
        // A long afternoon sleep the same day after a night shift: still the same wake-up day.
        seg('asleep', at(30, 13, 0), at(30, 15, 0)),
        seg('asleep', at(30, 23, 0), at(31, 7, 0)),
      ]),
      wake,
    );
    expect(nights.map((n) => [wake(n), n.asleepMin])).toEqual([
      ['10-30', 360],
      ['10-31', 480],
    ]);
  });
});

describe('hydration', () => {
  it('starts from 80 % of the EFSA adequate intakes and moves lightly with workouts', () => {
    expect(hydrationGoalMl('female')).toBe(1600);
    expect(hydrationGoalMl('male')).toBe(2000);
    expect(hydrationGoalMl('other')).toBe(1800);
    expect(hydrationGoalMl('female', 320)).toBe(1900);
    expect(hydrationGoalMl('male', 5000)).toBe(2750);
    expect(hydrationGoalMl('male', null)).toBe(2000);
  });
});

describe('mood', () => {
  it('finds the factor whose days differ most, only with enough days on both sides', () => {
    const days: MoodDay[] = [
      ...[2, 2, 3].map((mood) => ({ mood, shortSleep: true, craving: true })),
      ...[4, 4, 5, 4].map((mood) => ({ mood, shortSleep: false, craving: false })),
      { mood: 3, shortSleep: null, craving: true },
    ];
    expect(moodLink(days)).toEqual({ factor: 'shortSleep', withAvg: 2.3, withoutAvg: 4.3, withDays: 3, withoutDays: 4 });
    // Two days with the factor are not enough to say anything.
    expect(moodLink(days.slice(1))).toMatchObject({ factor: 'craving', withDays: 3 });
    expect(moodLink(days.slice(2))).toBeNull();
    // A gap under half a point is noise.
    expect(moodLink([3, 4, 3, 4, 4, 3].map((mood, i) => ({ mood, sugarOver: i % 2 === 0 })))).toBeNull();
  });

  it('flags very low moods only when they last and are still there', () => {
    const today = '2026-10-30';
    const days = (moods: number[]) => moods.map((mood, i) => ({ date: `2026-10-${String(30 - moods.length + 1 + i).padStart(2, '0')}`, mood }));
    expect(moodPersistentlyLow(days([1, 2, 1, 1, 3, 1, 2]), today)).toBe(true);
    expect(moodPersistentlyLow(days([1, 1, 1, 1, 4]), today)).toBe(false);
    expect(moodPersistentlyLow(days([1, 1, 1, 2]), today)).toBe(false);
    // Older than two weeks: it doesn't count anymore.
    expect(moodPersistentlyLow([...days([1, 1, 1, 1]).map((d) => ({ ...d, date: d.date.replace('-10-', '-09-') })), { date: today, mood: 1 }], today)).toBe(false);
  });
});
