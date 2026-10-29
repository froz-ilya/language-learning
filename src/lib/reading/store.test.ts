import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { LexEntry } from '../dict/types';
import type { LookupResult } from '../types';
import { buildCard, fieldsFromEntry, fieldsFromLookup } from './store';

const verb = (over: Partial<LexEntry>): LexEntry => ({
  term: 'freuen',
  pos: 'verb',
  genders: [],
  plural: '',
  praeteritum: 'freute',
  partizip2: 'gefreut',
  auxiliary: 'haben',
  tr: { ru: 'радовать', en: 'please' },
  rank: 900,
  ...over,
});

describe('card fields with prepositions', () => {
  it('carries an entry’s prepositions, but not to the plain verb of a verb that is also reflexive', () => {
    expect(fieldsFromEntry(verb({ term: 'warten', preps: 'auf + Akk' }), 'ru').preps).toBe('auf + Akk');
    expect(fieldsFromEntry(verb({ term: 'sich beeilen', reflexive: 'only', preps: 'mit + Dat' }), 'ru')).toMatchObject({ term: 'sich beeilen', preps: 'mit + Dat' });
    expect(fieldsFromEntry(verb({ reflexive: 'also', preps: 'auf + Akk; über + Akk' }), 'ru')).not.toHaveProperty('preps');
    expect(fieldsFromEntry(verb({ term: 'sich freuen', reflexive: 'also', preps: 'auf + Akk; über + Akk' }), 'ru').preps).toBe('auf + Akk; über + Akk');
    expect(fieldsFromEntry(verb({}), 'ru')).not.toHaveProperty('preps');
  });

  it('carries a lookup’s prepositions and its "sich …" term', () => {
    const r: LookupResult = {
      term: 'sich beeilen',
      pos: 'verb',
      genders: [],
      plural: '',
      praeteritum: 'beeilte',
      partizip2: 'beeilt',
      auxiliary: 'haben',
      translation: 'торопиться',
      examples: [],
      preps: 'mit + Dat',
      source: 'wiktionary',
    };
    expect(fieldsFromLookup(r)).toMatchObject({ term: 'sich beeilen', preps: 'mit + Dat' });
    expect(fieldsFromLookup({ ...r, preps: undefined })).not.toHaveProperty('preps');
  });

  it('builds a card with prepositions, and without the field when there are none', () => {
    const card = buildCard(3, { term: 'sich freuen', translation: 'радоваться', preps: 'auf + Akk' }, 'Ich freue mich auf dich.');
    expect(card).toMatchObject({ setId: 3, term: 'sich freuen', preps: 'auf + Akk', needsFill: 0, examples: [{ de: 'Ich freue mich auf dich.' }] });
    expect(buildCard(3, { term: 'Tisch', preps: ' ' })).not.toHaveProperty('preps');
    expect(buildCard(3, { term: 'Tisch' })).not.toHaveProperty('preps');
  });
});
