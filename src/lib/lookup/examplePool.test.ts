import { describe, expect, it } from 'vitest';
import { arrangeExamples, examplePool, phrasesForReading, phrasesToAdd } from './examplePool';

const ex = (de: string, tr = '') => ({ de, tr });
const des = (list: { de: string }[]) => list.map((e) => e.de);

// infrage: 1 "под вопросом", 2 "возможный (in Frage kommen)"
const byMeaning = [[ex('Das steht infrage.'), ex('Alles ist infrage.')], [ex('Das kommt nicht infrage.')], []];

describe('examplePool', () => {
  it('uses the lookup examples when there are no examples per meaning', () => {
    expect(des(examplePool(undefined, [], [ex('A'), ex('B')]))).toEqual(['A', 'B']);
    expect(des(examplePool([], [true], [ex('A')]))).toEqual(['A']);
  });

  it('takes one example per meaning in turn, then the remaining ones', () => {
    expect(des(examplePool(byMeaning, [true, true, true], []))).toEqual([
      'Das steht infrage.',
      'Das kommt nicht infrage.',
      'Alles ist infrage.',
    ]);
  });

  it('puts the picked meanings first, then the others, then other examples', () => {
    expect(des(examplePool(byMeaning, [false, true, false], [ex('Extra.')]))).toEqual([
      'Das kommt nicht infrage.',
      'Das steht infrage.',
      'Alles ist infrage.',
      'Extra.',
    ]);
  });

  it('treats all meanings as picked when the picks don’t fit or pick nothing', () => {
    const all = des(examplePool(byMeaning, [true, true, true], []));
    expect(des(examplePool(byMeaning, [], []))).toEqual(all);
    expect(des(examplePool(byMeaning, [true, false], []))).toEqual(all);
    expect(des(examplePool(byMeaning, [false, false, false], []))).toEqual(all);
  });

  it('drops blanks and duplicates (ignoring case and spaces), keeping the first', () => {
    const pool = examplePool([[ex('Das  kommt nicht infrage.', 'нет')], []], [true, true], [
      ex('das kommt nicht infrage.'),
      ex('  '),
      ex('B'),
    ]);
    expect(pool).toEqual([ex('Das  kommt nicht infrage.', 'нет'), ex('B')]);
  });

  it('fills a missing translation with ""', () => {
    expect(examplePool(undefined, [], [{ de: 'A' }])).toEqual([ex('A')]);
  });
});

describe('arrangeExamples', () => {
  const pool = [ex('A'), ex('B'), ex('C'), ex('D')];

  it('keeps the pool order, capped at 3', () => {
    expect(des(arrangeExamples(pool))).toEqual(['A', 'B', 'C']);
  });

  it('puts the shown example first', () => {
    expect(des(arrangeExamples(pool, 3))).toEqual(['D', 'A', 'B']);
    expect(des(arrangeExamples(pool, 1))).toEqual(['B', 'A', 'C']);
  });

  it('copies the examples and handles an empty pool', () => {
    const out = arrangeExamples(pool);
    expect(out[0]).not.toBe(pool[0]);
    expect(arrangeExamples([])).toEqual([]);
    expect(arrangeExamples([], 2)).toEqual([]);
  });
});

describe('phrasesToAdd', () => {
  const phrases = [ex('infrage stellen', 'ставить под сомнение'), ex('infrage kommen', 'подходить'), ex('X', 'x')];

  it('adds phrases up to 4 examples in all', () => {
    expect(des(phrasesToAdd([ex('A'), ex('B'), ex('C')], phrases))).toEqual(['infrage stellen']);
    expect(des(phrasesToAdd([ex('A')], phrases))).toEqual(['infrage stellen', 'infrage kommen', 'X']);
    expect(phrasesToAdd([ex('A'), ex('B'), ex('C'), ex('D')], phrases)).toEqual([]);
  });

  it('skips duplicates of examples and of each other, and blanks', () => {
    const out = phrasesToAdd([ex('Infrage stellen')], [ex('infrage stellen'), ex(' '), ex('Y', ' y '), ex('y')]);
    expect(out).toEqual([ex('Y', 'y')]);
  });

  it('handles no phrases', () => {
    expect(phrasesToAdd([], undefined)).toEqual([]);
    expect(phrasesToAdd([], [])).toEqual([]);
  });
});

describe('phrasesForReading', () => {
  const phrases = [ex('eine Entscheidung treffen', 'принять решение'), ex('sich mit Freunden treffen'), ex('Sich wohl fühlen')];

  it('keeps only phrases with "sich" for the reflexive reading', () => {
    expect(des(phrasesForReading(phrases, true))).toEqual(['sich mit Freunden treffen', 'Sich wohl fühlen']);
    // "sich" as a word, not inside one.
    expect(phrasesForReading([ex('sicher treffen')], true)).toEqual([]);
  });

  it('keeps every phrase for the plain verb', () => {
    expect(des(phrasesForReading(phrases, false))).toEqual(des(phrases));
    expect(phrasesForReading(undefined, false)).toEqual([]);
  });
});
