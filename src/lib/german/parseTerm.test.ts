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

describe('parseGermanInput: a word with its preposition', () => {
  // A detail of the word: the term is the word, the preposition goes to preps.
  const notes: [string, Record<string, unknown>][] = [
    ['denken an', { term: 'denken', preps: 'an + Akk', note: { word: 'an', case: 'Akk', from: 'list' } }],
    ['denken an + D', { term: 'denken', preps: 'an + Dat', note: { word: 'an', case: 'Dat', from: 'typed' } }],
    ['warten auf', { term: 'warten', preps: 'auf + Akk', note: { word: 'auf', case: 'Akk', from: 'list' } }],
    ['warten auf + Akk', { term: 'warten', preps: 'auf + Akk', note: { word: 'auf', case: 'Akk', from: 'typed' } }],
    ['warten auf (Akk.)', { term: 'warten', preps: 'auf + Akk' }],
    ['warten auf+A', { term: 'warten', preps: 'auf + Akk' }],
    ['auf jdn. warten', { term: 'warten', preps: 'auf + Akk', note: { from: 'typed' } }],
    ['sich auf etw. freuen', { term: 'sich freuen', reflexive: true, preps: 'auf + Akk' }],
    ['sich freuen über', { term: 'sich freuen', reflexive: true, preps: 'über + Akk' }],
    ['die Angst vor', { term: 'Angst', pos: 'noun', genders: ['f'], preps: 'vor + Dat' }],
    ['die Angst vor, -¨e', { term: 'Angst', pos: 'noun', genders: ['f'], plural: 'Ängste', preps: 'vor + Dat' }],
    ['stolz auf', { term: 'stolz', preps: 'auf + Akk' }],
    ['sich kümmern um', { term: 'sich kümmern', reflexive: true, preps: 'um + Akk', note: { from: 'fixed' } }],
    ['sich Sorgen machen um', { term: 'sich Sorgen machen', preps: 'um + Akk' }],
    ['versuchen ... zu', { term: 'versuchen', preps: 'zu + Inf', note: { from: 'typed' } }],
    ['gehören zu', { term: 'gehören', preps: 'zu + Dat', note: { from: 'fixed' } }],
    ['kommen an', { term: 'kommen', preps: 'an', note: { word: 'an' } }],
  ];
  it.each(notes)('%s: a detail of the word', (input, want) => {
    const p = parseGermanInput(input);
    expect(p).toMatchObject(want);
    expect(p.prep).toBeUndefined();
    expect(p.base).toBeUndefined();
  });

  // Part of the word (it changes the meaning): in the term, like "sich".
  const joined: [string, Record<string, unknown>][] = [
    ['bestehen auf', { term: 'bestehen auf', base: 'bestehen', preps: 'auf + Dat', prep: { word: 'auf', case: 'Dat', from: 'list' } }],
    ['bestehen aus', { term: 'bestehen aus', base: 'bestehen', preps: 'aus + Dat', prep: { word: 'aus', case: 'Dat', from: 'fixed' } }],
    ['teilnehmen an, nahm teil, hat teilgenommen', { term: 'teilnehmen an', pos: 'verb', praeteritum: 'nahm teil', prep: { word: 'an', case: 'Dat' } }],
    ['sich verlassen auf', { term: 'sich verlassen auf', base: 'sich verlassen', reflexive: true, prep: { word: 'auf', case: 'Akk' } }],
    ['pflegen zu', { term: 'pflegen zu', prep: { word: 'zu', case: 'Inf', from: 'list' } }],
    ['scheinen zu + Inf', { term: 'scheinen zu', prep: { word: 'zu', case: 'Inf' } }],
    ['brauchen … zu', { term: 'brauchen zu', prep: { word: 'zu', case: 'Inf' } }],
  ];
  it.each(joined)('%s: part of the word', (input, want) => {
    expect(parseGermanInput(input)).toMatchObject(want);
  });

  it('"verlassen auf" without "sich" is a detail until the lookup finds the "sich" reading', () => {
    expect(parseGermanInput('verlassen auf')).toMatchObject({ term: 'verlassen', note: { word: 'auf', case: 'Akk' } });
  });

  it('several prepositions are a note, not part of the word', () => {
    expect(parseGermanInput('sich freuen auf/über')).toEqual({ term: 'sich freuen', genders: [], reflexive: true, preps: 'auf + Akk; über + Akk' });
  });

  it('leaves phrases and inflected forms as they are', () => {
    for (const s of ['ab und zu', 'nach wie vor', 'zu Hause', 'auf', 'warten', 'kommt an', 'bis zu', 'ich warte auf', 'in Bezug auf', 'im Vergleich zu', 'mit Hilfe von']) {
      const p = parseGermanInput(s);
      expect(p.prep, s).toBeUndefined();
      expect(p.note, s).toBeUndefined();
      expect(p.term, s).toBe(s);
    }
  });
});
