/**
 * Shared text helpers for the PDF documents TicketPro writes by hand (tickets,
 * invoices): standard Helvetica fonts in WinAnsiEncoding, so French accents
 * print as such, and AFM widths to measure and align text.
 */
export function escapePdfString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    // WinAnsi bytes above 126 are written as octal escapes: the file stays
    // ASCII while é, à, ç… keep their glyph.
    .replace(/[\x80-\xFF]/g, (character) => `\\${character.charCodeAt(0).toString(8).padStart(3, "0")}`);
}

export function fixed(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/**
 * Text is written with the standard Helvetica fonts in WinAnsiEncoding, so
 * French accents (é, è, à, ç…) print as such. Characters outside Latin-1 are
 * replaced by their closest equivalent or removed.
 */
export function normalizePdfText(value: string): string {
  return value
    .normalize("NFC")
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\u2026/g, "...")
    .split("")
    .map((character) => character.charCodeAt(0) <= 0xff
      ? character
      : character.normalize("NFD").replace(/[\u0300-\u036f]/g, ""))
    .join("")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "")
    .trim();
}

// Helvetica and Helvetica-Bold advance widths (Adobe AFM, 1/1000 em) for
// ASCII 32-126. Accented letters use the width of their base letter.
const helveticaWidths = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const helveticaBoldWidths = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

function characterWidth(character: string, isBold: boolean): number {
  const code = character.charCodeAt(0);
  const table = isBold ? helveticaBoldWidths : helveticaWidths;
  if (code >= 32 && code <= 126) return table[code - 32];
  const base = character.normalize("NFD").charCodeAt(0);
  if (base >= 32 && base <= 126) return table[base - 32];
  return 556;
}

export function estimateTextWidth(value: string, size: number, isBold: boolean): number {
  let total = 0;
  for (const character of value) total += characterWidth(character, isBold);
  return (total * size) / 1000;
}

export function textWidth(value: string, size: number, isBold: boolean): number {
  return estimateTextWidth(normalizePdfText(value), size, isBold);
}
