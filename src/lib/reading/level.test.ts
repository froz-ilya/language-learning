import { describe, expect, it } from 'vitest';
import { averageSentenceLength, estimateLevel, isFunctionWord, knownShare, type WordRank } from './level';
import { tokenize } from './text';
import type { WordStatus } from '../progress';

/** Stub dictionary: rank by lower-cased word; "der/die/und…" are function words; `nouns` are nouns. */
function stub(ranks: Record<string, number>, fn: string[] = [], nouns: string[] = []) {
  return (w: string): WordRank | null => {
    const k = w.toLowerCase();
    if (fn.includes(k)) return { rank: 10, pos: 'other' };
    if (!(k in ranks)) return null;
    return { rank: ranks[k], pos: nouns.includes(k) ? 'noun' : 'adj', lemma: k };
  };
}

const FN = ['der', 'die', 'das', 'und', 'ist', 'ein', 'eine', 'in', 'zu'];

/** Tokens of `words` in sentences of `len` words. */
function text(words: string[], len = 10) {
  const out: string[] = [];
  for (let i = 0; i < words.length; i += len) out.push(words.slice(i, i + len).join(' ') + '.');
  return tokenize(out.join(' '));
}

/** Ten common words (ranks 100…550: A1). */
const COMMON: Record<string, number> = Object.fromEntries(
  ['haus', 'gut', 'klein', 'neu', 'alt', 'schön', 'lang', 'groß', 'kalt', 'warm'].map((w, i) => [w, 100 + i * 50]),
);
/** `n` running common words. */
const common = (n: number) => Array.from({ length: n }, (_, i) => Object.keys(COMMON)[i % 10]);
/** `n` distinct rare words of one rank ("seltenaa", "seltenba", …). */
function rare(n: number, rank: number, stem = 'selten') {
  const words = Array.from({ length: n }, (_, i) => `${stem}${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`);
  return { words, ranks: Object.fromEntries(words.map((w) => [w, rank])) as Record<string, number> };
}

/** Spread `b` evenly over `a`. */
function mix(a: string[], b: string[]) {
  const out: string[] = [];
  const every = Math.max(1, Math.round((a.length + b.length) / Math.max(1, b.length)));
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (j < b.length && (out.length % every === 0 || i >= a.length)) out.push(b[j++]);
    else out.push(a[i++]);
  }
  return out;
}

describe('estimateLevel', () => {
  it('takes the rank a reader needs to know 85% of the running words', () => {
    const r10 = rare(10, 2000);
    // 90% of the words are A1: A1.
    expect(estimateLevel(text(mix(common(90), r10.words)), stub({ ...COMMON, ...r10.ranks }))).toBe('A1');
    // 20% are B1-rare: 85% coverage needs B1.
    const r20 = rare(20, 2000);
    expect(estimateLevel(text(mix(common(80), r20.words)), stub({ ...COMMON, ...r20.ranks }))).toBe('B1');
    const c2 = rare(20, 8000);
    expect(estimateLevel(text(mix(common(80), c2.words)), stub({ ...COMMON, ...c2.ranks }))).toBe('C2');
  });

  it('counts function words as running words (they are known)', () => {
    const r12 = rare(12, 2000);
    const words = mix(common(48), r12.words);
    // 12 of 60 words (20%) are rare → B1; with 30 "der" in between, 12 of 90 (13%) → A1.
    expect(estimateLevel(text(words), stub({ ...COMMON, ...r12.ranks }, FN))).toBe('B1');
    const withFn = words.flatMap((w, i) => (i % 2 ? [w, 'der'] : [w]));
    expect(estimateLevel(text(withFn), stub({ ...COMMON, ...r12.ranks }, FN))).toBe('A1');
  });

  it('nudges down for very short sentences and up for long ones', () => {
    const r20 = rare(20, 2000);
    const words = mix(common(80), r20.words);
    const info = stub({ ...COMMON, ...r20.ranks });
    expect(estimateLevel(text(words, 12), info)).toBe('B1');
    expect(estimateLevel(text(words, 5), info)).toBe('A2');
    expect(estimateLevel(text(words, 25), info)).toBe('B2');
    expect(estimateLevel(text(words, 50), info)).toBe('C1');
  });

  it('leaves out topic words: nouns the text repeats', () => {
    const words = mix(common(80), Array<string>(20).fill('achterbahn'));
    const ranks = { ...COMMON, achterbahn: 7891 };
    // The same rare word 20 times: as a noun it is the topic (learned in context)…
    expect(estimateLevel(text(words), stub(ranks, [], ['achterbahn']))).toBe('A1');
    // …as any other word it is just rare.
    expect(estimateLevel(text(words), stub(ranks))).toBe('C2');
    // Nouns seen only twice are not topic words.
    const twice = rare(10, 7891, 'kirmes');
    const nouns = mix(common(80), [...twice.words, ...twice.words]);
    expect(estimateLevel(text(nouns), stub({ ...COMMON, ...twice.ranks }, [], twice.words))).toBe('C2');
  });

  it('leaves out words of the title and compounds with them', () => {
    const katzen = rare(20, 5000, 'katze');
    const words = mix(common(80), katzen.words);
    const info = stub({ ...COMMON, ...katzen.ranks });
    expect(estimateLevel(text(words), info)).toBe('C1');
    expect(estimateLevel(text(words), info, { title: 'Die Katze' })).toBe('A1');
    expect(estimateLevel(text(words), info, { title: 'Der Hund' })).toBe('C1');
  });

  it('skips capitalised unknown words (names), counts lower-case unknown as rare', () => {
    const names = Array.from({ length: 20 }, (_, i) => `Odradek${'x'.repeat(i)}`);
    expect(estimateLevel(text(mix(common(80), names)), stub(COMMON))).toBe('A1');
    const unknown = 'schnurrte prasselnd knackte schwankend raschelte flackernd zischte taumelnd wogte glomm'.split(' ');
    expect(estimateLevel(text(mix(common(80), [...unknown, ...unknown])), stub(COMMON))).toBe('C2');
  });

  it('returns null for short texts or when the dictionary is not loaded', () => {
    expect(estimateLevel(tokenize('Der Hund ist schön.'), stub(COMMON, FN))).toBeNull();
    expect(estimateLevel(text(common(100)), () => null)).toBeNull();
  });
});

describe('helpers', () => {
  it('isFunctionWord: pos other and rank < 150', () => {
    expect(isFunctionWord({ rank: 3, pos: 'other' })).toBe(true);
    expect(isFunctionWord({ rank: 300, pos: 'other' })).toBe(false);
    expect(isFunctionWord({ rank: 3, pos: 'verb' })).toBe(false);
    expect(isFunctionWord(null)).toBe(false);
  });

  it('averageSentenceLength', () => {
    expect(averageSentenceLength(tokenize('Eins zwei drei. Vier fünf! Sechs'))).toBe(2);
    expect(averageSentenceLength([])).toBe(0);
  });
});

describe('knownShare', () => {
  const status: Record<string, WordStatus> = { hund: 'known', haus: 'learned', katze: 'learning', maus: 'new' };
  const fn = (w: string) => status[w.toLowerCase()];

  it('counts word tokens whose lemma card is learned or known', () => {
    // 8 words: Hund, Haus, Hund (3 known) / Katze, Maus, und, ein, Baum (not)
    const tokens = tokenize('Hund, Haus und Hund. Katze, Maus, ein Baum!');
    expect(knownShare(tokens, fn)).toBeCloseTo(3 / 8);
  });

  it('is 0 for no words', () => {
    expect(knownShare(tokenize('… 42 !'), fn)).toBe(0);
  });
});
