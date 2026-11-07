/** A number and its unit, or the groups of a number (« 1 840 »), never split across lines. */
const UNIT = /(\d) (?=(?:\d{3}(?!\d)|(?:g|kg|mg|µg|kcal|ml|cl|L|l|%|min|h|s|km|m|pas|mmHg|bpm|°C)(?![\p{L}\d])))/gu;

/**
 * French typography, for every text Symbiose shows or prints (copy, AI and the person's own words):
 * a no-break `space` before « ? ! : ; » and inside guillemets, so a mark never ends up alone at the
 * start of a line, and between a number and its unit.
 */
export function frenchTypography(text: string, space: string): string {
  return text
    .replace(/ ([?!:;»])/g, `${space}$1`)
    .replace(/« /g, `«${space}`)
    .replace(UNIT, `$1${space}`);
}
