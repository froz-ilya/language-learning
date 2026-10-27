import { describe, expect, it } from 'vitest';
import { joinMeanings, MEANING_SEP, splitMeanings } from './meanings';

describe('splitMeanings', () => {
  it('splits meanings on ";" and synonyms on ","', () => {
    expect(splitMeanings('последствие, результат; серия, эпизод; ряд')).toEqual([
      ['последствие', 'результат'],
      ['серия', 'эпизод'],
      ['ряд'],
    ]);
  });

  it('trims whitespace around meanings and synonyms', () => {
    expect(splitMeanings('  a ,b  ;   c,   d ;e  ')).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
  });

  it('drops empty meanings and empty synonyms', () => {
    expect(splitMeanings(';; a,, b ;  ; , ; c;')).toEqual([['a', 'b'], ['c']]);
  });

  it('keeps a single meaning as one group', () => {
    expect(splitMeanings('дом')).toEqual([['дом']]);
    expect(splitMeanings('дом, здание')).toEqual([['дом', 'здание']]);
  });

  it('returns no meanings for an empty or blank string', () => {
    expect(splitMeanings('')).toEqual([]);
    expect(splitMeanings('   ')).toEqual([]);
    expect(splitMeanings(' ; , ')).toEqual([]);
  });
});

describe('joinMeanings', () => {
  it('joins synonyms with ", " and meanings with "; "', () => {
    expect(joinMeanings([['последствие', 'результат'], ['серия', 'эпизод'], ['ряд']])).toBe(
      'последствие, результат; серия, эпизод; ряд',
    );
    expect(MEANING_SEP).toBe('; ');
  });

  it('skips empty synonyms and empty meanings', () => {
    expect(joinMeanings([['a', ''], [], [''], ['b']])).toBe('a; b');
    expect(joinMeanings([])).toBe('');
  });

  it('joins a single meaning without a separator', () => {
    expect(joinMeanings([['дом', 'здание']])).toBe('дом, здание');
  });

  it('round-trips normalized strings, and normalizes messy ones', () => {
    const s = 'последствие, результат; серия, эпизод; ряд';
    expect(joinMeanings(splitMeanings(s))).toBe(s);
    expect(joinMeanings(splitMeanings(' a ,b;; c ;'))).toBe('a, b; c');
  });
});
