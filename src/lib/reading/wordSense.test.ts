// The reading of a word at its position: the pure ranking with a small stub dictionary, and real
// sentences against the real offline dictionary (public/dict, served by a stubbed fetch).
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LexEntry, LocalHit } from '../dict/types';
import { tokenize } from './text';
import { rankReadings, tokenReadings } from './wordSense';

const DICT = path.join(__dirname, '../../../public/dict');

function lex(term: string, pos: LexEntry['pos'], rank = 100): LexEntry {
  return { term, pos, genders: [], plural: '', praeteritum: '', partizip2: '', auxiliary: '', tr: { ru: '', en: '' }, rank };
}

const hit = (entry: LexEntry, form?: string): LocalHit => (form ? { entry, form } : { entry });

const Arm = lex('Arm', 'noun');
const Arme = lex('Arme', 'noun');
const arm = lex('arm', 'adj');
const seinV = lex('sein', 'verb');
const seinO = lex('sein', 'other');
const SeinN = lex('Sein', 'noun');
const er = lex('er', 'other');
const essen = lex('essen', 'verb');
const EssenN = lex('Essen', 'noun');
const reichen = lex('reichen', 'verb');
const weich = lex('weich', 'adj');
const reich = lex('reich', 'adj');
const ReichN = lex('Reich', 'noun');
const meinenV = lex('meinen', 'verb');
const meinO = lex('mein', 'other');
const sieO = lex('sie', 'other');
const SieN = lex('Sie', 'noun');
const lange = lex('lange', 'other');
const lang = lex('lang', 'adj');
const sehen = lex('sehen', 'verb');
const ansehen = lex('ansehen', 'verb');
const arbeiten = lex('arbeiten', 'verb');
const Arbeit = lex('Arbeit', 'noun');

/** lookupLocal's order, as the real dictionary gives it. */
const STUB: Record<string, LocalHit[]> = {
  armen: [hit(Arm, 'armen'), hit(Arme, 'armen'), hit(arm, 'armen')],
  Armen: [hit(Arm, 'Armen'), hit(Arme, 'Armen'), hit(arm, 'Armen')],
  arm: [hit(arm), hit(Arm)],
  Arm: [hit(Arm), hit(arm)],
  sein: [hit(seinV), hit(seinO), hit(SeinN)],
  Sein: [hit(seinV), hit(SeinN), hit(seinO)],
  seiner: [hit(er, 'seiner'), hit(seinO, 'seiner')],
  essen: [hit(essen), hit(EssenN)],
  Essen: [hit(essen), hit(EssenN)],
  reichen: [hit(reichen), hit(ReichN, 'reichen'), hit(weich, 'reichen'), hit(reich, 'reichen')],
  meinen: [hit(meinenV), hit(meinO, 'meinen')],
  Sie: [hit(sieO), hit(SieN)],
  sie: [hit(sieO), hit(SieN)],
  lange: [hit(lange), hit(lang, 'lange')],
  sah: [hit(sehen, 'sah'), hit(ansehen, 'sah')],
  alte: [hit(lex('alt', 'adj'), 'alte')],
  Arbeiten: [hit(Arbeit, 'Arbeiten'), hit(arbeiten)],
};
const hitsOf = (w: string) => STUB[w] ?? [];

/** Readings of `word` in `text`, as "term/pos". */
function ranked(text: string, word: string, nth = 0): string[] {
  const tokens = tokenize(text);
  const at = tokens.flatMap((t, i) => (t.text === word ? [i] : []))[nth];
  return rankReadings(tokens, at, hitsOf).map((e) => `${e.term}/${e.pos}`);
}

describe('rankReadings', () => {
  it.each([
    // Lower case: no noun.
    ['Ich helfe armen Leuten.', 'armen', 'arm/adj'],
    ['Er ist arm.', 'arm', 'arm/adj'],
    ['Am Abend essen wir.', 'essen', 'essen/verb'],
    // Capitalised mid-sentence: a noun.
    ['Er hebt den Arm.', 'Arm', 'Arm/noun'],
    ['Das Essen ist gut.', 'Essen', 'Essen/noun'],
    ['Er sah Essen auf dem Tisch.', 'Essen', 'Essen/noun'],
    // …also after a comma, but not at the start of a sentence: the lookup's order stays.
    ['Brot, Essen und Wein.', 'Essen', 'Essen/noun'],
    ['Essen ist gut.', 'Essen', 'essen/verb'],
    ['Er sagte: Essen ist gut.', 'Essen', 'essen/verb'],
    ['„Essen ist gut.“', 'Essen', 'essen/verb'],
    // A capitalised infinitive before "Sie" or "wir" opens a question or a request.
    ['Arbeiten Sie hier?', 'Arbeiten', 'arbeiten/verb'],
    ['Arbeiten wir!', 'Arbeiten', 'arbeiten/verb'],
    ['Er sagte: Arbeiten sie zusammen?', 'Arbeiten', 'arbeiten/verb'],
    ['Arbeiten sind fertig.', 'Arbeiten', 'Arbeit/noun'],
    ['Wir nennen Arbeiten Sie.', 'Arbeiten', 'Arbeit/noun'],
    // "Sie" is never the noun.
    ['Wir haben Sie gesehen.', 'Sie', 'sie/other'],
    // Determiner before a noun.
    ['Sein Arm ist lang.', 'Sein', 'sein/other'],
    ['Sein Frau ist da.', 'Sein', 'sein/other'],
    ['Er hebt sein Arm.', 'sein', 'sein/other'],
    ['Er sieht sein alte Frau.', 'sein', 'sein/other'],
    ['Wegen seiner Frau.', 'seiner', 'sein/other'],
    ['Er sieht meinen Arm.', 'meinen', 'mein/other'],
    ['Was meinen Sie?', 'meinen', 'meinen/verb'],
    // The noun "Sein" stays a noun.
    ['Das Sein Gottes.', 'Sein', 'Sein/noun'],
    // zu, and a modal at the end of the clause.
    ['Es ist schön, zu sein.', 'sein', 'sein/verb'],
    ['Das kann sein.', 'sein', 'sein/verb'],
    ['Das kann sein, sagt er.', 'sein', 'sein/verb'],
    ['Es wird wohl sein Bruder sein.', 'sein', 'sein/other'],
    // After an article: an adjective before a noun, no finite verb.
    ['Die reichen Leute essen.', 'reichen', 'reich/adj'],
    ['Die reichen nicht.', 'reichen', 'reichen/verb'],
    ['Die lange Zeit.', 'lange', 'lang/adj'],
    ['Im Haus ist die lange.', 'lange', 'lange/other'],
    ['Er kam zum reichen Mann.', 'reichen', 'reich/adj'],
    ['Viele reichen Anna das Brot.', 'reichen', 'reichen/verb'],
    ['Wir helfen zu reichen Leuten.', 'reichen', 'reichen/verb'],
  ])('%s → %s = %s', (text, word, best) => {
    expect(ranked(text, word)[0]).toBe(best);
  });

  it('takes the second "sein" of a sentence for the verb', () => {
    expect(ranked('Es wird wohl sein Bruder sein.', 'sein', 1)[0]).toBe('sein/verb');
  });

  it('moves nouns behind everything for a lower-case word, keeping the rest in order', () => {
    expect(ranked('Es sind armen.', 'armen')).toEqual(['arm/adj', 'Arm/noun', 'Arme/noun']);
  });

  it('leaves text in all capitals alone', () => {
    const tokens = tokenize('ER HEBT ARM');
    const shouting = () => [hit(arm), hit(Arm)];
    expect(rankReadings(tokens, 4, shouting).map((e) => e.term)).toEqual(['arm', 'Arm']);
  });

  it('keeps the order when no rule applies', () => {
    expect(ranked('Dann lange.', 'lange')).toEqual(['lange/other', 'lang/adj']);
  });

  it('drops duplicates and compounds of another verb among the hits', () => {
    expect(ranked('Er sah ihn.', 'sah')).toEqual(['sehen/verb']);
    const tokens = tokenize('Morgen');
    const twice = () => [hit(lex('Morgen', 'noun', 149)), hit(lex('Morgen', 'noun', 18286))];
    expect(rankReadings(tokens, 0, twice)).toHaveLength(1);
  });

  it('keeps a compound typed as itself', () => {
    const tokens = tokenize('Wir ansehen');
    const both = () => [hit(ansehen), hit(sehen, 'ansehen')];
    expect(rankReadings(tokens, 2, both).map((e) => e.term)).toEqual(['ansehen', 'sehen']);
  });
});

describe('tokenReadings with a stub', () => {
  const lookup = async (w: string) => hitsOf(w);

  it('lists only tokens with 2+ different readings', async () => {
    const tokens = tokenize('Er sah armen Leuten.');
    const [map] = await tokenReadings([tokens], lookup);
    expect([...map.keys()]).toEqual([tokens.findIndex((t) => t.text === 'armen')]);
  });

  it('asks once per spelling, in batches', async () => {
    const seen: string[] = [];
    const text = Array.from({ length: 100 }, (_, i) => `w${i} arm`).join(' ');
    await tokenReadings([tokenize(text)], async (w) => {
      seen.push(w);
      return [];
    });
    expect(seen.filter((w) => w === 'arm')).toHaveLength(1);
  });

  it('never throws: a failing word is unknown, a throwing lookup gives no readings', async () => {
    const tokens = tokenize('Er ist arm und armen.');
    const failing = async (w: string) => {
      if (w === 'arm') throw new Error('no piece');
      return hitsOf(w);
    };
    const [map] = await tokenReadings([tokens], failing);
    expect([...map.keys()]).toEqual([tokens.findIndex((t) => t.text === 'armen')]);
    const broken = () => {
      throw new Error('sync');
    };
    expect(await tokenReadings([tokens, tokens], broken)).toEqual([new Map(), new Map()]);
  });
});

describe('real sentences', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const name = /\/dict\/([\w.-]+\.json)$/.exec(url)?.[1];
      const f = name && path.join(DICT, name);
      return f && fs.existsSync(f) ? new Response(fs.readFileSync(f, 'utf8')) : new Response('', { status: 404 });
    });
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Best reading of `word` in `text` as "term/pos"; undefined when it has only one reading. */
  async function best(text: string, word: string): Promise<string | undefined> {
    const { tokenReadings: readings } = await import('./wordSense');
    const tokens = tokenize(text);
    const [map] = await readings([tokens]);
    const e = map.get(tokens.findIndex((t) => t.text === word))?.[0];
    return e && `${e.term}/${e.pos}`;
  }

  it.each([
    ['Er hebt seinen Arm.', 'Arm', 'Arm/noun'],
    ['Sie hilft der armen Frau.', 'armen', 'arm/adj'],
    ['Die arme Frau weint.', 'arme', 'arm/adj'],
    ['Er ist arm.', 'arm', 'arm/adj'],
    ['Sein Arm ist lang.', 'Sein', 'sein/other'],
    ['Sein Arm ist lang.', 'Arm', 'Arm/noun'],
    ['Das kann sein.', 'sein', 'sein/verb'],
    ['Er scheint müde zu sein.', 'sein', 'sein/verb'],
    ['Am Abend essen wir.', 'essen', 'essen/verb'],
    ['Das Essen ist gut.', 'Essen', 'Essen/noun'],
    ['Er sieht sein altes Haus.', 'sein', 'sein/other'],
    ['Wegen seiner Frau bleibt er.', 'seiner', 'sein/other'],
    ['Er kennt meinen Bruder.', 'meinen', 'mein/other'],
    ['Was meinen Sie?', 'meinen', 'meinen/verb'],
    ['Die reichen Leute essen viel.', 'reichen', 'reich/adj'],
    ['Das reicht uns nicht, die reichen nicht.', 'reichen', 'reichen/verb'],
    ['Es regnet.', 'Es', 'es/other'],
    ['Wir haben Sie gesehen.', 'Sie', 'sie/other'],
    ['Er ging seinen Weg.', 'Weg', 'Weg/noun'],
    ['Er geht weg.', 'weg', 'weg/other'],
    ['Viele Menschen leben hier.', 'leben', 'leben/verb'],
    ['Das Leben ist schön.', 'Leben', 'Leben/noun'],
    ['Am Morgen trinkt er Tee.', 'Morgen', 'Morgen/noun'],
    ['Wir kommen morgen.', 'morgen', 'morgen/other'],
  ])('%s: %s = %s', async (text, word, reading) => {
    expect(await best(text, word)).toBe(reading);
  });

  it('has only the possessive for inflected "sein"', async () => {
    expect(await best('Er hebt seinen Arm.', 'seinen')).toBeUndefined();
    expect(await best('Er liebt seine alte Frau.', 'seine')).toBeUndefined();
  });

  it('gives a verb with compounds no list when the plain verb is the only reading', async () => {
    expect(await best('Er sah sie.', 'sah')).toBeUndefined();
  });
});
