import { describe, expect, it } from 'vitest';
import {
  baseTerm,
  CONTRACTIONS,
  FIXED_CASE,
  formatPrep,
  joiningPair,
  listPreps,
  mergePrepEntry,
  parsePrepEntry,
  PREP_CASE,
  PREP_PAIRS,
  PREPOSITIONS,
  prepEntries,
  prepOfCard,
  resolveCase,
  splitPrepTerm,
  TWO_WAY,
  withListPreps,
} from './prepositions';

describe('the list of words with a preposition', () => {
  it('has valid prepositions and cases, each pair once', () => {
    const seen = new Set<string>();
    for (const p of PREP_PAIRS) {
      expect(PREPOSITIONS, p.base).toContain(p.word);
      expect(['Akk', 'Dat', 'Gen', 'Inf'], p.base).toContain(p.case);
      if (p.case === 'Inf') expect(p.word).toBe('zu');
      else if (FIXED_CASE.has(p.word)) expect(p.case, `${p.base} ${p.word}`).toBe(PREP_CASE[p.word]);
      const key = `${p.base.toLowerCase()}|${p.word}`;
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
    }
  });

  it('every pair that joins the word has its own meaning in Russian and English', () => {
    const joining = PREP_PAIRS.filter((p) => p.joins);
    expect(joining.length).toBeGreaterThan(10);
    for (const p of joining) {
      expect(p.joins!.ru.trim(), `${p.base} ${p.word}`).not.toBe('');
      expect(p.joins!.en.trim(), `${p.base} ${p.word}`).not.toBe('');
      expect(/[а-яё]/i.test(p.joins!.ru), `${p.base} ${p.word}`).toBe(true);
      expect(/[а-яё]/i.test(p.joins!.en), `${p.base} ${p.word}`).toBe(false);
    }
    // A detail of the word, not part of it.
    for (const [base, word] of [['denken', 'an'], ['warten', 'auf'], ['sich freuen', 'über'], ['Angst', 'vor'], ['stolz', 'auf']]) {
      expect(joiningPair(base, word), `${base} ${word}`).toBeUndefined();
    }
    expect(joiningPair('bestehen', 'auf')?.joins).toEqual({ ru: 'настаивать на', en: 'insist on' });
    expect(joiningPair('sich verlassen', 'auf')).toBeDefined();
    expect(joiningPair('verlassen', 'auf')).toBeUndefined();
  });

  it('two-way prepositions are not fixed, and contractions stand for prepositions', () => {
    for (const w of TWO_WAY) expect(FIXED_CASE.has(w)).toBe(false);
    for (const p of Object.values(CONTRACTIONS)) expect(PREPOSITIONS).toContain(p);
  });
});

describe('preposition entries', () => {
  it('format and read back', () => {
    for (const p of [{ word: 'auf', case: 'Akk' as const }, { word: 'zu', case: 'Inf' as const }, { word: 'an' }]) {
      expect(parsePrepEntry(formatPrep(p))).toEqual(p);
    }
    expect(parsePrepEntry('auf+Akk.')).toEqual({ word: 'auf', case: 'Akk' });
    expect(parsePrepEntry('Über + Dativ')).toEqual({ word: 'über', case: 'Dat' });
    expect(parsePrepEntry('Haus')).toBeNull();
    expect(parsePrepEntry('auf + Haus')).toBeNull();
    expect(prepEntries('auf + Akk; über + Akk; ???')).toEqual([
      { word: 'auf', case: 'Akk' },
      { word: 'über', case: 'Akk' },
    ]);
  });

  it('merge replaces the same preposition and keeps the others', () => {
    expect(mergePrepEntry('auf + Akk; über + Akk', { word: 'über', case: 'Dat' })).toBe('über + Dat; auf + Akk');
    expect(mergePrepEntry(undefined, { word: 'an' })).toBe('an');
    expect(mergePrepEntry('an', { word: 'an', case: 'Dat' })).toBe('an + Dat');
  });
});

describe('a card learned with its preposition', () => {
  it('needs the term to end in a preposition that preps lists', () => {
    expect(prepOfCard({ term: 'warten auf', preps: 'auf + Akk' })).toEqual({ word: 'auf', case: 'Akk' });
    expect(prepOfCard({ term: 'sich Sorgen machen um', preps: 'um + Akk' })).toEqual({ word: 'um', case: 'Akk' });
    expect(prepOfCard({ term: 'denken an', preps: 'an' })).toEqual({ word: 'an' });
    // Old cards: phrases that end in a preposition stay phrases.
    expect(prepOfCard({ term: 'warten auf' })).toBeNull();
    expect(prepOfCard({ term: 'ab und zu' })).toBeNull();
    expect(prepOfCard({ term: 'bis zu', preps: 'auf + Akk' })).toBeNull();
    expect(prepOfCard({ term: 'zu Hause', preps: 'zu + Dat' })).toBeNull();
    expect(prepOfCard({ term: 'warten', preps: 'auf + Akk' })).toBeNull();
    expect(splitPrepTerm('nach wie vor')).toEqual({ base: 'nach wie', word: 'vor' });
  });

  it('baseTerm drops only that preposition', () => {
    expect(baseTerm({ term: 'sich freuen über', preps: 'über + Akk' })).toBe('sich freuen');
    expect(baseTerm({ term: 'nach wie vor' })).toBe('nach wie vor');
  });
});

describe('resolveCase', () => {
  it('typed, then fixed, then the list, then the dictionary', () => {
    expect(resolveCase('denken', 'an', { typed: 'Dat' })).toEqual({ case: 'Dat', from: 'typed' });
    expect(resolveCase('sprechen', 'mit', { typed: 'Akk' })).toEqual({ case: 'Dat', from: 'fixed' });
    expect(resolveCase('warten', 'auf')).toEqual({ case: 'Akk', from: 'list' });
    expect(resolveCase('sich freuen', 'über')).toEqual({ case: 'Akk', from: 'list' });
    expect(resolveCase('freuen', 'über')).toEqual({ case: 'Akk', from: 'list' });
    // Wiktionary guesses "auf etwas" as Akk: the list knows bestehen auf + Dat.
    expect(resolveCase('bestehen', 'auf', { lookup: 'auf + Akk; aus + Dat' })).toEqual({ case: 'Dat', from: 'list' });
    expect(resolveCase('glauben', 'in', { lookup: 'in + Akk' })).toEqual({ case: 'Akk', from: 'lookup' });
    expect(resolveCase('kommen', 'an')).toEqual({});
    expect(resolveCase('pflegen', 'zu')).toEqual({ case: 'Inf', from: 'list' });
    expect(resolveCase('gehören', 'zu')).toEqual({ case: 'Dat', from: 'fixed' });
    expect(resolveCase('versuchen', 'zu', { typed: 'Inf' })).toEqual({ case: 'Inf', from: 'typed' });
    expect(resolveCase('denken', 'an', { typed: 'Inf' })).toEqual({ case: 'Akk', from: 'list' });
    expect(resolveCase('kommen', 'an', { typed: 'Inf' })).toEqual({});
  });
});

describe("the list's prepositions on a word", () => {
  it('fills a word the dictionary has none for', () => {
    expect(withListPreps(undefined, 'denken', 'verb')).toBe('an + Akk');
    expect(withListPreps('', 'warten', 'verb')).toBe('auf + Akk');
    expect(withListPreps('', 'Angst', 'noun')).toBe('vor + Dat');
    expect(withListPreps('', 'stolz', 'adj')).toBe('auf + Akk');
    // Only for the part of speech the list has.
    expect(withListPreps('', 'denken', 'noun')).toBe('');
    expect(withListPreps('', 'Haus', 'noun')).toBe('');
  });

  it("keeps the dictionary's, takes the list's case for a preposition both name", () => {
    expect(withListPreps('mit + Dat', 'sprechen', 'verb')).toBe('mit + Dat; über + Akk');
    expect(withListPreps('an + Dat; über + Akk', 'denken', 'verb')).toBe('an + Akk; über + Akk');
    expect(withListPreps('an', 'denken', 'verb')).toBe('an + Akk');
    // Nothing new: the value as it was.
    expect(withListPreps('an + Akk', 'denken', 'verb')).toBe('an + Akk');
    expect(withListPreps('mit + Dat', 'gehen', 'verb')).toBe('mit + Dat');
    // At most 3: the list's stays, the dictionary's last other goes.
    expect(withListPreps('mit + Dat; von; für', 'sprechen', 'verb')).toBe('mit + Dat; von; über + Akk');
  });

  it('gives the reflexive pairs to the "sich …" reading only', () => {
    expect(listPreps('freuen', 'verb')).toEqual([]);
    expect(withListPreps('', 'freuen', 'verb')).toBe('');
    expect(withListPreps('', 'sich freuen', 'verb')).toBe('auf + Akk; über + Akk');
    expect(withListPreps('', 'sich erinnern', 'verb')).toBe('an + Akk');
    expect(withListPreps('', 'erinnern', 'verb')).toBe('');
  });

  it('adds no pair that joins the word (bestehen auf is a word of its own)', () => {
    expect(withListPreps('', 'bestehen', 'verb')).toBe('');
    expect(withListPreps('', 'verzichten', 'verb')).toBe('');
    expect(withListPreps('', 'sich verlassen', 'verb')).toBe('');
    expect(withListPreps('aus + Dat; auf + Dat', 'bestehen', 'verb')).toBe('aus + Dat; auf + Dat');
  });
});

describe('prepCaseOf', () => {
  it('gives the case a preposition takes', async () => {
    const { prepCaseOf } = await import('./prepositions');
    expect(prepCaseOf({ term: 'während', pos: 'other' })).toBe('Gen');
    expect(prepCaseOf({ term: 'mit', pos: 'other' })).toBe('Dat');
    expect(prepCaseOf({ term: 'auf', pos: 'other' })).toBe('Akk / Dat');
    expect(prepCaseOf({ term: 'Haus', pos: 'noun' })).toBeUndefined();
    expect(prepCaseOf({ term: 'schnell', pos: 'adj' })).toBeUndefined();
    expect(prepCaseOf({ term: 'angesichts', pos: 'other' })).toBe('Gen');
    expect(prepCaseOf({ term: 'Gegenüber', pos: 'other' })).toBe('Dat');
    expect(prepCaseOf({ term: 'dank', pos: 'other' })).toBe('Gen / Dat');
    expect(prepCaseOf({ term: 'zum', pos: 'other' })).toBe('Dat');
    expect(prepCaseOf({ term: 'zur', pos: 'other' })).toBe('Dat');
    expect(prepCaseOf({ term: 'ins', pos: 'other' })).toBe('Akk');
    // "laut" the adjective (loud) isn't the preposition
    expect(prepCaseOf({ term: 'laut', pos: 'adj' })).toBeUndefined();
    expect(prepCaseOf({ term: 'laut', pos: 'other' })).toBe('Gen / Dat');
    expect(prepCaseOf({ term: 'und', pos: 'other' })).toBeUndefined();
  });

  it('knows every preposition the word-with-preposition tables use', async () => {
    const { prepCaseOf, PREPOSITIONS, CONTRACTIONS } = await import('./prepositions');
    for (const w of [...PREPOSITIONS, ...Object.keys(CONTRACTIONS)]) expect(prepCaseOf({ term: w, pos: 'other' }), w).toBeTruthy();
  });
});
