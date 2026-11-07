import { addDays, type ReportData } from '@symbiose/shared';

/**
 * The parts of the PDF report, in the order they print. The synthesis always
 * opens it; the meal journal, the longest, closes it. A part is offered only
 * when the period has something for it.
 */
export const REPORT_SECTIONS = ['nutrition', 'carbs', 'foods', 'weight', 'bloodPressure', 'activity', 'sleep', 'hydration', 'mood', 'cravings', 'notes', 'meals'] as const;
export type ReportSection = (typeof REPORT_SECTIONS)[number];

/** The person's own words: left out until ticked. */
export const PRIVATE_SECTIONS: readonly ReportSection[] = ['notes'];

/** The periods offered, in days: a week, a month, three months, six. */
export const REPORT_RANGES = [7, 30, 90, 180] as const;
export type ReportRange = (typeof REPORT_RANGES)[number];

/** The period ending today. */
export function reportPeriod(days: number, today: string): { from: string; to: string } {
  return { from: addDays(today, -(days - 1)), to: today };
}

/** What each part would show, counted: days noted, meals, weigh-ins, readings… 0: nothing to offer. */
export function sectionCounts(data: ReportData): Record<ReportSection, number> {
  const logged = data.days.filter((d) => d.logged).length;
  const weighIns = data.weights.filter((w) => w.date >= data.from).length;
  const moodNotes = data.mood?.days.filter((d) => d.note).length ?? 0;
  return {
    nutrition: logged,
    carbs: logged,
    foods: data.meals.length,
    weight: weighIns,
    bloodPressure: data.bloodPressure?.length ?? 0,
    activity: data.workouts.length || data.activity.days.filter((d) => d.steps !== null).length,
    sleep: data.sleep?.nights.length ?? 0,
    hydration: data.hydration?.daysLogged ?? 0,
    mood: data.mood?.days.length ?? 0,
    cravings: data.cravings.length,
    notes: data.journal.length + moodNotes,
    meals: data.meals.length,
  };
}

/** The parts the period can fill, in print order. */
export function availableSections(counts: Record<ReportSection, number>): ReportSection[] {
  return REPORT_SECTIONS.filter((section) => counts[section] > 0);
}

/** The ticked parts: everything offered but what was unticked (and the private parts, until ticked once). */
export function chosenSections(available: readonly ReportSection[], excluded: readonly ReportSection[]): ReportSection[] {
  return available.filter((section) => !excluded.includes(section));
}

/** « Tout sélectionner » / « Tout désélectionner »: the parts left out afterwards. */
export function toggleAll(available: readonly ReportSection[], excluded: readonly ReportSection[]): ReportSection[] {
  const allOn = available.every((section) => !excluded.includes(section));
  // Parts not offered this time keep their choice for another period.
  const elsewhere = excluded.filter((section) => !available.includes(section));
  return allOn ? [...elsewhere, ...available] : elsewhere;
}

export function toggleSection(excluded: readonly ReportSection[], section: ReportSection): ReportSection[] {
  return excluded.includes(section) ? excluded.filter((s) => s !== section) : [...excluded, section];
}
