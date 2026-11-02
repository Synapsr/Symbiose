import { describe, expect, it } from 'vitest';

import { captionTail } from './photo-words-logic';

describe('the caption over the viewfinder', () => {
  it('shows short words as they are, tidied', () => {
    expect(captionTail('C’est du riz complet, pas blanc')).toBe('C’est du riz complet, pas blanc');
    expect(captionTail('  Sans sucre \n dans le café ')).toBe('Sans sucre dans le café');
    expect(captionTail('')).toBe('');
  });

  it('keeps the end of a long description, from a whole word', () => {
    const said = 'C’est un bol de riz complet avec du tofu sauté, des brocolis vapeur et une sauce soja, sans sucre ajouté, et j’en ai laissé la moitié';
    const shown = captionTail(said, 60);
    expect(shown.startsWith('…')).toBe(true);
    expect(said.endsWith(shown.slice(1))).toBe(true);
    expect(shown.length).toBeLessThanOrEqual(61);
    // From a word's start: the character before it in the full text is a space.
    expect(said[said.length - shown.length]).toBe(' ');
  });

  it('cuts inside one very long word rather than show nothing', () => {
    const shown = captionTail(`a ${'x'.repeat(80)}`, 40);
    expect(shown).toBe(`…${'x'.repeat(40)}`);
  });
});
