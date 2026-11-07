/**
 * The report's pages, laid out here rather than by the print engine: every
 * block knows its height, so pages break where they should (never a heading
 * alone at the bottom, a table goes on with its header), and every page gets
 * its header and its « 2 / 9 » footer, the same on iOS, Android and the web.
 * Sizes are CSS pixels of an A4 page (96 per inch).
 */

export const PAGE = { width: 793, height: 1121, padX: 46, padTop: 34, padBottom: 26 } as const;
export const CONTENT_WIDTH = PAGE.width - 2 * PAGE.padX;
/** The running header of every page but the first, and the space under it. */
export const HEADER_HEIGHT = 24;
export const HEADER_GAP = 20;
export const FOOTER_HEIGHT = 16;
export const FOOTER_GAP = 14;
/** Between two blocks of a page. */
export const GAP = 14;
/** Before a section's heading. */
export const SECTION_GAP = 34;
/** Under a small heading. */
export const TIGHT_GAP = 6;

export const FIRST_PAGE_HEIGHT = PAGE.height - PAGE.padTop - PAGE.padBottom - FOOTER_HEIGHT - FOOTER_GAP;
export const PAGE_HEIGHT = FIRST_PAGE_HEIGHT - HEADER_HEIGHT - HEADER_GAP;

export interface RenderContext {
  /** The page a section starts on, from 1. */
  pageOf: (anchor: string) => number | undefined;
}

export interface Block {
  /** Drawn at exactly this height. */
  height: number;
  html: string | ((ctx: RenderContext) => string);
  /** Space before it on its page (none at the top of a page). */
  gapBefore?: number;
  /** A heading (or a heading and its key figures): moved to the next page with what follows rather than left at the bottom. */
  keepWithNext?: boolean;
  /** A small heading: what follows sits close under it. */
  tightAfter?: boolean;
  /** Starts on a new page. */
  pageBreak?: boolean;
  /** The section it opens, for the contents on the first page. */
  anchor?: string;
  /** The smallest piece of it that may start a page's last lines (a table: its header and two rows). */
  minHeight?: number;
  /** The part that fits in `available`, and the rest; null when nothing worth printing fits. */
  split?: (available: number) => [Block, Block] | null;
}

export interface Page {
  blocks: { block: Block; gap: number }[];
}

/** Blocks into pages: the first page has no running header, so it holds a little more. */
export function paginate(blocks: readonly Block[], first = FIRST_PAGE_HEIGHT, other = PAGE_HEIGHT): Page[] {
  const pages: Page[] = [{ blocks: [] }];
  let used = 0;
  const capacity = () => (pages.length === 1 ? first : other);
  const page = () => pages.at(-1)!;
  const newPage = () => {
    pages.push({ blocks: [] });
    used = 0;
  };
  const gapFor = (block: Block) => {
    const previous = page().blocks.at(-1)?.block;
    if (!previous) return 0;
    return previous.tightAfter ? TIGHT_GAP : (block.gapBefore ?? GAP);
  };
  const add = (block: Block) => {
    const gap = gapFor(block);
    page().blocks.push({ block, gap });
    used += gap + block.height;
  };

  const queue = [...blocks];
  while (queue.length) {
    const block = queue.shift()!;
    if (block.pageBreak && page().blocks.length) newPage();
    const left = capacity() - used - gapFor(block);
    if (block.keepWithNext && page().blocks.length) {
      // A heading, the blocks chained to it, and the start of what they introduce go together.
      let needed = block.height;
      for (const next of queue) {
        needed += (block.tightAfter ? TIGHT_GAP : GAP) + (next.keepWithNext ? next.height : (next.minHeight ?? next.height));
        if (!next.keepWithNext) break;
      }
      if (needed > left && needed <= capacity()) newPage();
    }
    const room = capacity() - used - gapFor(block);
    if (block.height <= room) {
      add(block);
      continue;
    }
    const parts = block.split?.(room) ?? null;
    if (parts) {
      add(parts[0]);
      newPage();
      queue.unshift(parts[1]);
      continue;
    }
    if (page().blocks.length) {
      newPage();
      queue.unshift({ ...block, gapBefore: 0 });
      continue;
    }
    // Taller than a page and unsplittable: printed as is (never the case for the report's own blocks).
    add(block);
  }
  return pages.filter((p) => p.blocks.length);
}

// ---------------------------------------------------------------- Text

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Text from the person or the AI, safe inside HTML. */
export function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c]!);
}

/** Rough advance of a character, in em, for a system sans: generous, so text measured never overflows its box. */
function charEm(c: string): number {
  if (c === ' ') return 0.28;
  if ('iljtfr.,;:!|\'’()[]'.includes(c)) return 0.33;
  if ('mwMW@%'.includes(c)) return 0.9;
  if (c >= '0' && c <= '9') return 0.6;
  if (c !== c.toLowerCase()) return 0.7;
  return 0.56;
}

/** Width of a single line of text, in px. */
export function textWidth(text: string, fontPx: number): number {
  let em = 0;
  for (const c of text) em += charEm(c);
  return em * fontPx;
}

/** How many lines `text` takes in a box `width` wide, wrapping at spaces (with some slack: real fonts differ). */
export function lineCount(text: string, boxWidth: number, fontPx: number): number {
  const width = boxWidth * 0.92;
  let lines = 0;
  for (const paragraph of text.split('\n')) {
    lines++;
    let line = 0;
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const w = textWidth(word, fontPx);
      const space = line ? textWidth(' ', fontPx) : 0;
      if (line && line + space + w > width) {
        lines++;
        line = w;
      } else line += space + w;
      // A word longer than the line breaks anywhere.
      while (line > width) {
        lines++;
        line -= width;
      }
    }
  }
  return Math.max(1, lines);
}

/** A paragraph of at most `maxLines`, at the height it takes. */
export function paragraph(text: string, options: { width?: number; size?: number; lineHeight?: number; maxLines?: number; className?: string; html?: string } = {}): Block {
  const { width = CONTENT_WIDTH, size = 12, lineHeight = Math.round(size * 1.45), maxLines = 40, className = 'p' } = options;
  const lines = Math.min(maxLines, lineCount(text, width, size));
  return {
    height: lines * lineHeight,
    html: `<div class="${className}" style="width:${width}px;font-size:${size}px;line-height:${lineHeight}px;height:${lines * lineHeight}px;-webkit-line-clamp:${lines}">${options.html ?? esc(text)}</div>`,
  };
}

// ---------------------------------------------------------------- Tables

export interface Column {
  /** px; the columns of a table add up to its width. */
  width: number;
  label: string;
  align?: 'left' | 'right' | 'center';
}

export interface Row {
  /** One HTML cell per column. */
  cells: string[];
  height?: number;
  className?: string;
  /** A group's heading row (a day): never the last row of a page. */
  keepWithNext?: boolean;
  /** Its first cell spans this many columns (a day's date over the time and the meal). */
  span?: number;
}

export const TABLE_HEAD = 24;
export const TABLE_ROW = 20;

function rowHtml(columns: readonly Column[], cells: readonly string[], height: number, className: string, span = 1): string {
  const first = columns.slice(0, span).reduce((sum, col) => sum + col.width, 0);
  const tds = [
    `<div class="td ${columns[0]!.align ?? 'left'}" style="width:${first}px">${cells[0] ?? ''}</div>`,
    ...columns.slice(span).map((col, i) => `<div class="td ${col.align ?? 'left'}" style="width:${col.width}px">${cells[i + 1] ?? ''}</div>`),
  ].join('');
  return `<div class="tr ${className}" style="height:${height}px">${tds}</div>`;
}

/**
 * A table of fixed rows, split across pages: each part keeps the column
 * header, and a group's heading row never ends a page.
 */
export function table(columns: readonly Column[], rows: readonly Row[], options: { head?: boolean; minRows?: number } = {}): Block {
  const head = options.head ?? true;
  const headHeight = head ? TABLE_HEAD : 0;
  const minRows = Math.min(rows.length, options.minRows ?? 2);
  const height = headHeight + rows.reduce((sum, row) => sum + (row.height ?? TABLE_ROW), 0);
  const html = () => {
    const header = head ? rowHtml(columns, columns.map((c) => esc(c.label)), TABLE_HEAD, 'th') : '';
    return `<div class="table">${header}${rows.map((row) => rowHtml(columns, row.cells, row.height ?? TABLE_ROW, row.className ?? '', row.span)).join('')}</div>`;
  };
  const firstRows = rows.slice(0, minRows).reduce((sum, row) => sum + (row.height ?? TABLE_ROW), 0);
  return {
    height,
    html: html(),
    minHeight: headHeight + firstRows,
    split: (available) => {
      let used = headHeight;
      let count = 0;
      while (count < rows.length && used + (rows[count]!.height ?? TABLE_ROW) <= available) used += rows[count++]!.height ?? TABLE_ROW;
      while (count > 0 && rows[count - 1]!.keepWithNext) count--;
      if (count < minRows || count >= rows.length) return null;
      return [table(columns, rows.slice(0, count), { head, minRows: 0 }), table(columns, rows.slice(count), { head, minRows })];
    },
  };
}

/**
 * A long list of short rows (weigh-ins, readings) in side-by-side groups of
 * columns, read down then across, so a page holds two or three times as many.
 */
export function columnsTable(columns: readonly Column[], rows: readonly string[][], groups: number, gutter = 24): Block {
  const groupWidth = columns.reduce((sum, c) => sum + c.width, 0);
  const width = groups * groupWidth + (groups - 1) * gutter;
  const perGroup = (count: number) => Math.ceil(count / groups);
  const render = (list: readonly string[][]) => {
    const per = perGroup(list.length);
    const parts = Array.from({ length: groups }, (_, g) => {
      const slice = list.slice(g * per, (g + 1) * per);
      if (!slice.length && g > 0) return `<div style="width:${groupWidth}px"></div>`;
      const header = rowHtml(columns, columns.map((c) => esc(c.label)), TABLE_HEAD, 'th');
      return `<div class="table" style="width:${groupWidth}px">${header}${slice.map((cells) => rowHtml(columns, cells, TABLE_ROW, '')).join('')}</div>`;
    });
    return `<div class="cols" style="width:${width}px;gap:${gutter}px">${parts.join('')}</div>`;
  };
  const make = (list: readonly string[][]): Block => ({
    height: TABLE_HEAD + perGroup(list.length) * TABLE_ROW,
    html: render(list),
    minHeight: TABLE_HEAD + Math.min(perGroup(list.length), 3) * TABLE_ROW,
    split: (available) => {
      const fit = Math.floor((available - TABLE_HEAD) / TABLE_ROW);
      if (fit < 3 || fit * groups >= list.length) return null;
      return [make(list.slice(0, fit * groups)), make(list.slice(fit * groups))];
    },
  });
  return make(rows);
}

// ---------------------------------------------------------------- Pieces

/** Several blocks side by side, as tall as the tallest. */
export function sideBySide(parts: readonly Block[], gutter = 24): Block {
  const height = Math.max(...parts.map((p) => p.height));
  return {
    height,
    html: (ctx) => `<div class="row" style="gap:${gutter}px;height:${height}px">${parts.map((p) => (typeof p.html === 'string' ? p.html : p.html(ctx))).join('')}</div>`,
  };
}

/** Blocks stacked as one, kept on the same page. */
export function stack(parts: readonly Block[], gap = 8): Block {
  const height = parts.reduce((sum, p) => sum + p.height, 0) + gap * Math.max(0, parts.length - 1);
  return {
    height,
    html: (ctx) => `<div class="stack" style="gap:${gap}px;height:${height}px">${parts.map((p) => (typeof p.html === 'string' ? p.html : p.html(ctx))).join('')}</div>`,
  };
}

/** A block at a fixed width, for a side-by-side row. */
export function sized(block: Block, width: number): Block {
  return {
    ...block,
    html: (ctx) => `<div style="width:${width}px;height:${block.height}px;flex:none">${typeof block.html === 'string' ? block.html : block.html(ctx)}</div>`,
  };
}

export function renderBlock(block: Block, ctx: RenderContext): string {
  return typeof block.html === 'string' ? block.html : block.html(ctx);
}
