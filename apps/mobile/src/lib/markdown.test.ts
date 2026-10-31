import { describe, expect, it } from 'vitest';

import { flatten, parseInline, parseMarkdown, plainText, type Block } from './markdown';

const runsOf = (block: Block | undefined) => (block && 'runs' in block ? block.runs : []);

describe('parseInline', () => {
  it('keeps plain text as one run', () => {
    expect(parseInline('Bonne journée !')).toEqual([{ text: 'Bonne journée !' }]);
  });

  it('reads bold, italic, both, strikethrough and code', () => {
    expect(parseInline('**Sucre ajouté** : 3,3 g')).toEqual([{ text: 'Sucre ajouté', bold: true }, { text: ' : 3,3 g' }]);
    expect(parseInline('un *vrai* repas')).toEqual([{ text: 'un ' }, { text: 'vrai', italic: true }, { text: ' repas' }]);
    expect(parseInline('__gras__ et _penché_')).toEqual([{ text: 'gras', bold: true }, { text: ' et ' }, { text: 'penché', italic: true }]);
    expect(parseInline('***les deux***')).toEqual([{ text: 'les deux', bold: true, italic: true }]);
    expect(parseInline('~~soda~~ eau')).toEqual([{ text: 'soda', strike: true }, { text: ' eau' }]);
    expect(parseInline('la clé `kcal`')).toEqual([{ text: 'la clé ' }, { text: 'kcal', code: true }]);
  });

  it('nests emphasis', () => {
    expect(parseInline('**bold *it* end**')).toEqual([
      { text: 'bold ', bold: true },
      { text: 'it', bold: true, italic: true },
      { text: ' end', bold: true },
    ]);
    expect(parseInline('**gras *penché***')).toEqual([
      { text: 'gras ', bold: true },
      { text: 'penché', bold: true, italic: true },
    ]);
    expect(parseInline('*un **mot** ici*')).toEqual([
      { text: 'un ', italic: true },
      { text: 'mot', bold: true, italic: true },
      { text: ' ici', italic: true },
    ]);
  });

  it('pairs each bold with the next closer', () => {
    expect(parseInline('**a** puis **b**')).toEqual([{ text: 'a', bold: true }, { text: ' puis ' }, { text: 'b', bold: true }]);
  });

  it('leaves asterisks and underscores that are not emphasis', () => {
    expect(parseInline('2 * 3 = 6')).toEqual([{ text: '2 * 3 = 6' }]);
    expect(parseInline('snake_case_name')).toEqual([{ text: 'snake_case_name' }]);
    expect(parseInline('** rien **')).toEqual([{ text: '** rien **' }]);
    expect(parseInline('un **oubli')).toEqual([{ text: 'un **oubli' }]);
    expect(parseInline('\\*pas en italique\\*')).toEqual([{ text: '*pas en italique*' }]);
  });

  it('keeps emphasis across a line break of the same block', () => {
    expect(parseInline('**deux\nlignes**')).toEqual([{ text: 'deux\nlignes', bold: true }]);
  });

  it('turns links into their text, with an address only for http(s)', () => {
    expect(parseInline('voir [l’OMS](https://www.who.int) ici')).toEqual([{ text: 'voir ' }, { text: 'l’OMS', href: 'https://www.who.int' }, { text: ' ici' }]);
    expect(parseInline('[ici](javascript:alert(1))')).toEqual([{ text: '[ici](javascript:alert(1))' }]);
    expect(parseInline('[appel](tel:3114)')).toEqual([{ text: 'appel' }]);
    expect(parseInline('[**fort**](https://a.b)')).toEqual([{ text: 'fort', bold: true, href: 'https://a.b' }]);
  });

  describe('while streaming', () => {
    const streamed = (text: string) => parseInline(text, { streaming: true });

    it('styles an unclosed opener already, without showing it', () => {
      expect(streamed('**Sucre aj')).toEqual([{ text: 'Sucre aj', bold: true }]);
      expect(streamed('un *vr')).toEqual([{ text: 'un ' }, { text: 'vr', italic: true }]);
      expect(streamed('`kc')).toEqual([{ text: 'kc', code: true }]);
    });

    it('never shows half a closer, nor reads it as italic', () => {
      expect(streamed('**Sucre ajouté*')).toEqual([{ text: 'Sucre ajouté', bold: true }]);
      expect(streamed('**Sucre ajouté**')).toEqual([{ text: 'Sucre ajouté', bold: true }]);
    });

    it('hides a marker that is only starting', () => {
      expect(streamed('Bilan *')).toEqual([{ text: 'Bilan ' }]);
      expect(streamed('Bilan **')).toEqual([{ text: 'Bilan ' }]);
      expect(streamed('Bilan _')).toEqual([{ text: 'Bilan ' }]);
    });

    it('shows a link’s words before its address is complete', () => {
      expect(streamed('voir [l’OMS](https://www.wh')).toEqual([{ text: 'voir l’OMS' }]);
    });

    it('is the same as the finished text once everything is closed', () => {
      const text = '**Protéines** : 29 g grâce aux *œufs*.';
      expect(streamed(text)).toEqual(parseInline(text));
    });
  });
});

describe('parseMarkdown', () => {
  const reply = [
    'Oui, c’est un bon petit-déj 👍',
    '',
    '- **Sucre ajouté** : 3,3 g sur 25.',
    '- **Protéines** : 29 g grâce aux œufs.',
    '',
    'Deux petites pistes pour la prochaine fois :',
    '1. **Plus de protéines** : un 3e œuf.',
    '2. **Plus de fibres** : du pain complet.',
    '',
    'Pour le déjeuner, vise 45 g de protéines.',
  ].join('\n');

  it('reads the coach’s usual reply: paragraphs, bullets and a numbered list', () => {
    const blocks = parseMarkdown(reply);
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'list', 'paragraph', 'list', 'paragraph']);
    expect(blocks[1]).toEqual({
      type: 'list',
      items: [
        { number: null, depth: 0, runs: [{ text: 'Sucre ajouté', bold: true }, { text: ' : 3,3 g sur 25.' }] },
        { number: null, depth: 0, runs: [{ text: 'Protéines', bold: true }, { text: ' : 29 g grâce aux œufs.' }] },
      ],
    });
    expect(blocks[3]).toMatchObject({ type: 'list', items: [{ number: 1 }, { number: 2 }] });
  });

  it('keeps single line breaks inside a paragraph', () => {
    expect(parseMarkdown('Nuit de 6 h 10.\nHier : 18 g.')).toEqual([{ type: 'paragraph', runs: [{ text: 'Nuit de 6 h 10.\nHier : 18 g.' }] }]);
  });

  it('accepts *, + and • bullets, and numbers written with a parenthesis', () => {
    const blocks = parseMarkdown('* un\n+ deux\n• trois');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'list', items: [{ number: null }, { number: null }, { number: null }] });
    expect(parseMarkdown('1) un\n2) deux')[0]).toMatchObject({ items: [{ number: 1 }, { number: 2 }] });
  });

  it('numbers from the first item, whatever the following ones say', () => {
    expect(parseMarkdown('3. a\n3. b\n1. c')[0]).toMatchObject({ items: [{ number: 3 }, { number: 4 }, { number: 5 }] });
  });

  it('keeps a list whole across blank lines between its items', () => {
    const blocks = parseMarkdown('1. a\n\n2. b\n\n3. c');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ items: [{ number: 1 }, { number: 2 }, { number: 3 }] });
  });

  it('nests indented items, up to two levels', () => {
    const blocks = parseMarkdown('1. Matin\n   - œufs\n     - deux\n         - trop loin\n2. Midi');
    expect(blocks[0]).toMatchObject({
      items: [
        { number: 1, depth: 0 },
        { number: null, depth: 1 },
        { number: null, depth: 2 },
        { number: null, depth: 2 },
        { number: 2, depth: 0 },
      ],
    });
  });

  it('adds indented lines to the item above', () => {
    expect(parseMarkdown('- **Fibres** : 4 g.\n  Du pain complet aide.')[0]).toEqual({
      type: 'list',
      items: [{ number: null, depth: 0, runs: [{ text: 'Fibres', bold: true }, { text: ' : 4 g.\nDu pain complet aide.' }] }],
    });
  });

  it('starts a paragraph on an unindented line after a list', () => {
    expect(parseMarkdown('- a\nEnsuite.').map((b) => b.type)).toEqual(['list', 'paragraph']);
  });

  it('starts a new list when bullets follow numbers', () => {
    expect(parseMarkdown('1. a\n- b').map((b) => b.type)).toEqual(['list', 'list']);
  });

  it('lets a list follow a paragraph line directly', () => {
    expect(parseMarkdown('Deux pistes :\n- a\n- b').map((b) => b.type)).toEqual(['paragraph', 'list']);
  });

  it('reads headings, quotes and rules', () => {
    expect(parseMarkdown('## Ton bilan ##\nTout va bien.\n\n---\n> Une citation\n> sur deux lignes')).toEqual([
      { type: 'heading', runs: [{ text: 'Ton bilan' }] },
      { type: 'paragraph', runs: [{ text: 'Tout va bien.' }] },
      { type: 'rule' },
      { type: 'quote', runs: [{ text: 'Une citation\nsur deux lignes' }] },
    ]);
  });

  it('turns a table into readable lines', () => {
    expect(parseMarkdown('| Repas | kcal |\n|---|---:|\n| Midi | 640 |')).toEqual([{ type: 'paragraph', runs: [{ text: 'Repas · kcal\nMidi · 640' }] }]);
  });

  it('drops code fences but keeps their lines', () => {
    expect(parseMarkdown('```\n**pas du gras**\n```')).toEqual([{ type: 'paragraph', runs: [{ text: 'pas du gras', bold: true }] }]);
  });

  it('skips markers without words and empty input', () => {
    expect(parseMarkdown('- \n-\n1.\n#')).toEqual([]);
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('\n\n')).toEqual([]);
  });

  it('accepts Windows line endings', () => {
    expect(parseMarkdown('a\r\n\r\nb').map((b) => b.type)).toEqual(['paragraph', 'paragraph']);
  });

  it('treats a lone asterisk line as nothing, never as an empty bullet', () => {
    expect(parseMarkdown('Bilan\n*')).toEqual([{ type: 'paragraph', runs: [{ text: 'Bilan' }] }]);
  });

  describe('while streaming', () => {
    const streamed = (text: string) => parseMarkdown(text, { streaming: true });

    it('waits for a list item’s words before drawing it', () => {
      expect(streamed('Deux pistes :\n-')).toEqual([{ type: 'paragraph', runs: [{ text: 'Deux pistes :' }] }]);
      expect(streamed('Deux pistes :\n- ')).toEqual([{ type: 'paragraph', runs: [{ text: 'Deux pistes :' }] }]);
      expect(streamed('Deux pistes :\n1')).toEqual([{ type: 'paragraph', runs: [{ text: 'Deux pistes :' }] }]);
      expect(streamed('Deux pistes :\n1.')).toEqual([{ type: 'paragraph', runs: [{ text: 'Deux pistes :' }] }]);
    });

    it('waits for a heading, a rule or a bold line to show what it is', () => {
      expect(streamed('Fin.\n##')).toHaveLength(1);
      expect(streamed('Fin.\n--')).toHaveLength(1);
      expect(streamed('Fin.\n**')).toHaveLength(1);
    });

    it('styles the last item’s unclosed bold already', () => {
      expect(streamed('- **Sucre aj')).toEqual([{ type: 'list', items: [{ number: null, depth: 0, runs: [{ text: 'Sucre aj', bold: true }] }] }]);
    });

    it('only lets the block being written stay open', () => {
      const blocks = streamed('un **oubli\n\n**Prot');
      expect(runsOf(blocks[0])).toEqual([{ text: 'un **oubli' }]);
      expect(runsOf(blocks[1])).toEqual([{ text: 'Prot', bold: true }]);
    });

    it('gives the finished blocks at every step of a streamed reply', () => {
      // Character by character, no asterisk ever shows and no bullet is ever empty.
      for (let end = 1; end <= reply.length; end += 1) {
        const blocks = streamed(reply.slice(0, end));
        expect(plainOf(blocks)).not.toContain('*');
        for (const block of blocks) if (block.type === 'list') expect(block.items.every((item) => item.runs.length)).toBe(true);
      }
      expect(streamed(reply)).toEqual(parseMarkdown(reply));
    });
  });
});

/** Every word a set of blocks shows. */
function plainOf(blocks: Block[]): string {
  return blocks.map((block) => (block.type === 'list' ? block.items.flatMap((item) => item.runs) : runsOf(block)).map((run) => run.text).join('')).join('\n');
}

describe('plainText', () => {
  it('removes the marks for a notification or a screen reader', () => {
    expect(plainText('**Nuit de 6 h 10**, une heure de moins.\n\n- un\n  1. deux')).toBe('Nuit de 6 h 10, une heure de moins.\n• un\n  1. deux');
  });

  it('leaves plain text as it is', () => {
    expect(plainText('Bois un grand verre d’eau.')).toBe('Bois un grand verre d’eau.');
  });

  it('hides what is still being written when asked', () => {
    expect(plainText('Bois un verre **d’ea', { streaming: true })).toBe('Bois un verre d’ea');
  });
});

describe('flatten', () => {
  it('joins blocks with line breaks and keeps each run’s style', () => {
    expect(flatten(parseMarkdown('**Astuce** : marche.\n\n- eau'))).toEqual([
      { text: 'Astuce', bold: true },
      { text: ' : marche.' },
      { text: '\n' },
      { text: '• ' },
      { text: 'eau' },
    ]);
  });
});
