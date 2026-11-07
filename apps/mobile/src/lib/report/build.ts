import { carbsGuideFor, carbsPerMeal, daysBetween, goalNutrient, type NutrientKey, type ReportData } from '@symbiose/shared';

import type { TranslationKey } from '@/i18n';

import { BOURGEON, bourgeonPath } from '../../components/ui/bourgeon-path';
import { CONTENT_WIDTH, esc, HEADER_GAP, lineCount, PAGE, paginate, renderBlock, table, type Block, type Column, type RenderContext, type Row } from './layout';
import { activityPart, bloodPressurePart, carbsPart, cravingsPart, foodsPart, hydrationPart, mealsPart, mean, meanTarget, moodPart, notesPart, nutritionPart, sleepPart, weightPart, withinTarget, type PartContext } from './parts';
import { formatters, kpis, noteBlock, type Copy, type Kpi } from './pieces';
import { REPORT_SECTIONS, type ReportSection } from './sections';
import { REPORT_CSS } from './styles';

export interface ReportOptions {
  /** The ticked parts; they print in `REPORT_SECTIONS` order. */
  sections: readonly ReportSection[];
  /** Energy in the tables and charts: hidden in the app by default when calories are. */
  calories: boolean;
}

export interface BuiltReport {
  html: string;
  pages: number;
  /** « Symbiose-rapport-2026-08-10-2026-11-07 ». */
  fileName: string;
}

/** The mark, flat: the cell in ink and its bud in Symbiose's green. */
function logo(size: number): string {
  const { c1x, c1y, r1, c2x, c2y, r2, rf } = BOURGEON;
  return `<svg width="${size}" height="${size}" viewBox="12.5 12 76.5 76.5"><path d="${bourgeonPath(c1x, c1y, r1, c2x, c2y, r2, rf)}" fill="#1B1E22"/><circle cx="${c2x}" cy="${c2y}" r="${r2}" fill="#12A27A"/></svg>`;
}

/** The nutrients of the synthesis table, with « dont » rows under the one they belong to. */
const AVERAGE_ROWS: { key: NutrientKey; indent?: boolean }[] = [
  { key: 'kcal' },
  { key: 'protein' },
  { key: 'carbs' },
  { key: 'sugar', indent: true },
  { key: 'addedSugar', indent: true },
  { key: 'fat' },
  { key: 'satFat', indent: true },
  { key: 'fiber' },
  { key: 'sodium' },
];
const OF_KEYS: Partial<Record<NutrientKey, TranslationKey>> = { sugar: 'report.pdf.n.sugar', addedSugar: 'report.pdf.n.addedSugar', satFat: 'report.pdf.n.satFat' };

function coverBlocks(c: PartContext, chosen: readonly ReportSection[]): Block[] {
  const { f, data, copy } = c;
  const { person, plan } = data;
  const days = daysBetween(data.from, data.to) + 1;
  const name = person.name.trim();
  const blocks: Block[] = [];

  // Title, who and when.
  const who = [name ? `<b>${f.text(name)}</b>` : '', f.t('report.pdf.period', { from: f.long(data.from), to: f.long(data.to) }), f.plural('report.pdf.days', days)].filter(Boolean).join(' · ');
  blocks.push({
    height: 24 + 26 + 36 + 4 + 20,
    html: `<div class="cover-top"><div class="brand">${logo(22)}Symbiose</div><div class="made">${f.t('report.pdf.createdOn', { date: f.long(data.generatedAt.slice(0, 10)) })}</div></div><div class="h1">${f.t('report.pdf.title')}</div><div class="who">${who}</div>`,
  });

  // The person, as a professional would note it; the weight only when its part is in the report.
  const withWeight = c.sections.has('weight');
  const latestWeight = data.weights.filter((w) => w.date >= data.from).at(-1)?.kg ?? person.weightKg;
  const facts: { label: string; value: string }[] = [{ label: f.t('report.pdf.fact.age'), value: f.t('report.pdf.years', { count: person.age }) }];
  if (person.sex !== 'other') facts.push({ label: f.t('report.pdf.fact.sex'), value: f.t(`report.pdf.sex.${person.sex}` as TranslationKey) });
  facts.push({ label: f.t('report.pdf.fact.height'), value: `${f.num(person.heightCm)}&nbsp;cm` });
  if (withWeight) {
    facts.push({ label: f.t('report.pdf.fact.weight'), value: f.kg(latestWeight) });
    facts.push({ label: f.t('report.pdf.fact.bmi'), value: f.num(latestWeight / (person.heightCm / 100) ** 2, 1) });
  }
  facts.push({ label: f.t('report.pdf.fact.activity'), value: f.t(`onb.activity.${person.activityLevel}` as TranslationKey) });
  blocks.push({ height: 58, gapBefore: 18, html: `<div class="panel facts">${facts.map((x) => `<div class="fact"><div class="l">${x.label}</div><div class="v">${x.value}</div></div>`).join('')}</div>` });

  // The goal, in the person's words, and what the plan watches.
  if (plan) {
    const rules: { label: string; value: string }[] = [];
    if (c.calories) {
      const mode =
        plan.calorieMode === 'deficit'
          ? copy.t('report.pdf.mode.deficit', { pct: plan.caloriePercent })
          : plan.calorieMode === 'surplus'
            ? copy.t('report.pdf.mode.surplus', { pct: plan.caloriePercent })
            : copy.t('report.pdf.mode.maintain');
      rules.push({ label: f.nutrient('kcal'), value: `${f.t('report.pdf.perDayValue', { value: f.target('kcal', data.targets.kcal) })} · ${f.text(mode)}` });
    }
    rules.push({ label: f.nutrient('protein'), value: `${f.t('report.pdf.perDayValue', { value: f.target('protein', data.targets.protein) })} · ${f.num(plan.proteinPerKg, 1)}&nbsp;g/kg` });
    for (const rule of plan.rules) {
      if (rule.nutrient === 'kcal' || rule.nutrient === 'protein') continue;
      rules.push({ label: f.nutrient(rule.nutrient), value: f.t('report.pdf.perDayValue', { value: f.target(rule.nutrient, { kind: rule.kind, value: rule.value }) }) });
    }
    const guide = carbsPerMeal(plan);
    if (guide !== null) rules.push({ label: f.t('report.pdf.rule.carbsPerMeal'), value: f.t('report.pdf.carbsGuide', { meal: f.amount('carbs', guide), snack: f.amount('carbs', carbsGuideFor('snack', guide)) }) });
    const goals = data.activity.goals;
    rules.push({ label: f.t('report.pdf.rule.activity'), value: f.t('report.pdf.perWeekMin', { count: f.num(goals.weeklyActiveMinutes) }) });
    if (goals.dailySteps) rules.push({ label: f.t('report.pdf.rule.steps'), value: f.t('report.pdf.stepsPerDay', { count: f.num(goals.dailySteps) }) });
    if (goals.weeklyStrengthSessions) rules.push({ label: f.t('report.pdf.rule.strength'), value: f.t('report.pdf.sessionsPerWeek', { count: f.num(goals.weeklyStrengthSessions) }) });

    const words = plan.intentions.trim();
    const wordLines = words ? Math.min(3, lineCount(copy.t('report.pdf.quote', { text: words }), CONTENT_WIDTH - 36, 12)) : 0;
    const ruleRows = Math.ceil(rules.length / 2);
    const height = 14 + 14 + 2 + 21 + (wordLines ? 3 + wordLines * 17 : 0) + 10 + ruleRows * 21;
    blocks.push({
      height,
      html:
        `<div class="panel goal"><div class="over">${f.t('report.pdf.goal')}</div><div class="title">${f.text(plan.title)}</div>` +
        (wordLines ? `<div class="words" style="-webkit-line-clamp:${wordLines};height:${wordLines * 17}px">${f.t('report.pdf.quote', { text: words })}</div>` : '') +
        `<div class="rules">${rules.map((r) => `<div class="rule"><span>${r.label}</span><span>${r.value}</span></div>`).join('')}</div></div>`,
    });
  }

  // The period at a glance.
  const logged = c.logged;
  const hero = goalNutrient(plan, !c.calories);
  const tiles: Kpi[] = [
    { label: f.t('report.pdf.kpi.days'), value: `${f.num(logged.length)} / ${f.num(days)}` },
    { label: f.t('report.pdf.kpi.meals'), value: f.num(logged.length ? data.meals.length / logged.length : 0, 1), sub: f.plural('report.pdf.mealCount', data.meals.length) },
  ];
  if (logged.length) {
    tiles.push({
      label: f.t('report.pdf.kpi.perDay', { nutrient: f.nutrient(hero) }),
      value: f.amount(hero, mean(logged.map((d) => d.totals[hero])) ?? 0),
      sub: f.t('report.pdf.kpi.target', { target: f.target(hero, meanTarget(logged, hero)) }),
    });
  }
  const weighIns = data.weights.filter((w) => w.date >= data.from);
  if (withWeight && weighIns.length > 1) {
    tiles.push({ label: f.t('report.pdf.kpi.weighIns'), value: f.num(weighIns.length), sub: f.t('report.pdf.kpi.range', { min: f.kg(Math.min(...weighIns.map((w) => w.kg))), max: f.kg(Math.max(...weighIns.map((w) => w.kg))) }) });
  } else if (c.sections.has('activity')) {
    const minutes = data.activity.days.reduce((sum, d) => sum + d.activeMinutes, 0);
    tiles.push({ label: f.t('report.pdf.kpi.activePerWeek'), value: f.num(minutes / (days / 7)), unit: 'min', sub: f.t('report.pdf.kpi.goal', { goal: `${f.num(data.activity.goals.weeklyActiveMinutes)} min` }) });
  }
  blocks.push(kpis(tiles));

  // Averages against the targets, the way a food label reads (« dont sucres »).
  if (logged.length) {
    const cols: Column[] = [
      { width: 215, label: copy.t('report.pdf.col.nutrient') },
      { width: 110, label: copy.t('report.pdf.col.average'), align: 'right' },
      { width: 130, label: copy.t('report.pdf.col.range'), align: 'right' },
      { width: 120, label: copy.t('report.pdf.col.target'), align: 'right' },
      { width: CONTENT_WIDTH - 215 - 110 - 130 - 120, label: copy.t('report.pdf.col.inRange'), align: 'right' },
    ];
    const rows: Row[] = AVERAGE_ROWS.filter((row) => row.key !== 'kcal' || c.calories).map(({ key, indent }) => {
      const values = logged.map((d) => d.totals[key]);
      const ok = logged.filter((d) => withinTarget(d.totals[key], d.targets[key])).length;
      const of = OF_KEYS[key];
      return {
        className: indent ? 'indent' : '',
        cells: [
          of ? f.t(of) : f.text(f.nutrient(key)),
          `<b>${f.amount(key, mean(values)!)}</b>`,
          `${f.amount(key, Math.min(...values)).replace(/\u00A0\S+$/, '')} – ${f.amount(key, Math.max(...values))}`,
          f.target(key, meanTarget(logged, key)),
          `${f.num(ok)} / ${f.num(logged.length)}`,
        ],
      };
    });
    const averages = table(cols, rows);
    blocks.push({ height: 22 + averages.height, gapBefore: 18, html: `<div class="sub" style="height:22px">${f.t('report.pdf.averages')}</div>${renderBlock(averages, { pageOf: () => undefined })}` });
  }

  // How to read it, said once.
  const about = copy.t(carbsPerMeal(plan) !== null || chosen.includes('carbs') ? 'report.pdf.aboutBodySugar' : 'report.pdf.aboutBody');
  blocks.push({ ...noteBlock(f.t('report.pdf.about'), f.text(about), about), gapBefore: 18 });

  // Contents, with the page each part starts on.
  const titles = chosen.map((section) => ({ section, title: f.t(`report.section.${section}` as TranslationKey) }));
  if (titles.length) {
    const rows = Math.ceil(titles.length / 2);
    blocks.push({
      height: 22 + rows * 21,
      gapBefore: 18,
      html: (ctx: RenderContext) =>
        `<div class="sub" style="height:22px">${f.t('report.pdf.contents')}</div><div class="toc" style="grid-template-rows:repeat(${rows},21px)">${titles.map((x) => `<div><span>${x.title}</span><span>${ctx.pageOf(x.section) ?? ''}</span></div>`).join('')}</div>`,
    });
  }
  return blocks;
}

const PARTS: Record<ReportSection, (c: PartContext) => Block[]> = {
  nutrition: nutritionPart,
  carbs: carbsPart,
  foods: foodsPart,
  weight: weightPart,
  bloodPressure: bloodPressurePart,
  activity: activityPart,
  sleep: sleepPart,
  hydration: hydrationPart,
  mood: moodPart,
  cravings: cravingsPart,
  notes: notesPart,
  meals: mealsPart,
};

/**
 * The whole report, as one self-contained HTML document of A4 pages: the
 * synthesis first, then each part ticked, in order. Pure: the same data and
 * choices always give the same pages.
 */
export function buildReport(data: ReportData, options: ReportOptions, copy: Copy): BuiltReport {
  const f = formatters(copy);
  const ticked = new Set(options.sections);
  const logged = data.days.filter((d) => d.logged);
  const context: PartContext = { data, copy, f, calories: options.calories, sections: ticked, dates: data.days.map((d) => d.date), logged };

  // Parts with nothing to show this period print nothing, and leave the contents.
  const parts = REPORT_SECTIONS.filter((section) => ticked.has(section)).map((section) => ({ section, blocks: PARTS[section](context) })).filter((p) => p.blocks.length);
  const blocks = [...coverBlocks(context, parts.map((p) => p.section)), ...parts.flatMap((p) => p.blocks)];
  const pages = paginate(blocks);

  const firstPage = new Map<string, number>();
  pages.forEach((page, i) => {
    for (const { block } of page.blocks) if (block.anchor && !firstPage.has(block.anchor)) firstPage.set(block.anchor, i + 1);
  });
  const ctx: RenderContext = { pageOf: (anchor) => firstPage.get(anchor) };

  const name = data.person.name.trim();
  const runningRight = [name ? f.text(name) : '', f.span(data.from, data.to)].filter(Boolean).join(' · ');
  const footLeft = f.t('report.pdf.footer', { date: f.long(data.generatedAt.slice(0, 10)) });
  const html = pages
    .map((page, i) => {
      const running =
        i === 0 ? '' : `<div class="run" style="margin-bottom:${HEADER_GAP}px"><div class="brand">${logo(14)}<b>Symbiose</b> · ${f.t('report.pdf.title')}</div><div>${runningRight}</div></div>`;
      const body = page.blocks.map(({ block, gap }) => `<div class="b" style="height:${block.height}px;margin-top:${gap}px">${renderBlock(block, ctx)}</div>`).join('');
      const foot = `<div class="foot"><span>${footLeft}</span><span class="n">${f.t('report.pdf.page', { page: i + 1, total: pages.length })}</span></div>`;
      return `<section class="page">${running}${body}${foot}</section>`;
    })
    .join('');

  const title = esc([copy.t('report.pdf.title'), name].filter(Boolean).join(' · '));
  return {
    html: `<!DOCTYPE html><html lang="${copy.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=${PAGE.width}"><title>${title}</title><style>${REPORT_CSS}</style></head><body>${html}</body></html>`,
    pages: pages.length,
    fileName: `Symbiose-${copy.locale === 'fr' ? 'rapport' : 'report'}-${data.from}-${data.to}`,
  };
}
