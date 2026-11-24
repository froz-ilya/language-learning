import type { Card, Strictness } from '../types';
import { ARTICLE } from './articles';
import { baseOfReflexive, isReflexiveTerm, REFLEXIVE_PRONOUNS } from './reflexive';
import { baseTerm, caseOfWord, prepEntries, prepOfCard, PREPOSITIONS, type PrepCase } from './prepositions';

export type Verdict = 'correct' | 'typo' | 'wrong';

/** Lowercase, unify umlaut spellings (ä=ae), ß=ss, drop punctuation and extra spaces. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFC')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[.,!?;:"„“”'’()[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

function allowedTypos(expected: string): number {
  if (expected.length >= 8) return 2;
  if (expected.length >= 4) return 1;
  return 0;
}

function compare(given: string, expected: string, strictness: Strictness): Verdict {
  if (given === expected) return 'correct';
  if (strictness === 'lenient' && levenshtein(given, expected) <= allowedTypos(expected)) return 'typo';
  return 'wrong';
}

function best(verdicts: Verdict[]): Verdict {
  if (verdicts.includes('correct')) return 'correct';
  if (verdicts.includes('typo')) return 'typo';
  return 'wrong';
}

/** "house, home; building (big)" → ["house", "home", "building"]; "to go" also accepts "go". */
export function translationAlternatives(translation: string): string[] {
  const alts = translation
    .replace(/\([^)]*\)/g, ' ')
    .split(/[,;/]|\bor\b|\bили\b/)
    .map(normalize)
    .filter(Boolean);
  const extra = alts.filter((a) => a.startsWith('to ')).map((a) => a.slice(3));
  return [...new Set([...alts, ...extra])];
}

export function checkTranslation(given: string, translation: string, strictness: Strictness): Verdict {
  const g = normalize(given);
  if (!g) return 'wrong';
  const alts = translationAlternatives(translation);
  if (alts.length === 0) return 'wrong';
  return best(alts.map((a) => compare(g, a, strictness)));
}

export interface GermanCheck {
  verdict: Verdict;
  /** Noun answered without (or with a wrong) article while one is required. */
  articleProblem?: 'missing' | 'wrong';
  /**
   * Reflexive verbs: 'missing' — "treffen" for "sich treffen" (accepted as almost right);
   * 'form' — a conjugated pronoun ("mich treffen") instead of the dictionary form with "sich".
   */
  reflexiveProblem?: 'missing' | 'form';
  /**
   * Words learned with a preposition ("warten auf"): 'missing' — "warten" (almost right);
   * 'wrong' — another preposition ("warten für"); 'case' — a case typed after it that isn't its
   * case ("warten auf + Dat", almost right).
   */
  prepProblem?: 'missing' | 'wrong' | 'case';
}

/** "mich treffen" → ["mich", "treffen"] (normalized input). */
const PRONOUN_LEAD = new RegExp(`^(${Object.keys(REFLEXIVE_PRONOUNS).join('|')}) (.+)$`);

/**
 * Reflexive verbs: "sich treffen" answered "treffen" is almost right ('typo', "sich" missing,
 * whatever the strictness); "sich treffen" for the bare "treffen" is right; any reflexive
 * pronoun ("mich treffen", "uns treffen") counts as the reflexive form. Null when this isn't
 * a reflexive answer to a reflexive (or bare-verb) card.
 */
function checkReflexive(g: string, term: string, strictness: Strictness): GermanCheck | null {
  const lead = g.match(PRONOUN_LEAD);
  const reflexive = isReflexiveTerm(term);
  if (!lead && !reflexive) return null;
  const verdict = compare(lead ? lead[2] : g, normalize(baseOfReflexive(term)), strictness);
  if (verdict === 'wrong') return null;
  if (!lead) return { verdict: 'typo', reflexiveProblem: 'missing' };
  return lead[1] === 'sich' ? { verdict } : { verdict, reflexiveProblem: 'form' };
}

type GermanCard = Pick<Card, 'term' | 'pos' | 'genders'> & { preps?: string };

const PREPS_NORMALIZED = new Map(PREPOSITIONS.map((p) => [normalize(p), p]));
const PLACEHOLDERS = new Set(['etwas', 'etw', 'jemanden', 'jemandem', 'jemand', 'jmdn', 'jmdm', 'jmd', 'jdn', 'jdm']);

/**
 * A normalized answer without what may follow a preposition ("+ akk", "dativ", "jdn") and in
 * the card's order ("auf jdn warten" → "warten auf"); `typedCase` when a case was typed.
 */
function prepAnswer(g: string): { text: string; typedCase?: PrepCase } {
  const words = g.replace(/\+/g, ' + ').split(/\s+/).filter(Boolean);
  let typedCase: PrepCase | undefined;
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === '+') continue;
    const prev = out[out.length - 1];
    // A case right after "+" or after a preposition that isn't the first word ("warten auf dativ").
    if (words[i - 1] === '+' || (out.length > 1 && PREPS_NORMALIZED.has(prev))) {
      const c = caseOfWord(w);
      if (c) {
        typedCase = c;
        continue;
      }
    }
    if (i > 0 && PLACEHOLDERS.has(w)) continue;
    out.push(w);
  }
  // Dictionary order: "(sich) auf warten" (placeholder dropped) → "(sich) warten auf".
  const lead = out[0] === 'sich' ? 1 : 0;
  if (out.length > lead + 1 && PREPS_NORMALIZED.has(out[lead]) && !PREPS_NORMALIZED.has(out[out.length - 1])) {
    const [p] = out.splice(lead, 1);
    out.push(p);
  }
  return { text: out.join(' '), typedCase };
}

/** Check a typed German answer against a card, optionally requiring the noun's article. */
export function checkGerman(given: string, card: GermanCard, strictness: Strictness, requireArticle: boolean): GermanCheck {
  const g = normalize(given);
  if (!g) return { verdict: 'wrong' };
  const prep = prepOfCard(card);
  if (prep) return checkWithPrep(g, card, prep.word, prep.case, strictness, requireArticle);
  const plain = checkWord(g, card, strictness, requireArticle);
  if (plain.verdict !== 'wrong') return plain;
  // "warten auf" for a card "warten" that goes with auf: right.
  const { text } = prepAnswer(g);
  const words = text.split(' ');
  const last = PREPS_NORMALIZED.get(words[words.length - 1]);
  if (words.length > 1 && last && prepEntries(card.preps).some((p) => p.word === last)) {
    const core = checkWord(words.slice(0, -1).join(' '), card, strictness, requireArticle);
    // The word was right but its article missing or wrong ("Angst vor"): say so.
    if (core.verdict !== 'wrong' || core.articleProblem) return core;
  }
  return plain;
}

/** A word learned with its preposition: the word itself, then the preposition and a typed case. */
function checkWithPrep(g: string, card: GermanCard, word: string, c: PrepCase | undefined, strictness: Strictness, requireArticle: boolean): GermanCheck {
  const { text, typedCase } = prepAnswer(g);
  const words = text.split(' ');
  const last = PREPS_NORMALIZED.get(words[words.length - 1]);
  const core = last && words.length > 1 ? words.slice(0, -1).join(' ') : text;
  const base = checkWord(core, { ...card, term: baseTerm(card) }, strictness, requireArticle);
  if (base.verdict === 'wrong') return base;
  if (!last || words.length < 2) return { ...base, verdict: 'typo', prepProblem: 'missing' };
  if (last !== word) return { verdict: 'wrong', prepProblem: 'wrong' };
  if (typedCase && c && typedCase !== c) return { ...base, verdict: 'typo', prepProblem: 'case' };
  return base;
}

/** The word without a preposition: its article, a reflexive "sich". */
function checkWord(g: string, card: Pick<Card, 'term' | 'pos' | 'genders'>, strictness: Strictness, requireArticle: boolean): GermanCheck {
  const term = normalize(card.term);

  if (card.pos !== 'noun' || card.genders.length === 0) {
    const verdict = compare(g, term, strictness);
    if (verdict === 'correct') return { verdict };
    return checkReflexive(g, card.term, strictness) ?? { verdict };
  }

  const m = g.match(/^(der|die|das)\s+(.+)$/);
  const word = m ? m[2] : g;
  const verdict = compare(word, term, strictness);
  if (verdict === 'wrong') return { verdict };

  const articles = card.genders.map((x) => ARTICLE[x]);
  if (!m) return requireArticle ? { verdict: 'wrong', articleProblem: 'missing' } : { verdict };
  if (!articles.includes(m[1])) return { verdict: 'wrong', articleProblem: 'wrong' };
  return { verdict };
}

/** Check a single verb form ("ging", "gegangen"). Always strict: a one-letter slip is usually the point of the drill. */
export function checkForm(given: string, expected: string): Verdict {
  const e = normalize(expected);
  if (!e) return 'correct';
  return compare(normalize(given), e, 'strict');
}
