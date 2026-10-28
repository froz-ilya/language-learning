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

/** A letter outside the Latin script (Cyrillic, Greek…): the translation side, not German. */
const FOREIGN = /[^\P{L}\p{Script=Latin}]/u;
const hasForeign = (s: string) => FOREIGN.test(s);

/** German column that clearly continues past a comma: a plural or verb forms ("das Haus, die Häuser"). */
const isGermanWithForms = (s: string) => {
  const p = parseGermanInput(s);
  return !!(p.plural || p.praeteritum);
};

/**
 * Split a row on a comma, which may also appear inside the German column ("die Folge, die Folgen,
 * последствия, серия"): when one side is in another script (Cyrillic), split at the comma
 * where the script changes; otherwise at the last comma that still leaves a German term with
 * forms ("der Tisch, die Tische, table, desk"), else at the first comma.
 */
function splitComma(row: string, swap: boolean): [string, string] {
  const commas = [...row.matchAll(/,/g)].map((m) => m.index!);
  if (commas.length < 2) return splitFirst(row, ',');
  const at = (i: number): [string, string] => [row.slice(0, i), row.slice(i + 1)];
  if (hasForeign(row)) {
    // German | translation: the last comma before the first foreign letter.
    // Swapped (translation | German): the first comma after the last foreign letter.
    const foreign = [...row.matchAll(new RegExp(FOREIGN, 'gu'))].map((m) => m.index!);
    const pick = swap ? commas.find((i) => i > foreign[foreign.length - 1]) : commas.filter((i) => i < foreign[0]).pop();
    if (pick !== undefined) return at(pick);
  } else if (!swap) {
    for (let k = commas.length - 1; k > 0; k--) {
      const [left] = at(commas[k]);
      if (isGermanWithForms(left)) return at(commas[k]);
    }
  }
  return splitFirst(row, ',');
}

export function parseImport(text: string, opts: ImportOptions): ImportRow[] {
  const rows: ImportRow[] = [];
  for (const raw of splitRows(text, opts.rowSep)) {
    // Rows split on ";" may still contain stray newlines; treat them as spaces.
    const row = opts.rowSep === '\n' ? raw.trim() : raw.replace(/\s*\n\s*/g, ' ').trim();
    if (!row) continue;
    const split = opts.termSep === ',' ? splitComma(row, !!opts.swap) : splitFirst(row, opts.termSep);
    let [a, b] = split.map((s) => s.trim()) as [string, string];
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
