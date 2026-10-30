import { toLocalDateTime } from '@symbiose/shared';
import { describe, expect, it } from 'vitest';

import { dailyRestingHr, nightlyHrv } from './types';

const local = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min);

describe('nightly vitals', () => {
  const night = { localDate: '2026-10-30', bedtime: toLocalDateTime(local(2026, 10, 29, 23, 30)), wakeTime: toLocalDateTime(local(2026, 10, 30, 7, 0)) };

  it('keeps the HRV readings taken asleep, one median per night', () => {
    const samples = [
      { at: local(2026, 10, 29, 23, 50), value: 40 },
      { at: local(2026, 10, 30, 2, 10), value: 52 },
      { at: local(2026, 10, 30, 5, 30), value: 46 },
      // A breathing session in the afternoon: not a night reading.
      { at: local(2026, 10, 30, 15, 0), value: 90 },
      // A night without sleep data: the early hours stand in for it.
      { at: local(2026, 10, 28, 3, 0), value: 38 },
      { at: local(2026, 10, 28, 9, 0), value: 70 },
    ];
    expect(nightlyHrv(samples, [night], 'hrv_sdnn')).toEqual([
      { localDate: '2026-10-30', metric: 'hrv_sdnn', value: 46, samples: 3 },
      { localDate: '2026-10-28', metric: 'hrv_sdnn', value: 38, samples: 1 },
    ]);
  });

  it('keeps the latest resting heart rate of each day, within plausible values', () => {
    const samples = [
      { at: local(2026, 10, 29, 8), value: 58 },
      { at: local(2026, 10, 29, 20), value: 56.4 },
      { at: local(2026, 10, 30, 9), value: 400 },
    ];
    expect(dailyRestingHr(samples)).toEqual([{ localDate: '2026-10-29', metric: 'resting_hr', value: 56, samples: 1 }]);
  });
});
