import { parseGermanInput, type ParsedTerm } from '../german/parseTerm';

/**
 * Parser for pasted vocabulary lists:
 *   Quizlet export ("Export → Copy text"): term<TAB>definition, one per line
 *   Bulk lists: "Haus - house", "der Tisch, table", custom separators.
 */

export interface ImportOptions {
  /** Between German term and translation: '\t', ',', ' - ', or any custom string. */
  termSep: string;
  /** Between rows: '\n', ';', or any custom string. '\n' also accepts '\r\n'. */
  rowSep: string;
  /** The first column is the translation, the second the German term. */
  swap?: boolean;
}

export interface ImportRow {
  /** German column as typed (trimmed), e.g. "der Tisch". */
  term: string;
  translation: string;
  /** parseGermanInput(term): lemma, gender, verb forms… */
  parsed: ParsedTerm;
}

function splitRows(text: string, rowSep: string): string[] {
  if (rowSep === '\n') return text.split(/\r\n|\r|\n/);
  const normalized = text.replace(/\r\n|\r/g, '\n');
  return rowSep ? normalized.split(rowSep) : [normalized];
}

/** Split on the FIRST occurrence of `sep` only (definitions may contain the separator). */
function splitFirst(row: string, sep: string): [string, string] {
  if (!sep) return [row, ''];
  const i = row.indexOf(sep);
  if (i < 0) {
    // " - " also accepts " – " / " — " (iOS "smart punctuation" replaces dashes).
    if (sep === ' - ') {
      const m = row.match(/\s[–—]\s/);
      if (m && m.index !== undefined) return [row.slice(0, m.index), row.slice(m.index + m[0].length)];
    }
    return [row, ''];
  }
  return [row.slice(0, i), row.slice(i + sep.length)];
}

export function parseImport(text: string, opts: ImportOptions): ImportRow[] {
  const rows: ImportRow[] = [];
  for (const raw of splitRows(text, opts.rowSep)) {
    // Rows split on ";" may still contain stray newlines; treat them as spaces.
    const row = opts.rowSep === '\n' ? raw.trim() : raw.replace(/\s*\n\s*/g, ' ').trim();
    if (!row) continue;
    let [a, b] = splitFirst(row, opts.termSep).map((s) => s.trim()) as [string, string];
    if (opts.swap) [a, b] = [b, a];
    if (!a && !b) continue;
    rows.push({ term: a, translation: b, parsed: parseGermanInput(a) });
  }
  return rows;
}

/** Guess separators from pasted text: tab if any tabs, else " - " if present, else comma. */
export function detectSeparators(text: string): { termSep: string; rowSep: string } {
  const hasNewline = /\r|\n/.test(text.trim());
  const rowSep = !hasNewline && text.includes(';') ? ';' : '\n';
  let termSep = ',';
  if (text.includes('\t')) termSep = '\t';
  else if (/\s[-–—]\s/.test(text)) termSep = ' - ';
  return { termSep, rowSep };
}
