import { BloodPressureCategorySchema, type BloodPressureCategory, type CoachMealProposal } from '@symbiose/shared';

import type { Ai, AnalyzedItem, CoachInput, HistoryMeal, MealAnalysis, MealAnalysisInput } from './types';
import { heuristicPlan } from '../services/goals';
import { FALLBACK_NUDGES, templateMorning } from '../services/proactive';

const elevated = (category: BloodPressureCategory | null | undefined) =>
  Boolean(category && BloodPressureCategorySchema.options.indexOf(category) >= BloodPressureCategorySchema.options.indexOf('high_normal'));

/**
 * Deterministic fake AI for local development and UI work without an API key
 * (AI_MOCK=true). Never enable it on a real server: numbers are canned.
 */
const FOODS: { match: RegExp; item: AnalyzedItem }[] = [
  { match: /croissant/i, item: { name: 'Croissant au beurre', emoji: '🥐', portion: '1 pièce', grams: 60, confidence: 0.9, per100g: { kcal: 406, protein: 8.2, carbs: 45.8, sugar: 11, addedSugar: 9, fat: 21, satFat: 13, fiber: 2.3, sodium: 400 } } },
  { match: /caf[ée]|coffee/i, item: { name: 'Café sucré', emoji: '☕', portion: '1 tasse', grams: 150, confidence: 0.75, per100g: { kcal: 22, protein: 0.1, carbs: 5.3, sugar: 5.3, addedSugar: 5.3, fat: 0, satFat: 0, fiber: 0, sodium: 2 } } },
  { match: /p[âa]tes|pasta|carbo/i, item: { name: 'Pâtes carbonara', emoji: '🍝', portion: '1 assiette', grams: 320, confidence: 0.7, per100g: { kcal: 190, protein: 8, carbs: 22, sugar: 1.2, addedSugar: 0, fat: 7.8, satFat: 3.4, fiber: 1.3, sodium: 380 } } },
  { match: /coca|soda/i, item: { name: 'Coca-Cola', emoji: '🥤', portion: '1 canette 33 cl', grams: 330, confidence: 0.95, per100g: { kcal: 42, protein: 0, carbs: 10.6, sugar: 10.6, addedSugar: 10.6, fat: 0, satFat: 0, fiber: 0, sodium: 4 } } },
  { match: /salade|salad/i, item: { name: 'Salade composée', emoji: '🥗', portion: '1 grand bol', grams: 300, confidence: 0.6, per100g: { kcal: 95, protein: 5, carbs: 6, sugar: 2.5, addedSugar: 0.5, fat: 5.5, satFat: 1, fiber: 2.6, sodium: 210 } } },
  { match: /pomme|apple/i, item: { name: 'Pomme', emoji: '🍎', portion: '1 moyenne', grams: 150, confidence: 0.95, per100g: { kcal: 53, protein: 0.3, carbs: 11.6, sugar: 10.4, addedSugar: 0, fat: 0.2, satFat: 0, fiber: 2.4, sodium: 1 } } },
  { match: /yaourt|yogurt/i, item: { name: 'Yaourt aux fruits', emoji: '🥛', portion: '1 pot', grams: 125, confidence: 0.85, per100g: { kcal: 97, protein: 3.4, carbs: 14.5, sugar: 13.5, addedSugar: 9, fat: 2.6, satFat: 1.7, fiber: 0.2, sodium: 50 } } },
  { match: /tarte|dessert|g[âa]teau|cake/i, item: { name: 'Tarte aux pommes', emoji: '🥧', portion: '1 part', grams: 120, confidence: 0.75, per100g: { kcal: 255, protein: 2.6, carbs: 34, sugar: 17, addedSugar: 11, fat: 11.5, satFat: 6.8, fiber: 1.6, sodium: 160 } } },
  { match: /gratin/i, item: { name: 'Gratin dauphinois', emoji: '🥔', portion: '1 belle part', grams: 300, confidence: 0.7, per100g: { kcal: 145, protein: 3.6, carbs: 12.5, sugar: 1.8, addedSugar: 0, fat: 8.8, satFat: 5.6, fiber: 1.3, sodium: 260 } } },
];

const DEFAULT_PLATE: AnalyzedItem[] = [
  { name: 'Poulet rôti', emoji: '🍗', portion: '1 cuisse', grams: 150, confidence: 0.7, per100g: { kcal: 215, protein: 26, carbs: 0, sugar: 0, addedSugar: 0, fat: 12, satFat: 3.4, fiber: 0, sodium: 330 } },
  { name: 'Riz basmati', emoji: '🍚', portion: '1 portion', grams: 180, confidence: 0.65, per100g: { kcal: 130, protein: 2.7, carbs: 28, sugar: 0.1, addedSugar: 0, fat: 0.3, satFat: 0.1, fiber: 0.4, sodium: 1 } },
  { name: 'Haricots verts', emoji: '🫛', portion: '1 poignée', grams: 100, confidence: 0.8, per100g: { kcal: 31, protein: 1.8, carbs: 4.3, sugar: 1.4, addedSugar: 0, fat: 0.2, satFat: 0, fiber: 3.4, sodium: 6 } },
];

/** A photo with no words, by its place in the meal: a starter, the main, then dessert. */
const COURSE_PLATES: AnalyzedItem[][] = [[FOODS[4]!.item], DEFAULT_PLATE, [FOODS[7]!.item]];

const plain = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

/** "Gratin dauphinois 350 g · Salade verte 80 g" → names and grams (the server puts back the values per 100 g it logged). */
const parseItems = (line: string) =>
  line
    .split(' · ')
    .map((part) => /^(.*) (\d+) g$/.exec(part))
    .flatMap((m) => (m ? [{ name: m[1]!, grams: Number(m[2]) }] : []));

const IGNORED = ['reste', 'restes', 'hier', 'comme', 'meme', 'chose', 'soir', 'midi'];

/** The past meal the words point to: one sharing a word with them, else yesterday's latest, else the latest. */
function pastMeal(history: NonNullable<MealAnalysisInput['history']>, text: string): HistoryMeal | null {
  const words = plain(text)
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 4 && !IGNORED.includes(w));
  const named = history.meals.find((m) => words.some((w) => plain(`${m.title} ${m.items}`).includes(w)));
  if (named) return named;
  const yesterday = new Date(Date.parse(`${history.today.slice(4)}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  return (/hier|yesterday/.test(plain(text)) ? history.meals.find((m) => m.when.includes(yesterday)) : null) ?? history.meals[0] ?? null;
}

/** "Entrée", "Plat", "Dessert" or "Café", from what a course holds. */
function courseName(names: string): string {
  const text = plain(names);
  if (/tarte|yaourt|gateau|mousse|glace|pomme|dessert/.test(text)) return 'Dessert';
  if (/^cafe|^the |tisane/.test(text)) return 'Café';
  if (/salade|soupe|veloute|carottes/.test(text)) return 'Entrée';
  return 'Plat';
}

const addedSugarOf = (items: { grams: number; per100g: { addedSugar: number } }[]) => items.reduce((sum, i) => sum + (i.per100g.addedSugar * i.grams) / 100, 0);

/** One verdict for the whole meal, saying which course brings the sugar. */
function wholeMealWords(courses: { label: string; addedSugar: number }[]): Pick<MealAnalysis, 'verdict' | 'headline'> {
  const total = courses.reduce((sum, c) => sum + c.addedSugar, 0);
  const top = courses.reduce((a, b) => (b.addedSugar > a.addedSugar ? b : a), courses[0]!);
  const who = top.label === 'Dessert' ? 'le dessert apporte' : top.label === 'Café' ? 'le café apporte' : 'un plat apporte';
  if (total <= 5) return { verdict: 'great', headline: 'Repas équilibré, presque sans sucre ajouté. Bien joué.' };
  if (total <= 15) return { verdict: 'good', headline: `Repas équilibré, ${who} l’essentiel du sucre ajouté (≈${Math.round(total)} g).` };
  return { verdict: 'watch', headline: `≈${Math.round(total)} g de sucres ajoutés sur le repas, ${who} le plus gros.` };
}

/** "Salade composée, poulet et tarte". */
function mealTitle(names: string[]): string {
  const parts = names.filter(Boolean).map((n, i) => (i ? n.split(' ')[0]!.toLowerCase() : n.split(' ').slice(0, 2).join(' ')));
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} et ${parts.at(-1)}` : (parts[0] ?? 'Repas');
}

const firstName = (line: string) => line.split(' · ')[0]!.replace(/ \d+ g$/, '');

/** "à 16h30" → "16:30". */
function mockTime(text: string): string | null {
  const match = /\b(\d{1,2})\s*h\s*(\d{2})?\b/i.exec(text);
  const hour = Number(match?.[1]);
  return match && hour < 24 ? `${String(hour).padStart(2, '0')}:${match[2] ?? '00'}` : null;
}

/** "ajoute …" / "j'ai mangé …" adds, "modifie" / "corrige" edits the latest meal, "supprime" deletes it. */
function mockMealAction(input: CoachInput): { reply: string; action: CoachMealProposal } | null {
  const text = input.message.trim();
  const latest = input.recentMeals.at(-1);
  const base = { mealType: null, localDate: null, time: null };
  if (/\b(supprime|efface|enl[eè]ve|delete|remove)\b/i.test(text)) {
    if (!latest) return null;
    return {
      reply: 'Je te propose de retirer ce repas. Confirme dans la carte ci-dessous si c’est bien lui.',
      action: { ...base, action: 'delete', mealId: latest.id, description: '', summary: `Supprimer : ${latest.title}, ${latest.time}` },
    };
  }
  if (/\b(modifie|corrige|edit|fix)\b/i.test(text)) {
    if (!latest) return null;
    return {
      reply: 'Bien vu, je corrige ce repas. Vérifie la carte et confirme.',
      action: { ...base, action: 'edit', mealId: latest.id, description: text, time: mockTime(text), summary: `Modifier : ${latest.title}` },
    };
  }
  const added = /^(?:ajoute(?:-moi)?|note|add|log|j['’]ai mangé|i ate)\s*:?\s*(.+)$/i.exec(text)?.[1];
  if (!added) return null;
  const time = mockTime(added);
  return {
    reply: 'Avec plaisir. Je l’ajoute dès que tu confirmes.',
    action: { ...base, action: 'add', mealId: null, description: added, time, summary: `Ajouter : ${added.slice(0, 80)}` },
  };
}

export function createMockAi(): Ai {
  return {
    enabled: true,
    model: 'mock',
    provider: 'mock',

    async analyzeMeal(input) {
      await new Promise((r) => setTimeout(r, 1200));
      const text = `${input.text ?? ''} ${input.correction ?? ''}`;
      const earlier = input.meal?.courses ?? [];

      // A meal whose items are final: words only, for the whole of it.
      if (input.assessOnly) {
        const courses = earlier.map((c) => ({ label: c.label || courseName(c.items), addedSugar: c.nutrients.addedSugar }));
        return {
          isFood: true,
          reusedMeal: null,
          title: mealTitle(earlier.map((c) => firstName(c.items))),
          mealType: input.mealTypeHint,
          courses: courses.length > 1 ? courses.map((c) => c.label) : [],
          items: [],
          ...wholeMealWords(courses),
          tips: [],
          clarification: null,
        };
      }

      // « Le reste du gratin d'hier soir »: what was logged then, by name and grams.
      const past = input.history ? pastMeal(input.history, text) : null;
      let items: AnalyzedItem[];
      if (past) {
        const logged = parseItems(past.items);
        const words = plain(text);
        const picked = logged.filter((i) => plain(i.name).split(' ').some((w) => w.length >= 4 && words.includes(w)));
        const half = /moitie|half|demi/.test(words);
        items = (picked.length ? picked : logged).map((i) => ({ name: i.name, emoji: '', portion: half ? '½ portion' : '1 portion', grams: half ? Math.round(i.grams / 2) : i.grams, confidence: 0.9, per100g: DEFAULT_PLATE[0]!.per100g }));
      } else if (input.previous?.courses?.length) {
        // A correction of a meal in courses: every course comes back, the one it names changed.
        const last = input.previous.courses.length;
        items = input.previous.courses.flatMap((c) => c.items.map(({ name, emoji, portion, grams, confidence, per100g }) => ({ name, emoji, portion, grams, confidence: confidence ?? 0.7, per100g, course: c.course })));
        if (/dessert/i.test(text) && /demi|moiti|half/i.test(text)) items = items.map((i) => (i.course === last ? { ...i, grams: Math.round(i.grams / 2), portion: '½ part' } : i));
      } else {
        items = FOODS.filter((f) => f.match.test(text)).map((f) => f.item);
        if (!items.length && input.previous) items = input.previous.items.map(({ name, emoji, portion, grams, confidence, per100g }) => ({ name, emoji, portion, grams, confidence: confidence ?? 0.7, per100g }));
        if (!items.length) items = input.meal ? COURSE_PLATES[Math.min(earlier.length, 2)]! : DEFAULT_PLATE;
      }
      if (/sans sucre|no sugar|pas de sucre/i.test(text)) {
        // « Pas de sucre dans le café »: only the coffee, when it names it.
        const only = /caf[ée]|coffee/i.test(text) ? /caf[ée]|coffee/i : /./;
        items = items.map((i) => (only.test(i.name) ? { ...i, name: i.name.replace(/ sucré$/, ''), per100g: { ...i.per100g, sugar: i.per100g.sugar - i.per100g.addedSugar, addedSugar: 0, kcal: i.per100g.kcal - i.per100g.addedSugar * 4 } } : i));
      }
      items = items.map((i) => ({ ...i, course: i.course ?? 1 }));
      const added = addedSugarOf(items);
      const sodium = items.reduce((sum, i) => sum + (i.per100g.sodium * i.grams) / 100, 0);

      // The whole meal's courses: those logged, then this one; or those corrected.
      const corrected = input.previous?.courses ?? [];
      const courses = input.meal
        ? [...earlier.map((c) => ({ label: c.label || courseName(c.items), addedSugar: c.nutrients.addedSugar })), { label: courseName(items.map((i) => i.name).join(' ')), addedSugar: added }]
        : corrected.map((c) => ({ label: c.label || courseName(c.items.map((i) => i.name).join(' ')), addedSugar: addedSugarOf(items.filter((i) => i.course === c.course)) }));
      const whole = courses.length > 1 ? wholeMealWords(courses) : null;
      const title = input.meal
        ? mealTitle([...earlier.map((c) => firstName(c.items)), items[0]!.name])
        : corrected.length
          ? mealTitle(corrected.map((c) => c.items[0]?.name ?? ''))
          : items.length === 1
            ? items[0]!.name
            : items.slice(0, 2).map((i) => i.name).join(' & ');
      const analysis: MealAnalysis = {
        isFood: true,
        reusedMeal: past?.ref ?? null,
        title,
        mealType: input.mealTypeHint,
        courses: courses.length > 1 ? courses.map((c) => c.label) : [],
        items,
        verdict: whole?.verdict ?? (added > 15 ? 'watch' : added > 5 ? 'ok' : 'great'),
        headline: whole?.headline ?? (added > 5 ? `≈${Math.round(added)} g de sucres ajoutés dans ce repas.` : 'Repas équilibré, presque sans sucre ajouté. Bien joué.'),
        tips: [
          ...(added > 15 ? ['Remplace la boisson sucrée par de l’eau pétillante citronnée.'] : []),
          ...(input.recentWorkout ? ['Après ta séance, vise 20 à 30 g de protéines dans ce repas pour la récupération.'] : []),
          ...(elevated(input.bloodPressureCategory) && sodium >= 800 ? ['Repas assez salé : la prochaine fois, goûte avant de saler et préfère les herbes.'] : []),
        ],
        clarification: input.correction ? null : /caf[ée]|coffee/i.test(text) ? { question: 'Combien de sucres dans le café ?', options: ['Aucun', '1 sucre', '2 sucres'] } : null,
      };
      return analysis;
    },

    async draftPlan(input) {
      const { intentions: _i, overrides: _o, ...plan } = heuristicPlan(input.intentions, input.locale);
      if (elevated(input.bloodPressure?.category) && !plan.rules.some((r) => r.nutrient === 'sodium')) {
        plan.rules.push({ nutrient: 'sodium', kind: 'max', value: 2000, reason: 'OMS : moins de 5 g de sel par jour' });
      }
      return { ...plan, title: 'Moins de sucre, plus d’énergie', summary: 'On vise moins de 25 g de sucres ajoutés par jour, en s’attaquant aux réflexes de l’après-midi. Les calories restent au maintien.' };
    },

    async coach(input, onText) {
      const kcal = Math.round(input.today.totals.kcal);
      const sugar = Math.round(input.today.totals.addedSugar);
      const meal = mockMealAction(input);
      const transit = input.journal?.transit;
      // « pourquoi ? » right after a morning check-in: the reasoning behind it.
      const afterMorning = input.history.at(-2)?.content.startsWith('[Morning check-in') && /pourquoi|why/i.test(input.message);
      const night = input.life.sleep?.lastNight;
      const lower = input.recovery && input.recovery.status !== 'usual';
      const why = afterMorning
        ? input.locale === 'fr'
          ? `Parce que ta nuit a été plus courte que d’habitude${night ? ` (${Math.floor(night.asleepMin / 60)} h ${String(night.asleepMin % 60).padStart(2, '0')})` : ''} : après une nuit courte, la faim et l’envie de sucre montent souvent l’après-midi.${lower ? ' Ta récupération semble aussi un peu plus basse ce matin, d’où le « vas-y en douceur ».' : ''} Un en-cas protéiné prévu à l’avance t’évite de décider au moment où l’envie arrive.`
          : `Because your night was shorter than usual: after a short night, hunger and sugar cravings often rise in the afternoon.${lower ? ' Your recovery also seems a little lower this morning, hence the « go easy ».' : ''} A protein snack planned ahead saves you deciding when the craving hits.`
        : null;
      // A detailed answer, in the light Markdown the real coach writes: what the app's renderer is for.
      const detailed = /petit-d[ée]j|breakfast|d[ée]tail/i.test(input.message)
        ? input.locale === 'fr'
          ? `Oui, c'est un bon petit-déj 👍\n\n- **Sucre ajouté** : ${sugar} g sur 25, chocolat compris. C'est top pour ta glycémie.\n- **Protéines** : 29 g grâce aux œufs, une *bonne* base.\n- **Calories** : ${kcal} kcal, il te reste largement de quoi faire.\n\nDeux petites pistes pour la prochaine fois :\n1. **Plus de protéines** : un 3e œuf ou un skyr nature à côté, tu arrives vers 40 g.\n2. **Plus de fibres** : du pain complet, des tomates ou un fruit font vite monter ce chiffre.\n\nPour le déjeuner, vise environ 45 g de protéines et beaucoup de légumes.`
          : `Yes, that's a good breakfast 👍\n\n- **Added sugar**: ${sugar} g out of 25, chocolate included.\n- **Protein**: 29 g thanks to the eggs, a *good* base.\n- **Calories**: ${kcal} kcal, plenty left for the day.\n\nTwo small ideas for next time:\n1. **More protein**: a 3rd egg or a plain skyr on the side gets you near 40 g.\n2. **More fibre**: wholegrain bread, tomatoes or a fruit add up fast.\n\nFor lunch, aim for about 45 g of protein and lots of vegetables.`
        : null;
      const reply =
        meal?.reply ??
        why ??
        detailed ??
        (transit && /transit|ventre|selles|digest|bowel|gut/i.test(input.message)
          ? `D'après ton carnet, c'est environ ${String(transit.perDay).replace('.', ',')} passage par jour sur ${transit.days} jours. Pour un transit régulier, vise une trentaine de grammes de fibres et 1,5 L d'eau par jour, et bouge un peu après les repas.`
          : `Aujourd'hui tu es à ${kcal} kcal et ${sugar} g de sucres ajoutés. Pour ce soir, vise une assiette avec des protéines et des légumes, et garde un fruit pour le dessert.`);
      for (const word of reply.split(/(?<= )/)) {
        onText?.(word);
        await new Promise((r) => setTimeout(r, 40));
      }
      return {
        reply,
        planChange: /objectif|goal/i.test(input.message)
          ? { intentions: `${input.plan?.intentions ?? ''} Je veux aussi manger plus de fibres.`.trim(), rationale: 'Ajouter un repère fibres aide à la satiété et réduit les envies de sucre.' }
          : null,
        mealActions: meal ? [meal.action] : [],
      };
    },

    async cravingTip(input, onText, signal) {
      const what = input.what.toLowerCase();
      const alternative = /sal|chips|apéro/.test(what)
        ? 'Une poignée d’amandes ou quelques bâtonnets de carotte'
        : /soda|boisson/.test(what)
          ? 'Une eau pétillante avec une rondelle de citron'
          : /grignot/.test(what)
            ? 'Un yaourt nature avec quelques noix'
            : 'Un carré de chocolat noir 85 % et une poignée d’amandes';
      const tip = 'Bois un grand verre d’eau, puis sors marcher 5 minutes : l’envie retombe souvent en 10 minutes.';
      // Typed out only when someone reads it as it comes.
      if (onText) {
        for (const word of `${tip}\n${alternative}`.split(/(?<=[ \n])/)) {
          if (signal?.aborted) break;
          onText(word);
          await new Promise((r) => setTimeout(r, 30));
        }
      }
      return { tip, alternative };
    },

    async morning(input, onText) {
      const text = templateMorning(input);
      for (const word of text.split(/(?<=[ \n])/)) {
        onText?.(word);
        await new Promise((r) => setTimeout(r, 30));
      }
      return { text };
    },

    async cravingNudges(input) {
      const lead = input.locale === 'fr' ? `Un en-cas protéiné prêt pour ${input.cravingWindow.start.replace(':', ' h ')} ?` : `A protein snack ready for ${input.cravingWindow.start}?`;
      return { lines: [lead, ...FALLBACK_NUDGES[input.locale]] };
    },

    async review(input) {
      const sugar = Math.round(input.insights.averages.addedSugar);
      return {
        headline: `${input.insights.loggedDays} jours notés, ${sugar} g de sucres ajoutés par jour en moyenne.`,
        wins: ['Tu as noté tes repas régulièrement.'],
        patterns: ['Le sucre arrive surtout l’après-midi.'],
        nextSteps: ['Prépare un en-cas protéiné pour 16 h.'],
      };
    },
  };
}
