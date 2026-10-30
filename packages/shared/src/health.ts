import { BloodPressureCategorySchema, type BloodPressureCategory } from './schemas';

/** Lower bounds (mmHg) of each category above "optimal", ESC/ESH 2018. */
const SYSTOLIC = [120, 130, 140, 160, 180];
const DIASTOLIC = [80, 85, 90, 100, 110];

const rank = (value: number, bounds: number[]) => bounds.filter((bound) => value >= bound).length;

/** ESC/ESH 2018 category; when systolic and diastolic fall in different ones, the higher wins. */
export function classifyBloodPressure(systolic: number, diastolic: number): BloodPressureCategory {
  return BloodPressureCategorySchema.options[Math.max(rank(systolic, SYSTOLIC), rank(diastolic, DIASTOLIC))]!;
}
