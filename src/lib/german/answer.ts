import type { Card, Strictness } from '../types';
import { ARTICLE } from './articles';

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
}

/** Check a typed German answer against a card, optionally requiring the noun's article. */
export function checkGerman(
  given: string,
  card: Pick<Card, 'term' | 'pos' | 'genders'>,
  strictness: Strictness,
  requireArticle: boolean,
): GermanCheck {
  const g = normalize(given);
  if (!g) return { verdict: 'wrong' };
  const term = normalize(card.term);

  if (card.pos !== 'noun' || card.genders.length === 0) {
    return { verdict: compare(g, term, strictness) };
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
