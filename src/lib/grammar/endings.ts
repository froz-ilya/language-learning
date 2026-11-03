import type { Case, Declension, EndingGap, Gender } from './types';

/**
 * German determiner and adjective endings, by case and gender. Pure data and lookups (no i18n):
 * the cheat sheet's tables come from here, and the content test checks every authored answer
 * against it, so a table and an exercise can't disagree.
 */

export const CASES: Case[] = ['nom', 'akk', 'dat', 'gen'];
export const GENDERS: Gender[] = ['m', 'f', 'n', 'pl'];

/** The German name of a case, as textbooks use it. Taught terms, not interface text. */
export const CASE_NAMES: Record<Case, string> = { nom: 'Nominativ', akk: 'Akkusativ', dat: 'Dativ', gen: 'Genitiv' };

type Table = Record<Case, Record<Gender, string>>;
const row = (m: string, f: string, n: string, pl: string): Record<Gender, string> => ({ m, f, n, pl });

/** der, die, das: the endings after the stem "d" (d|er, d|ie, d|as). */
const DEFINITE: Table = {
  nom: row('er', 'ie', 'as', 'ie'),
  akk: row('en', 'ie', 'as', 'ie'),
  dat: row('em', 'er', 'em', 'en'),
  gen: row('es', 'er', 'es', 'er'),
};

/** dieser, jeder, welcher, alle: dies|er, dies|e, dies|es. */
const DER_WORD: Table = {
  nom: row('er', 'e', 'es', 'e'),
  akk: row('en', 'e', 'es', 'e'),
  dat: row('em', 'er', 'em', 'en'),
  gen: row('es', 'er', 'es', 'er'),
};

/** ein, kein, mein…: no ending in three places (ein Mann, ein Kind, ein Kind). */
const EIN_WORD: Table = {
  nom: row('', 'e', '', 'e'),
  akk: row('en', 'e', '', 'e'),
  dat: row('em', 'er', 'em', 'en'),
  gen: row('es', 'er', 'es', 'er'),
};

/** Adjective endings by declension. */
const ADJECTIVE: Record<Declension, Table> = {
  // Weak: -e in the five "nominative-like" places, -en everywhere else.
  der: {
    nom: row('e', 'e', 'e', 'en'),
    akk: row('en', 'e', 'e', 'en'),
    dat: row('en', 'en', 'en', 'en'),
    gen: row('en', 'en', 'en', 'en'),
  },
  // Mixed: where ein has no ending, the adjective shows the gender (-er, -es).
  ein: {
    nom: row('er', 'e', 'es', 'en'),
    akk: row('en', 'e', 'es', 'en'),
    dat: row('en', 'en', 'en', 'en'),
    gen: row('en', 'en', 'en', 'en'),
  },
  // Strong: the adjective takes the article's ending, except genitive masculine and neuter (-en).
  none: {
    nom: row('er', 'e', 'es', 'e'),
    akk: row('en', 'e', 'es', 'e'),
    dat: row('em', 'er', 'em', 'en'),
    gen: row('en', 'er', 'en', 'er'),
  },
};

/** Every determiner the exercises may use, by dictionary form, with the genders it has. */
export const DETERMINERS: Record<string, { declension: Declension; table: Table; genders: Gender[] }> = {
  der: { declension: 'der', table: DEFINITE, genders: GENDERS },
  dieser: { declension: 'der', table: DER_WORD, genders: GENDERS },
  jeder: { declension: 'der', table: DER_WORD, genders: ['m', 'f', 'n'] },
  welcher: { declension: 'der', table: DER_WORD, genders: GENDERS },
  alle: { declension: 'der', table: DER_WORD, genders: ['pl'] },
  ein: { declension: 'ein', table: EIN_WORD, genders: ['m', 'f', 'n'] },
  kein: { declension: 'ein', table: EIN_WORD, genders: GENDERS },
  mein: { declension: 'ein', table: EIN_WORD, genders: GENDERS },
  dein: { declension: 'ein', table: EIN_WORD, genders: GENDERS },
  sein: { declension: 'ein', table: EIN_WORD, genders: GENDERS },
  ihr: { declension: 'ein', table: EIN_WORD, genders: GENDERS },
  unser: { declension: 'ein', table: EIN_WORD, genders: GENDERS },
  euer: { declension: 'ein', table: EIN_WORD, genders: GENDERS },
};

/** The declension a phrase's adjectives follow; '' (no determiner) is strong. */
export function declensionOf(det: string): Declension | undefined {
  return det === '' ? 'none' : DETERMINERS[det]?.declension;
}

/** The determiner's ending, or undefined when the determiner or that gender doesn't exist. */
export function determinerEnding(det: string, c: Case, g: Gender): string | undefined {
  const d = DETERMINERS[det];
  return d && d.genders.includes(g) ? d.table[c][g] : undefined;
}

export function adjectiveEnding(declension: Declension, c: Case, g: Gender): string {
  return ADJECTIVE[declension][c][g];
}

/** The right ending for a gap of a phrase, or undefined when the phrase can't exist. */
export function expectedEnding(gap: Pick<EndingGap, 'role'>, phrase: { det: string; case: Case; gender: Gender }): string | undefined {
  if (gap.role === 'det') return determinerEnding(phrase.det, phrase.case, phrase.gender);
  const declension = declensionOf(phrase.det);
  if (!declension) return undefined;
  if (phrase.det !== '' && !DETERMINERS[phrase.det].genders.includes(phrase.gender)) return undefined;
  return adjectiveEnding(declension, phrase.case, phrase.gender);
}

/** The endings offered for a gap: every ending that word could take, so the choice is a real one. */
export function endingOptions(gap: Pick<EndingGap, 'role'>, det: string): string[] {
  if (gap.role === 'adj') return ['e', 'en', 'er', 'es', 'em'];
  if (det === 'der') return ['er', 'ie', 'as', 'en', 'em', 'es'];
  if (DETERMINERS[det]?.declension === 'ein') return ['', 'e', 'en', 'er', 'es', 'em'];
  return ['er', 'e', 'es', 'en', 'em'];
}

/** The ending tables for the cheat sheet: the determiner's (when there is one) and the adjective's. */
export function endingTable(declension: Declension): { det?: Table; adj: Table } {
  return {
    det: declension === 'der' ? DEFINITE : declension === 'ein' ? EIN_WORD : undefined,
    adj: ADJECTIVE[declension],
  };
}
