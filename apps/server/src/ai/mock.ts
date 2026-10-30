import { BloodPressureCategorySchema, type BloodPressureCategory, type CoachMealProposal } from '@symbiose/shared';

import type { Ai, AnalyzedItem, CoachInput, MealAnalysis } from './types';
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
];

const DEFAULT_PLATE: AnalyzedItem[] = [
  { name: 'Poulet rôti', emoji: '🍗', portion: '1 cuisse', grams: 150, confidence: 0.7, per100g: { kcal: 215, protein: 26, carbs: 0, sugar: 0, addedSugar: 0, fat: 12, satFat: 3.4, fiber: 0, sodium: 330 } },
  { name: 'Riz basmati', emoji: '🍚', portion: '1 portion', grams: 180, confidence: 0.65, per100g: { kcal: 130, protein: 2.7, carbs: 28, sugar: 0.1, addedSugar: 0, fat: 0.3, satFat: 0.1, fiber: 0.4, sodium: 1 } },
  { name: 'Haricots verts', emoji: '🫛', portion: '1 poignée', grams: 100, confidence: 0.8, per100g: { kcal: 31, protein: 1.8, carbs: 4.3, sugar: 1.4, addedSugar: 0, fat: 0.2, satFat: 0, fiber: 3.4, sodium: 6 } },
];

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

    async analyzeMeal(input) {
      await new Promise((r) => setTimeout(r, 1200));
      const text = `${input.text ?? ''} ${input.correction ?? ''}`;
      let items = FOODS.filter((f) => f.match.test(text)).map((f) => f.item);
      if (!items.length) items = input.previous ? input.previous.items.map(({ name, emoji, portion, grams, confidence, per100g }) => ({ name, emoji, portion, grams, confidence: confidence ?? 0.7, per100g })) : DEFAULT_PLATE;
      if (/sans sucre|no sugar|pas de sucre/i.test(text)) items = items.map((i) => ({ ...i, per100g: { ...i.per100g, sugar: i.per100g.sugar - i.per100g.addedSugar, addedSugar: 0, kcal: i.per100g.kcal - i.per100g.addedSugar * 4 } }));
      const added = items.reduce((sum, i) => sum + (i.per100g.addedSugar * i.grams) / 100, 0);
      const sodium = items.reduce((sum, i) => sum + (i.per100g.sodium * i.grams) / 100, 0);
      const analysis: MealAnalysis = {
        isFood: true,
        title: items.length === 1 ? items[0]!.name : items.slice(0, 2).map((i) => i.name).join(' & '),
        mealType: input.mealTypeHint,
        items,
        verdict: added > 15 ? 'watch' : added > 5 ? 'ok' : 'great',
        headline:
          added > 5
            ? `≈${Math.round(added)} g de sucres ajoutés dans ce repas.`
            : 'Repas équilibré, presque sans sucre ajouté. Bien joué.',
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
      const reply =
        meal?.reply ??
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

    async cravingTip() {
      return { tip: 'Bois un grand verre d’eau, puis sors marcher 5 minutes : l’envie retombe souvent en 10 minutes.', alternative: 'Un carré de chocolat noir 85 % et une poignée d’amandes' };
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
      const lead = input.locale === 'fr' ? `Vers ${input.cravingWindow.start.replace(':', ' h ')}, ton créneau sucré : un en-cas protéiné prêt ?` : `Around ${input.cravingWindow.start}, your sugar slot: a protein snack ready?`;
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
