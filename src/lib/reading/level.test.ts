import { describe, expect, it } from 'vitest';
import { averageSentenceLength, clampLevel, estimateLevel, isFunctionWord, knownShare, type WordRank } from './level';
import { tokenize } from './text';
import type { WordStatus } from '../progress';

/** Stub dictionary: rank by lower-cased word; "der/die/und…" are function words. */
function stub(ranks: Record<string, number>, fn: string[] = []) {
  return (w: string): WordRank | null => {
    const k = w.toLowerCase();
    if (fn.includes(k)) return { rank: 10, pos: 'other' };
    return k in ranks ? { rank: ranks[k], pos: 'noun' } : null;
  };
}

const FN = ['der', 'die', 'das', 'und', 'ist', 'ein', 'eine', 'in', 'zu'];

/** A text of `n` sentences of `len` words, drawing content words round-robin from `words`. */
function text(words: string[], n: number, len: number) {
  const out: string[] = [];
  let i = 0;
  for (let s = 0; s < n; s++) {
    const ws: string[] = [];
    for (let j = 0; j < len; j++) ws.push(j % 3 === 0 ? 'der' : words[i++ % words.length]);
    out.push(ws.join(' ') + '.');
  }
  return tokenize(out.join(' '));
}

describe('estimateLevel', () => {
  const common = { haus: 100, hund: 200, gehen: 300, gross: 400, schön: 500, essen: 550 };

  it('maps the 80th-percentile rank to a level', () => {
    const words = Object.keys(common);
    expect(estimateLevel(text(words, 6, 10), stub(common, FN))).toBe('A1');

    const b1 = { ...common, gebäude: 2000, verwaltung: 2400 };
    // 2 of 8 content words are B1-rare: the 80th percentile lands in B1.
    expect(estimateLevel(text(Object.keys(b1), 6, 10), stub(b1, FN))).toBe('B1');

    const c2 = { ...common, gerichtsbarkeit: 9000, verwerfung: 7000 };
    expect(estimateLevel(text(Object.keys(c2), 6, 10), stub(c2, FN))).toBe('C2');
  });

  it('nudges down for very short sentences and up for long ones', () => {
    const a2 = { ...common, bahnhof: 1200, fahrkarte: 1250 };
    const words = Object.keys(a2);
    expect(estimateLevel(text(words, 8, 10), stub(a2, FN))).toBe('A2');
    expect(estimateLevel(text(words, 20, 5), stub(a2, FN))).toBe('A1');
    expect(estimateLevel(text(words, 3, 30), stub(a2, FN))).toBe('B1');
  });

  it('ignores function words, skips capitalised unknown words (names), counts lower-case unknown as rare', () => {
    const words = Object.keys(common);
    const withNames = tokenize(
      text(words, 6, 10)
        .map((t) => t.text)
        .join('') + ' Bucephalus Odradek.',
    );
    expect(estimateLevel(withNames, stub(common, FN))).toBe('A1');

    const rare = tokenize(
      text(words, 4, 10)
        .map((t) => t.text)
        .join('') + ' schnurrte prasselnd knackte schwankend raschelte flackernd zischte taumelnd.',
    );
    expect(estimateLevel(rare, stub(common, FN))).toBe('C2');
  });

  it('returns null for short texts or when the dictionary is not loaded', () => {
    expect(estimateLevel(tokenize('Der Hund ist schön.'), stub(common, FN))).toBeNull();
    expect(estimateLevel(text(['haus', 'hund'], 10, 10), () => null)).toBeNull();
  });
});

describe('helpers', () => {
  it('clampLevel keeps an estimate inside the source range', () => {
    expect(clampLevel('C1', ['A2', 'B1'])).toBe('B1');
    expect(clampLevel('A1', ['B1', 'C2'])).toBe('B1');
    expect(clampLevel('B2', ['A2', 'B1', 'B2', 'C1'])).toBe('B2');
    expect(clampLevel('C2', [])).toBe('C2');
  });

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
