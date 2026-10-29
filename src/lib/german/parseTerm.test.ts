import { describe, expect, it } from 'vitest';
import { parseGermanInput } from './parseTerm';

describe('parseGermanInput: reflexive verbs', () => {
  it('keeps "sich" in the term and marks the verb reflexive', () => {
    expect(parseGermanInput('sich treffen')).toEqual({ term: 'sich treffen', genders: [], reflexive: true });
    expect(parseGermanInput('  Sich   beeilen ')).toEqual({ term: 'sich beeilen', genders: [], reflexive: true });
  });

  it('reads verb forms after a reflexive verb', () => {
    expect(parseGermanInput('sich treffen, traf, hat getroffen')).toEqual({
      term: 'sich treffen',
      pos: 'verb',
      genders: [],
      praeteritum: 'traf',
      partizip2: 'getroffen',
      auxiliary: 'haben',
      reflexive: true,
    });
  });

  it('leaves phrases and other words as they were', () => {
    expect(parseGermanInput('sich Sorgen machen')).toEqual({ term: 'sich Sorgen machen', genders: [] });
    expect(parseGermanInput('sich')).toEqual({ term: 'sich', genders: [] });
    expect(parseGermanInput('treffen')).toEqual({ term: 'treffen', genders: [] });
    expect(parseGermanInput('der Tisch')).toMatchObject({ term: 'Tisch', pos: 'noun', genders: ['m'] });
    expect(parseGermanInput('der Tisch').reflexive).toBeUndefined();
    expect(parseGermanInput('gehen, ging, ist gegangen')).toMatchObject({ term: 'gehen', pos: 'verb', auxiliary: 'sein' });
    expect(parseGermanInput('gehen, ging, ist gegangen').reflexive).toBeUndefined();
  });
});
