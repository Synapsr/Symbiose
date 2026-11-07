import { addDays, computeTargets, type GoalPlan, type Nutrients, type Profile, type ReportData, type ReportMeal } from '@symbiose/shared';
import { describe, expect, it } from 'vitest';

import { en as EN } from '../../i18n/en';
import { fr as FR, type TranslationKey } from '../../i18n/fr';
import { buildReport } from './build';
import { dateTicks, dayBars, niceScale } from './charts';
import { FIRST_PAGE_HEIGHT, lineCount, paginate, PAGE_HEIGHT, table, type Block } from './layout';
import type { Copy } from './pieces';
import { availableSections, chosenSections, PRIVATE_SECTIONS, REPORT_SECTIONS, reportPeriod, sectionCounts, toggleAll, toggleSection } from './sections';

// The dictionaries as the app fills them (`translate` itself needs the device's locale).
const fill = (text: string, params: Record<string, string | number> = {}) => Object.entries(params).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, String(value)), text);
const copyFor = (locale: 'fr' | 'en'): Copy => {
  const dict = locale === 'fr' ? FR : EN;
  const t = (key: TranslationKey, params?: Record<string, string | number>) => fill(dict[key], params);
  const form = (count: number) => ((locale === 'fr' ? Math.abs(count) < 2 : count === 1) ? 'one' : 'other');
  return { locale, t, plural: (key, count, params) => t(`${key}.${form(count)}` as TranslationKey, { count, ...params }) };
};

const to = '2026-11-07';
const from = addDays(to, -13);
const profile: Profile = { name: 'Claire', sex: 'female', birthYear: 1979, heightCm: 165, weightKg: 76, activityLevel: 'light', locale: 'fr', timezone: 'Europe/Paris' };
const plan: GoalPlan = {
  intentions: 'Je suis prédiabétique, je veux mieux répartir mes glucides.',
  title: 'Glycémie plus stable',
  summary: '',
  tags: ['blood_sugar'],
  calorieMode: 'deficit',
  caloriePercent: 15,
  proteinPerKg: 1.2,
  fatPercent: 30,
  rules: [{ nutrient: 'addedSugar', kind: 'max', value: 25, reason: '' }],
  focus: ['carbs', 'addedSugar'],
  habits: [],
  coachTone: 'gentle',
  adjustForActivity: false,
  overrides: {},
  activity: null,
  carbsPerMeal: 45,
};
const { targets } = computeTargets(profile, plan);
const n = (patch: Partial<Nutrients>): Nutrients => ({ kcal: 0, protein: 0, carbs: 0, sugar: 0, addedSugar: 0, fat: 0, satFat: 0, fiber: 0, sodium: 0, ...patch });
const meal = (date: string, time: string, title: string, carbs: number): ReportMeal => {
  const totals = n({ kcal: 500, protein: 25, carbs, sugar: carbs / 3, addedSugar: carbs / 8, fat: 18, satFat: 6, fiber: 6, sodium: 600 });
  return { localDate: date, time, mealType: time < '11:00' ? 'breakfast' : time < '16:00' ? 'lunch' : 'dinner', title, items: [{ name: title, grams: 250, nutrients: totals }], totals };
};

/** Two weeks: meals on all days but one, a few weigh-ins (and one before the period), a reading, a note. */
function fixture(): ReportData {
  const dates = Array.from({ length: 14 }, (_, i) => addDays(from, i));
  const meals = dates.filter((_, i) => i !== 4).flatMap((date, i) => [meal(date, '08:00', 'Porridge', 50 + i), meal(date, '12:30', 'Poulet, riz', 70), meal(date, '19:45', 'Soupe <maison>', 40)]);
  return {
    from,
    to,
    generatedAt: `${to}T09:00:00.000Z`,
    person: { name: 'Claire', sex: 'female', age: 47, heightCm: 165, weightKg: 76, activityLevel: 'light' },
    plan,
    targets,
    days: dates.map((date) => {
      const list = meals.filter((m) => m.localDate === date);
      const totals = list.reduce((sum, m) => n(Object.fromEntries(Object.keys(sum).map((k) => [k, sum[k as keyof Nutrients] + m.totals[k as keyof Nutrients]]))), n({}));
      return { date, logged: list.length > 0, meals: list.length, totals, targets };
    }),
    meals,
    weights: [
      { date: addDays(from, -10), kg: 77.4 },
      ...dates.filter((_, i) => i % 3 === 0).map((date, i) => ({ date, kg: 77 - i * 0.3 })),
    ],
    bloodPressure: [{ id: 'b', externalId: null, measuredAt: `${addDays(to, -2)}T07:40:00+01:00`, localDate: addDays(to, -2), systolic: 128, diastolic: 82, pulse: 64, source: 'manual', createdAt: '' }],
    activity: { goals: { weeklyActiveMinutes: 150, dailySteps: 8000, weeklyStrengthSessions: null }, days: dates.map((date, i) => ({ date, activeMinutes: i % 2 ? 30 : 0, steps: 7000 + i * 100 })) },
    workouts: [],
    sleep: null,
    hydration: null,
    mood: null,
    cravings: [{ localDate: addDays(to, -1), time: '16:10', what: 'Chocolat', intensity: 2, outcome: 'resisted' }],
    journal: [{ id: 'j', at: `${addDays(to, -3)}T21:00:00+01:00`, localDate: addDays(to, -3), kind: 'symptom', text: 'Ballonnements après le dîner', data: {}, createdAt: '', updatedAt: '' }],
    transit: null,
  };
}

describe('the parts offered', () => {
  const data = fixture();
  const counts = sectionCounts(data);

  it('counts what each part would show, and offers only what the period has', () => {
    expect(counts).toMatchObject({ nutrition: 13, foods: 39, weight: 5, bloodPressure: 1, activity: 14, cravings: 1, notes: 1, meals: 39, sleep: 0, hydration: 0, mood: 0 });
    expect(availableSections(counts)).toEqual(['nutrition', 'carbs', 'foods', 'weight', 'bloodPressure', 'activity', 'cravings', 'notes', 'meals']);
  });

  it('leaves the private notes out until ticked, and ticks or unticks everything at once', () => {
    const available = availableSections(counts);
    expect(chosenSections(available, PRIVATE_SECTIONS)).not.toContain('notes');
    expect(toggleAll(available, PRIVATE_SECTIONS)).toEqual([]);
    expect(toggleAll(available, [])).toEqual(available);
    // A part not offered this period keeps its choice for another one.
    expect(toggleAll(available, ['sleep', 'notes'])).toEqual(['sleep']);
    expect(toggleSection(['notes'], 'notes')).toEqual([]);
    expect(toggleSection([], 'weight')).toEqual(['weight']);
  });

  it('ends the period today', () => {
    expect(reportPeriod(30, to)).toEqual({ from: '2026-10-09', to });
  });
});

describe('pages', () => {
  const block = (height: number, extra: Partial<Block> = {}): Block => ({ height, html: `<p>${height}</p>`, ...extra });

  it('never leaves a heading alone at the bottom of a page', () => {
    const pages = paginate([block(FIRST_PAGE_HEIGHT - 60), block(30, { keepWithNext: true }), block(200)]);
    expect(pages.map((p) => p.blocks.map((b) => b.block.height))).toEqual([[FIRST_PAGE_HEIGHT - 60], [30, 200]]);
  });

  it('goes on with a table on the next page, its header repeated, a group heading never last', () => {
    const rows = Array.from({ length: 80 }, (_, i) => ({ cells: [`r${i}`], keepWithNext: i % 10 === 0 }));
    const pages = paginate([table([{ width: 100, label: 'Date' }], rows)]);
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) {
      const html = page.blocks.map((b) => b.block.html as string).join('');
      expect(html).toContain('>Date<');
      const used = page.blocks.reduce((sum, b) => sum + b.gap + b.block.height, 0);
      expect(used).toBeLessThanOrEqual(pages.indexOf(page) === 0 ? FIRST_PAGE_HEIGHT : PAGE_HEIGHT);
    }
    // Every row printed once, in order.
    const all = pages.flatMap((p) => p.blocks.map((b) => b.block.html as string)).join('');
    expect(all.match(/>r\d+</g)!.map((m) => Number(m.slice(2, -1)))).toEqual(rows.map((_, i) => i));
    // A page never ends on a group's heading row.
    for (const page of pages.slice(0, -1)) expect((page.blocks.at(-1)!.block.html as string).match(/>r(\d+)</g)!.at(-1)).not.toMatch(/>r\d?0</);
  });

  it('measures text generously, so it never overflows its box', () => {
    expect(lineCount('Un mot', 300, 12)).toBe(1);
    expect(lineCount('a '.repeat(200), 300, 12)).toBeGreaterThan(1);
    expect(lineCount('Deux\nlignes', 300, 12)).toBe(2);
  });
});

describe('charts', () => {
  it('rounds the scale to readable steps', () => {
    expect(niceScale(0, 187)).toMatchObject({ min: 0, max: 200, ticks: [0, 50, 100, 150, 200] });
    expect(niceScale(0, 2240, 4)).toMatchObject({ max: 3000, ticks: [0, 1000, 2000, 3000] });
  });

  it('labels days, Mondays or months, never crowded', () => {
    const week = Array.from({ length: 7 }, (_, i) => addDays('2026-11-01', i));
    expect(dateTicks(week, 600, 'fr').map((t) => t.label)).toEqual(['1 nov.', '2 nov.', '3 nov.', '4 nov.', '5 nov.', '6 nov.', '7 nov.']);
    const quarter = Array.from({ length: 90 }, (_, i) => addDays('2026-08-10', i));
    const ticks = dateTicks(quarter, 300, 'fr');
    expect(ticks.length).toBeLessThanOrEqual(5);
    expect(ticks.map((t) => t.label)).toEqual(['sept.', 'oct.', 'nov.']);
  });

  it('draws nothing for a day without meals but a grey dot, never a zero bar', () => {
    const svg = dayBars({ width: 300, height: 120, dates: ['2026-11-01', '2026-11-02'], series: [{ values: [null, 40], color: '#0F7663' }], tick: String, locale: 'fr' });
    expect(svg.match(/<path d="M/g)).toHaveLength(1);
    expect(svg).toContain('<circle');
  });
});

describe('the report', () => {
  const data = fixture();
  const all = availableSections(sectionCounts(data));
  const fr = buildReport(data, { sections: all, calories: true }, copyFor('fr'));

  it('is a document of A4 pages, each with its page number', () => {
    expect(fr.html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(fr.pages).toBeGreaterThan(2);
    expect(fr.html.match(/<section class="page">/g)).toHaveLength(fr.pages);
    for (let page = 1; page <= fr.pages; page++) expect(fr.html).toContain(`>${page} / ${fr.pages}<`);
    expect(fr.fileName).toBe(`Symbiose-rapport-${from}-${to}`);
  });

  it('opens with the person, the period, the goal in their words and its rules, and says once that values are estimated', () => {
    expect(fr.html).toContain('Rapport de suivi');
    expect(fr.html).toContain('Claire');
    expect(fr.html).toContain('25 octobre 2026');
    expect(fr.html).toContain('Glycémie plus stable');
    expect(fr.html).toContain('prédiabétique');
    expect(fr.html.match(/estimations/g)).toHaveLength(1);
    expect(fr.html).toContain('ne mesure pas la glycémie');
  });

  it('prints every ticked part and nothing else, in order', () => {
    const titles = ['Apports nutritionnels', 'Glucides et sucres', 'Repas et aliments', 'Poids', 'Tension artérielle', 'Activité physique', 'Envies', 'Notes du carnet', 'Journal des repas'];
    const at = titles.map((title) => fr.html.indexOf(`<i></i>${title}`));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);

    const some = buildReport(data, { sections: chosenSections(all, PRIVATE_SECTIONS).filter((s) => s !== 'meals'), calories: true }, copyFor('fr'));
    expect(some.html).not.toContain('Ballonnements');
    expect(some.html).not.toContain('Journal des repas');
    expect(some.pages).toBeLessThan(fr.pages);
  });

  it('leaves calories out everywhere when they are hidden', () => {
    const hidden = buildReport(data, { sections: all, calories: false }, copyFor('fr'));
    expect(hidden.html).not.toMatch(/kcal|Calories|énergie/i);
    expect(fr.html).toContain('kcal');
  });

  it('escapes what the person wrote, and leaves no word or number missing', () => {
    expect(fr.html).not.toContain('Soupe <maison>');
    expect(fr.html).toContain('Soupe &lt;maison&gt;');
    expect(fr.html).not.toMatch(/undefined|NaN|Infinity|\[report\./);
    const en = buildReport(data, { sections: all, calories: true }, copyFor('en'));
    expect(en.html).toContain('Progress report');
    expect(en.html).not.toMatch(/undefined|NaN|Infinity/);
  });

  it('draws the weight trend from the weigh-ins before the period too', () => {
    expect(fr.html).toContain('Tendance actuelle');
    expect(fr.html).toMatch(/<path d="M[^"]+C/);
  });

  it('is the same every time for the same data and choices', () => {
    expect(buildReport(data, { sections: all, calories: true }, copyFor('fr')).html).toBe(fr.html);
  });

  it('prints only the synthesis when nothing is ticked', () => {
    const summary = buildReport(data, { sections: [], calories: true }, copyFor('fr'));
    expect(summary.pages).toBe(1);
    expect(summary.html).not.toContain('Sommaire');
  });

  it('knows every part', () => {
    expect(REPORT_SECTIONS).toHaveLength(12);
  });
});
