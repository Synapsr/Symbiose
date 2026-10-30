import type { Ai, AnalyzedItem, MealAnalysis } from './types';
import { heuristicPlan } from '../services/goals';

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
        tips: added > 15 ? ['Remplace la boisson sucrée par de l’eau pétillante citronnée.'] : [],
        clarification: input.correction ? null : /caf[ée]|coffee/i.test(text) ? { question: 'Combien de sucres dans le café ?', options: ['Aucun', '1 sucre', '2 sucres'] } : null,
      };
      return analysis;
    },

    async draftPlan(input) {
      const { intentions: _i, overrides: _o, ...plan } = heuristicPlan(input.intentions, input.locale);
      return { ...plan, title: 'Moins de sucre, plus d’énergie', summary: 'On vise moins de 25 g de sucres ajoutés par jour, en s’attaquant aux réflexes de l’après-midi. Les calories restent au maintien.' };
    },

    async coach(input, onText) {
      const kcal = Math.round(input.today.totals.kcal);
      const sugar = Math.round(input.today.totals.addedSugar);
      const reply = `Aujourd'hui tu es à ${kcal} kcal et ${sugar} g de sucres ajoutés. Pour ce soir, vise une assiette avec des protéines et des légumes, et garde un fruit pour le dessert.`;
      for (const word of reply.split(/(?<= )/)) {
        onText?.(word);
        await new Promise((r) => setTimeout(r, 40));
      }
      return {
        reply,
        planChange: /objectif|goal/i.test(input.message)
          ? { intentions: `${input.plan?.intentions ?? ''} Je veux aussi manger plus de fibres.`.trim(), rationale: 'Ajouter un repère fibres aide à la satiété et réduit les envies de sucre.' }
          : null,
      };
    },

    async cravingTip() {
      return { tip: 'Bois un grand verre d’eau, puis sors marcher 5 minutes : l’envie retombe souvent en 10 minutes.', alternative: 'Un carré de chocolat noir 85 % et une poignée d’amandes' };
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
