import { describe, expect, it } from 'vitest';

import { dictated, speechLocale } from './dictation-logic';

describe('dictated text', () => {
  it('fills an empty field, capitalised', () => {
    expect(dictated('', [], 'un bol de pâtes')).toBe('Un bol de pâtes');
    expect(dictated('  ', [], 'un bol')).toBe('Un bol');
  });

  it('leaves the field alone until something is heard', () => {
    expect(dictated('Pâtes', [], '')).toBe('Pâtes');
    expect(dictated('Pâtes', [], '   ')).toBe('Pâtes');
  });

  it('continues what was typed with one space', () => {
    expect(dictated('Pâtes carbonara et', [], 'une salade')).toBe('Pâtes carbonara et une salade');
    expect(dictated('Pâtes carbonara ', [], 'et une salade')).toBe('Pâtes carbonara et une salade');
    expect(dictated('Ce matin :\n', [], 'café')).toBe('Ce matin :\ncafé');
  });

  it('starts a new sentence after a full stop', () => {
    expect(dictated('Bien dormi.', [], 'un peu fatigué')).toBe('Bien dormi. Un peu fatigué');
    expect(dictated('Bien dormi ! ', [], 'un peu fatigué')).toBe('Bien dormi ! Un peu fatigué');
  });

  it('joins the stretches of a long dictation, whatever their spacing', () => {
    expect(dictated('', ['Ce midi des pâtes'], '')).toBe('Ce midi des pâtes');
    expect(dictated('', ['Ce midi des pâtes', ' et un yaourt'], 'nature')).toBe('Ce midi des pâtes et un yaourt nature');
    expect(dictated('Note', ['un', 'deux '], ' trois')).toBe('Note un deux trois');
  });
});

describe('speech locale', () => {
  it('follows the device region for the app language', () => {
    expect(speechLocale('fr', ['fr-BE', 'en-US'])).toBe('fr-BE');
    expect(speechLocale('en', ['fr-FR', 'en-GB'])).toBe('en-GB');
  });

  it('falls back to France or the US', () => {
    expect(speechLocale('fr', ['en-US'])).toBe('fr-FR');
    expect(speechLocale('en', [])).toBe('en-US');
    expect(speechLocale('fr', ['fr'])).toBe('fr-FR');
  });
});
