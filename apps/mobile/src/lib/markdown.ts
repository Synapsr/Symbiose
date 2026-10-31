/**
 * The light Markdown the AI writes (bold, italic, lists, paragraphs, the odd heading), read into
 * blocks of styled runs that the app draws in its own type. Forgiving, because replies arrive token
 * by token: while one is being written, an unclosed `**` is already bold and a list marker waits
 * for its words, so no raw asterisk flickers on screen.
 */

export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  /** An http(s) link's address; any other link stays plain text. */
  href?: string;
}

export interface ListItem {
  /** Its number in an ordered list, null for a bullet. */
  number: number | null;
  /** 0 at the top level, up to 2 when nested. */
  depth: number;
  runs: Run[];
}

export type Block =
  | { type: 'paragraph'; runs: Run[] }
  | { type: 'heading'; runs: Run[] }
  | { type: 'quote'; runs: Run[] }
  | { type: 'list'; items: ListItem[] }
  | { type: 'rule' };

export interface ParseOptions {
  /** The text is still being written: its end may be half a marker. */
  streaming?: boolean;
}

const MAX_DEPTH = 2;

const HEADING = /^\s{0,3}#{1,6}(?:\s+(.*?))?(?:\s+#+)?\s*$/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const BULLET = /^(\s*)[-*+•]\s+(.*)$/;
const ORDERED = /^(\s*)(\d{1,3})[.)]\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const FENCE = /^\s*(```|~~~)/;
/** A list marker with no words, kept out of the way rather than drawn as an empty item. */
const BARE_MARKER = /^\s*([-*+•]|\d{1,3}[.)])\s*$/;
/** The end of a reply being written, when it is still only the start of a marker (`-`, `1`, `##`, `**`…). */
const PENDING_TAIL = /^\s*([-*+•]|\d{1,3}[.)]?|#{1,6}|>|`{1,3}|~{1,3}|[-*_]{2,}|\|)\s*$/;

/** Columns of a line's leading whitespace, a tab counting as 4. */
function indentOf(line: string): number {
  let columns = 0;
  for (const char of line) {
    if (char === ' ') columns += 1;
    else if (char === '\t') columns += 4;
    else break;
  }
  return columns;
}

/** A table row as one readable line: « Repas · kcal ». */
function tableRow(line: string): string | null {
  const match = /^\s*\|(.*?)\|?\s*$/.exec(line);
  if (!match) return null;
  return match[1]!
    .split('|')
    .map((cell) => cell.trim())
    .filter(Boolean)
    .join(' · ');
}

const isTableSeparator = (line: string) => line.includes('|') && line.includes('-') && /^[\s|:-]+$/.test(line);

type Draft = { type: 'paragraph' | 'heading' | 'quote'; text: string } | { type: 'list'; items: { number: number | null; depth: number; text: string }[] } | { type: 'rule' };

/** Reads Markdown into blocks. */
export function parseMarkdown(source: string, { streaming = false }: ParseOptions = {}): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  if (streaming && PENDING_TAIL.test(lines.at(-1) ?? '')) lines.pop();

  const drafts: Draft[] = [];
  let open = null as Draft | null; // the block that the next line may continue
  let gap = false; // a blank line since the last one
  let fenced = false;
  // The open list's indentation per depth, and its numbering per depth.
  let indents: number[] = [];
  let numbers: (number | null)[] = [];

  const start = (draft: Draft) => {
    drafts.push(draft);
    open = draft;
    gap = false;
  };

  for (const raw of lines) {
    if (FENCE.test(raw)) {
      fenced = !fenced;
      continue;
    }
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) {
      if (open?.type !== 'list') open = null;
      gap = true;
      continue;
    }
    if (!fenced) {
      const heading = HEADING.exec(line);
      if (heading) {
        start({ type: 'heading', text: heading[1] ?? '' });
        open = null;
        continue;
      }
      if (RULE.test(line)) {
        start({ type: 'rule' });
        open = null;
        continue;
      }
      if (BARE_MARKER.test(line) || isTableSeparator(line)) continue;

      const bullet = BULLET.exec(line);
      const ordered = bullet ? null : ORDERED.exec(line);
      if (bullet || ordered) {
        const indent = indentOf(line);
        const written = ordered ? Number(ordered[2]) : null;
        const text = (bullet ? bullet[2]! : ordered![3]!).trim();
        let list = open?.type === 'list' ? open : null;
        // A new top-level kind of list (bullets after numbers) starts a new list.
        if (list && indent <= (indents[0] ?? 0) + 1 && (numbers[0] === null) !== (written === null)) list = null;
        if (!list) {
          list = { type: 'list', items: [] };
          start(list);
          indents = [];
          numbers = [];
        }
        let depth = indents.findIndex((columns) => indent <= columns + 1);
        if (depth === -1) {
          indents.push(indent);
          depth = indents.length - 1;
        } else {
          indents.length = depth + 1;
          numbers.length = Math.min(numbers.length, depth + 1);
        }
        const previous = numbers[depth];
        const number = written === null ? null : previous != null ? previous + 1 : written;
        numbers[depth] = number;
        list.items.push({ number, depth: Math.min(depth, MAX_DEPTH), text });
        gap = false;
        continue;
      }

      const quote = QUOTE.exec(line);
      if (quote) {
        if (open?.type === 'quote' && !gap) open.text += `\n${quote[1]!.trim()}`;
        else start({ type: 'quote', text: quote[1]!.trim() });
        continue;
      }
    }

    const text = (fenced ? null : tableRow(line)) ?? line.trim();
    const current: Draft | null = open;
    // Indented under a list item: more of that item.
    if (current?.type === 'list' && indentOf(line) >= 2) {
      const item = current.items.at(-1)!;
      item.text += `\n${text}`;
      gap = false;
      continue;
    }
    if (current?.type === 'paragraph' && !gap) {
      current.text += `\n${text}`;
      continue;
    }
    start({ type: 'paragraph', text });
  }

  return drafts.flatMap((draft, index): Block[] => {
    // Only the block being written may end on an unclosed marker.
    const writing = streaming && index === drafts.length - 1;
    switch (draft.type) {
      case 'rule':
        return [draft];
      case 'list': {
        const items = draft.items
          .map((item, at, all) => ({ number: item.number, depth: item.depth, runs: parseInline(item.text, { streaming: writing && at === all.length - 1 }) }))
          .filter((item) => item.runs.length);
        return items.length ? [{ type: 'list', items }] : [];
      }
      default: {
        const runs = parseInline(draft.text, { streaming: writing });
        return runs.length ? [{ type: draft.type, runs }] : [];
      }
    }
  });
}

// ---------------------------------------------------------------- Inline

type Style = Omit<Run, 'text'>;

const WORD = /[\p{L}\p{N}]/u;
const SPACE = /\s/;
const ESCAPABLE = /[\\`*_{}[\]()#+\-.!~|>]/;
const LINK = /^\[([^\]\n]*)\]\(([^()\s]*)\)/;
const HALF_LINK = /^\[([^\]\n]*)\](\([^()\s]*)?$/;

const safeHref = (href: string) => (/^https?:\/\/\S+$/i.test(href) ? href : undefined);

function runLength(text: string, at: number, char: string): number {
  let end = at;
  while (text[end] === char) end += 1;
  return end - at;
}

/** Where the run closing an emphasis of `size` opened just before `from` is, or -1. */
function findCloser(text: string, from: number, char: string, size: number): number {
  for (let at = from; at < text.length; at += 1) {
    if (text[at] !== char || text[at - 1] === char) continue;
    const length = runLength(text, at, char);
    const before = text[at - 1] ?? ' ';
    const after = text[at + length] ?? ' ';
    const fits = length === size || length >= 3;
    const flanking = !SPACE.test(before) && (char !== '_' || !WORD.test(after));
    if (fits && flanking && length >= size) return at + length - size;
    at += length - 1;
  }
  return -1;
}

const EMPHASIS: Record<number, Style> = { 1: { italic: true }, 2: { bold: true }, 3: { bold: true, italic: true } };

function walk(text: string, style: Style, writing: boolean, out: Run[]) {
  let buffer = '';
  const flush = () => {
    if (buffer) out.push({ ...style, text: buffer });
    buffer = '';
  };

  let at = 0;
  while (at < text.length) {
    const char = text[at]!;

    if (char === '\\' && ESCAPABLE.test(text[at + 1] ?? '')) {
      buffer += text[at + 1];
      at += 2;
      continue;
    }

    if (char === '`') {
      const size = runLength(text, at, '`');
      const close = text.indexOf('`'.repeat(size), at + size);
      if (close !== -1 && close > at + size) {
        flush();
        out.push({ ...style, code: true, text: text.slice(at + size, close) });
        at = close + size;
        continue;
      }
      if (writing) {
        flush();
        const rest = text.slice(at + size);
        if (rest) out.push({ ...style, code: true, text: rest });
        return;
      }
      buffer += text.slice(at, at + size);
      at += size;
      continue;
    }

    if (char === '[') {
      const link = LINK.exec(text.slice(at));
      if (link) {
        flush();
        walk(link[1]!, { ...style, href: safeHref(link[2]!) }, false, out);
        at += link[0].length;
        continue;
      }
      const half = writing ? HALF_LINK.exec(text.slice(at)) : null;
      if (half) {
        flush();
        walk(half[1]!, style, false, out);
        return;
      }
    }

    if (char === '*' || char === '_' || char === '~') {
      const length = runLength(text, at, char);
      const after = text[at + length];
      const canOpen = after !== undefined && !SPACE.test(after) && (char !== '_' || !WORD.test(text[at - 1] ?? ' '));
      if (char === '~' ? length === 2 && canOpen : canOpen) {
        // `***` may close as one, two or three; `**` only as bold, so a half-written closer never reads as italic.
        const sizes = char === '~' ? [2] : length >= 3 ? [3, 2, 1] : [length];
        const styleOf = (size: number): Style => ({ ...style, ...(char === '~' ? { strike: true } : EMPHASIS[size]) });
        const size = sizes.find((candidate) => findCloser(text, at + candidate + 1, char, candidate) !== -1);
        if (size !== undefined) {
          const close = findCloser(text, at + size + 1, char, size);
          flush();
          walk(text.slice(at + size, close), styleOf(size), false, out);
          at = close + size;
          continue;
        }
        if (writing) {
          // Not closed yet: what follows is already styled, and the marker stays hidden.
          flush();
          walk(text.slice(at + sizes[0]!), styleOf(sizes[0]!), true, out);
          return;
        }
      } else if (writing && after === undefined) {
        // A marker at the very end of a reply being written: maybe the start of `**`.
        at += length;
        continue;
      }
      buffer += text.slice(at, at + length);
      at += length;
      continue;
    }

    buffer += char;
    at += 1;
  }
  flush();
}

const sameStyle = (a: Run, b: Run) => a.bold === b.bold && a.italic === b.italic && a.strike === b.strike && a.code === b.code && a.href === b.href;

/** Reads one block's text into styled runs. */
export function parseInline(text: string, { streaming = false }: ParseOptions = {}): Run[] {
  const runs: Run[] = [];
  walk(text, {}, streaming, runs);
  const merged: Run[] = [];
  for (const run of runs) {
    const last = merged.at(-1);
    if (last && sameStyle(last, run)) last.text += run.text;
    else merged.push({ ...run });
  }
  // Clean runs: no `undefined` style keys, no empty text.
  return merged
    .filter((run) => run.text)
    .map((run) => Object.fromEntries(Object.entries(run).filter(([, value]) => value !== undefined && value !== false)) as unknown as Run);
}

/** Blocks as one run of lines, for a line of text with no room for blocks: list items keep a « • » or their number. */
export function flatten(blocks: Block[]): Run[] {
  const lines = blocks.flatMap((block): Run[][] => {
    switch (block.type) {
      case 'rule':
        return [];
      case 'list':
        return block.items.map((item) => [{ text: `${'  '.repeat(item.depth)}${item.number === null ? '•' : `${item.number}.`} ` }, ...item.runs]);
      default:
        return [block.runs];
    }
  });
  return lines.flatMap((runs, index) => (index ? [{ text: '\n' }, ...runs] : runs));
}

/** The words without their Markdown: for a notification, a screen reader or a text field. */
export function plainText(source: string, options?: ParseOptions): string {
  return flatten(parseMarkdown(source, options))
    .map((run) => run.text)
    .join('');
}
