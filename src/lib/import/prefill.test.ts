// Offline prefill at import, on the dictionary fixtures (src/lib/dict/__fixtures__) served by a
// stubbed fetch.
import 'fake-indexeddb/auto';
import { readFileSync, existsSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseImport } from './parse';
import type { LocalHit } from '../dict/types';

type Prefill = typeof import('./prefill');

const FIXTURES = new URL('../dict/__fixtures__/', import.meta.url);
let prefill: Prefill;

beforeEach(async () => {
  vi.stubGlobal('fetch', async (url: string) => {
    const name = String(url).split('/dict/')[1];
    const file = new URL(name, FIXTURES);
    if (!existsSync(file)) return { ok: false, status: 404, json: async () => ({}) };
    const text = readFileSync(file, 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(text) };
  });
  vi.resetModules();
  prefill = await import('./prefill');
});

afterEach(() => vi.unstubAllGlobals());

const rows = (text: string) => parseImport(text, { termSep: ',', rowSep: '\n' });
const fill = async (text: string, lang: 'ru' | 'en' = 'ru') => prefill.prefillRows(rows(text), lang);

describe('prefillRows', () => {
  it('fills article, plural and verb forms from the dictionary, keeping the typed translation', async () => {
    const [tisch, gehen, schoen] = await fill('Tisch,столик\ngehen,ходить\nschön,');
    expect(tisch.fields).toEqual({
      term: 'Tisch',
      translation: 'столик',
      pos: 'noun',
      genders: ['m'],
      plural: 'Tische',
      praeteritum: '',
      partizip2: '',
      auxiliary: '',
    });
    expect(tisch.fromDict).toBe(true);
    expect(gehen.fields).toMatchObject({ pos: 'verb', praeteritum: 'ging', partizip2: 'gegangen', auxiliary: 'sein', translation: 'ходить' });
    // An empty translation is filled from the dictionary, in the chosen language.
    expect(schoen.fields).toMatchObject({ pos: 'adj', translation: 'красивый' });
    expect((await fill('schön,', 'en'))[0].fields.translation).toBe('beautiful');
  });

  it('lets what the user typed win over the dictionary', async () => {
    const [tisch, gehen] = await fill('das Tisch, die Tischlein,стол\ngehen, gung, hat gegangt,идти');
    expect(tisch.fields).toMatchObject({ term: 'Tisch', pos: 'noun', genders: ['n'], plural: 'Tischlein', translation: 'стол' });
    expect(gehen.fields).toMatchObject({ pos: 'verb', praeteritum: 'gung', partizip2: 'gegangt', auxiliary: 'haben' });
  });

  it('picks the typed article of a noun whose articles differ in meaning', async () => {
    const [die, der, bare] = await fill('die See,море\nder See,озеро\nSee,');
    expect(die.fields).toMatchObject({ genders: ['f'], plural: 'Seen', translation: 'море' });
    expect(der.fields).toMatchObject({ genders: ['m'], plural: 'Seen', translation: 'озеро' });
    // No article typed: the most common one, with its translation.
    expect(bare.fields).toMatchObject({ genders: ['m'], translation: 'озеро' });
  });

  it('prefers the typed part of speech among homographs', async () => {
    const [noun, verb] = await fill('das Essen,\nessen, aß, hat gegessen,');
    expect(noun.fields).toMatchObject({ term: 'Essen', pos: 'noun', genders: ['n'], translation: 'еда' });
    expect(verb.fields).toMatchObject({ term: 'essen', pos: 'verb', translation: 'есть' });
  });

  it('keeps an inflected form as typed and only suggests the lemma', async () => {
    const [haeuser, ging] = await fill('Häuser,дома\nging,шёл');
    expect(haeuser.fields).toMatchObject({ term: 'Häuser', pos: 'other', genders: [], plural: '', translation: 'дома' });
    expect(haeuser.lemma).toBe('Haus');
    expect(haeuser.fromDict).toBe(false);
    expect(ging.fields.term).toBe('ging');
    expect(ging.lemma).toBe('gehen');
  });

  it('gives participles used as adjectives no lemma hint', async () => {
    const verb = { term: 'aufregen', pos: 'verb', genders: [], plural: '', praeteritum: 'regte auf', partizip2: 'aufgeregt', auxiliary: 'haben', tr: { ru: '', en: '' }, rank: 1 } as const;
    const lookup = async (w: string): Promise<LocalHit[]> => [{ entry: { ...verb, genders: [] }, form: w }];
    const [p1, p2, other] = await prefill.prefillRows(rows('aufregend,\naufgeregt,\nregt,'), 'ru', lookup);
    expect(p1.lemma).toBeUndefined();
    expect(p2.lemma).toBeUndefined();
    expect(other.lemma).toBe('aufregen');
  });

  it('looks up reflexive verbs and verbs with a preposition by their verb', async () => {
    const [sich, mit, phrase] = await fill('sich gehen,\ngehen über,\nwird in ... gegangen,');
    expect(sich.fields).toMatchObject({ term: 'sich gehen', pos: 'verb', praeteritum: 'ging' });
    expect(mit.fields).toMatchObject({ term: 'gehen über', pos: 'verb', partizip2: 'gegangen' });
    expect(phrase.fields).toMatchObject({ term: 'wird in ... gegangen', pos: 'other', praeteritum: '' });
    expect(phrase.lemma).toBeUndefined();
  });

  it('saves unknown words as typed', async () => {
    const [x] = await fill('Quatschwort,чепуха');
    expect(x.fields).toEqual({
      term: 'Quatschwort',
      translation: 'чепуха',
      pos: 'other',
      genders: [],
      plural: '',
      praeteritum: '',
      partizip2: '',
      auxiliary: '',
    });
    expect(x.fromDict).toBe(false);
    expect(x.lemma).toBeUndefined();
  });

  it('saves rows as typed when the dictionary is unavailable', async () => {
    const lookup = async (): Promise<LocalHit[]> => {
      throw new Error('offline');
    };
    const [r] = await prefill.prefillRows(rows('der Tisch,стол'), 'ru', lookup);
    expect(r.fields).toMatchObject({ term: 'Tisch', genders: ['m'], plural: '', translation: 'стол' });
  });

  it('handles 500 rows in order, looking words up in parallel batches', async () => {
    let inFlight = 0;
    let peak = 0;
    const lookup = async (w: string): Promise<LocalHit[]> => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return [{ entry: { term: w, pos: 'adj', genders: [], plural: '', praeteritum: '', partizip2: '', auxiliary: '', tr: { ru: `ru:${w}`, en: '' }, rank: 1 } }];
    };
    const text = Array.from({ length: 500 }, (_, i) => `wort${i},`).join('\n');
    const out = await prefill.prefillRows(rows(text), 'ru', lookup);
    expect(out).toHaveLength(500);
    expect(out[499].fields).toMatchObject({ term: 'wort499', translation: 'ru:wort499', pos: 'adj' });
    expect(peak).toBeGreaterThan(10);
  });
});

describe('importCards', () => {
  it('builds cards in pasted order and marks them for the online fill only when auto-fill is on', async () => {
    const pf = await fill('der Tisch,стол\ngehen,идти');
    const on = prefill.importCards(7, pf, true, 1000);
    expect(on.map((c) => [c.term, c.setId, c.createdAt, c.needsFill])).toEqual([
      ['Tisch', 7, 1000, 1],
      ['gehen', 7, 1001, 1],
    ]);
    expect(on[0]).toMatchObject({ genders: ['m'], plural: 'Tische', examples: [], known: 0, presetId: '' });
    expect(prefill.importCards(7, pf, false, 1000).map((c) => c.needsFill)).toEqual([0, 0]);
  });

  it('wants an online fill while examples, grammar or a translation are missing', () => {
    const base = {
      term: 'Tisch',
      translation: 'стол',
      pos: 'noun' as const,
      genders: ['m' as const],
      plural: 'Tische',
      praeteritum: '',
      partizip2: '',
      auxiliary: '' as const,
    };
    const ex = [{ de: 'Der Tisch ist neu.' }];
    expect(prefill.wantsOnlineFill({ ...base, examples: [] })).toBe(true);
    expect(prefill.wantsOnlineFill({ ...base, examples: ex })).toBe(false);
    expect(prefill.wantsOnlineFill({ ...base, examples: ex, plural: '' })).toBe(true);
    expect(prefill.wantsOnlineFill({ ...base, examples: ex, translation: '' })).toBe(true);
  });
});
