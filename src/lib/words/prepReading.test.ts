import { describe, expect, it } from 'vitest';
import type { LookupResult } from '../types';
import { joiningByMeaning, narrowToPrep, picksForPrep } from './prepReading';

const r: LookupResult = {
  term: 'bestehen',
  pos: 'verb',
  genders: [],
  plural: '',
  praeteritum: '',
  partizip2: '',
  auxiliary: '',
  translation: 'consist; insist; pass',
  examples: [{ de: 'A', tr: 'a' }],
  meaningExamples: [[{ de: 'A', tr: 'a' }], [{ de: 'B', tr: 'b' }], []],
  meaningPreps: [['aus + Dat'], ['auf + Dat'], []],
  preps: 'aus + Dat; auf + Dat',
  source: 'wiktionary',
};

describe('picksForPrep', () => {
  it('picks the meanings that mention the preposition', () => {
    expect(picksForPrep(r.meaningPreps, 'auf')).toEqual([false, true, false]);
    expect(picksForPrep(r.meaningPreps, 'mit')).toBeNull();
    expect(picksForPrep([['auf + Akk'], ['auf + Akk']], 'auf')).toBeNull();
    expect(picksForPrep(undefined, 'auf')).toBeNull();
  });
});

describe('narrowToPrep', () => {
  it('keeps the meanings, examples and case of that preposition', () => {
    expect(narrowToPrep(r, { word: 'auf' })).toMatchObject({
      translation: 'insist',
      examples: [{ de: 'B', tr: 'b' }],
      meaningExamples: [[{ de: 'B', tr: 'b' }]],
      meaningPreps: [['auf + Dat']],
      preps: 'auf + Dat; aus + Dat',
    });
  });

  it('leaves the meanings alone when nothing tells them apart', () => {
    const n = narrowToPrep({ ...r, meaningPreps: undefined }, { word: 'auf', case: 'Akk' });
    expect(n.translation).toBe(r.translation);
    expect(n.preps).toBe('auf + Akk; aus + Dat');
  });
});

describe('joiningByMeaning', () => {
  it('a meaning only with that preposition, next to one without any', () => {
    expect(joiningByMeaning(r.meaningPreps)).toEqual(['aus', 'auf']);
    expect(joiningByMeaning([['an + Akk'], ['an + Akk']])).toEqual([]);
    expect(joiningByMeaning([['an + Akk', 'über + Akk'], []])).toEqual([]);
    expect(joiningByMeaning(undefined)).toEqual([]);
  });
});
