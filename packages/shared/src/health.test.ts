import { describe, expect, it } from 'vitest';

import { classifyBloodPressure } from './health';

describe('blood pressure', () => {
  it('classifies readings at the ESC/ESH 2018 boundaries', () => {
    expect(classifyBloodPressure(119, 79)).toBe('optimal');
    expect(classifyBloodPressure(120, 70)).toBe('normal');
    expect(classifyBloodPressure(110, 80)).toBe('normal');
    expect(classifyBloodPressure(129, 84)).toBe('normal');
    expect(classifyBloodPressure(130, 70)).toBe('high_normal');
    expect(classifyBloodPressure(110, 85)).toBe('high_normal');
    expect(classifyBloodPressure(139, 89)).toBe('high_normal');
    expect(classifyBloodPressure(140, 70)).toBe('grade1');
    expect(classifyBloodPressure(110, 90)).toBe('grade1');
    expect(classifyBloodPressure(159, 99)).toBe('grade1');
    expect(classifyBloodPressure(160, 70)).toBe('grade2');
    expect(classifyBloodPressure(110, 100)).toBe('grade2');
    expect(classifyBloodPressure(179, 109)).toBe('grade2');
    expect(classifyBloodPressure(180, 70)).toBe('grade3');
    expect(classifyBloodPressure(110, 110)).toBe('grade3');
  });

  it('uses the higher of the systolic and diastolic categories', () => {
    expect(classifyBloodPressure(125, 95)).toBe('grade1');
    expect(classifyBloodPressure(165, 75)).toBe('grade2');
    expect(classifyBloodPressure(118, 86)).toBe('high_normal');
  });
});
