// Separable verbs split across a clause, detected against the real offline dictionary
// (public/dict, served by a stubbed fetch).
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenize, type Token } from './text';

type Separable = typeof import('./separable');

const DICT = path.join(__dirname, '../../../public/dict');

let sep: Separable;
let failing: boolean;

beforeEach(async () => {
  failing = false;
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    if (failing) throw new TypeError('Failed to fetch');
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const name = /\/dict\/([\w.-]+\.json)$/.exec(url)?.[1];
    const f = name && path.join(DICT, name);
    return f && fs.existsSync(f) ? new Response(fs.readFileSync(f, 'utf8')) : new Response('', { status: 404 });
  });
  // Fresh dictionary module per test (its index/piece promises are module state).
  vi.resetModules();
  sep = await import('./separable');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Pairs of a sentence as [verb, particle, lemma], plus the tokens. */
async function pairs(text: string): Promise<{ tokens: Token[]; found: [string, string, string][] }> {
  const tokens = tokenize(text);
  const [map] = await sep.splitVerbs([tokens]);
  const unique = [...new Set(map.values())].sort((a, b) => a.verb - b.verb);
  return { tokens, found: unique.map((s) => [tokens[s.verb].text, tokens[s.particle].text, s.entry.term]) };
}

describe('splitVerbs', () => {
  it('links the verb and its particle to the joined verb, both indices to one object', async () => {
    const tokens = tokenize('Ich rufe dich morgen an.');
    const [map] = await sep.splitVerbs([tokens]);
    const verb = tokens.findIndex((t) => t.text === 'rufe');
    const particle = tokens.findIndex((t) => t.text === 'an');
    expect(map.size).toBe(2);
    expect(map.get(verb)).toBe(map.get(particle));
    expect(map.get(verb)).toMatchObject({ verb, particle, entry: { term: 'anrufen', pos: 'verb' } });
    expect(sep.splitVerbText(tokens, map.get(verb)!)).toBe('rufe … an');
  });

  it.each([
    ['Er kommt heute nicht mit.', 'kommt', 'mit', 'mitkommen'],
    ['Wann fängt der Film an?', 'fängt', 'an', 'anfangen'],
    ['Sie sah ihn lange an.', 'sah', 'an', 'ansehen'],
    ['Lange sah er sie an.', 'sah', 'an', 'ansehen'],
    ['Ich lade dich ein.', 'lade', 'ein', 'einladen'],
    ['Er gibt nicht auf.', 'gibt', 'auf', 'aufgeben'],
    ['Er hört auf, zu reden.', 'hört', 'auf', 'aufhören'],
    ['Wir gehen heute zusammen aus.', 'gehen', 'aus', 'ausgehen'],
    ['Er kam gestern zurück.', 'kam', 'zurück', 'zurückkommen'],
    ['Ruf mich an!', 'Ruf', 'an', 'anrufen'],
    ['„Komm doch mit“, sagte sie.', 'Komm', 'mit', 'mitkommen'],
    ['Wann fängt der Film denn an?', 'fängt', 'an', 'anfangen'],
    ['Er rief sie sofort an.', 'rief', 'an', 'anrufen'],
    ['Wir lernten uns in Berlin kennen.', 'lernten', 'kennen', 'kennenlernen'],
    ['Das Treffen findet morgen statt.', 'findet', 'statt', 'stattfinden'],
    ['Das stellt eine Gefahr dar.', 'stellt', 'dar', 'darstellen'],
    ['Ich kaufe Brot und Milch ein.', 'kaufe', 'ein', 'einkaufen'],
    ['Aus Birkenholz stellte man Wäscheklammern oder Holzschuhe her.', 'stellte', 'her', 'herstellen'],
    ['Rufen Sie mich bitte an.', 'Rufen', 'an', 'anrufen'],
    ['Wir sehen heute Abend fern.', 'sehen', 'fern', 'fernsehen'],
    ['Es tut mir leid.', 'tut', 'leid', 'leidtun'],
    ['Was hast du heute vor?', 'hast', 'vor', 'vorhaben'],
    ['Das kommt darauf an.', 'kommt', 'an', 'ankommen'],
    ['Sein Vater ruft jeden Tag an.', 'ruft', 'an', 'anrufen'],
  ])('%s', async (text, verb, particle, lemma) => {
    expect((await pairs(text)).found).toEqual([[verb, particle, lemma]]);
  });

  it('finds one pair per clause', async () => {
    expect((await pairs('Er steht auf und geht los.')).found).toEqual([
      ['steht', 'auf', 'aufstehen'],
      ['geht', 'los', 'losgehen'],
    ]);
    expect((await pairs('Steh auf und komm mit!')).found).toEqual([
      ['Steh', 'auf', 'aufstehen'],
      ['komm', 'mit', 'mitkommen'],
    ]);
    expect((await pairs('Ich rufe dich an, wenn ich ankomme. Dann hole ich dich ab.')).found).toEqual([
      ['rufe', 'an', 'anrufen'],
      ['hole', 'ab', 'abholen'],
    ]);
  });

  it.each([
    'Ich denke an dich.',
    'Das Buch liegt auf dem Tisch.',
    'Ich weiß, weil er morgen anruft.',
    'Er hat mich gestern angerufen.',
    'Wir gehen nach Hause.',
    'Das ist zu viel.',
    'An der Tür.',
    // From the bundled texts: wrong verbs that used to be picked.
    'Da ging er ein Weilchen neben Rotkäppchen her.', // not herumgehen (ging → umgehen)
    'Er sagte dem Männlein die seltsamsten Namen vor.', // not voraussagen (sagte → aussagen)
    'Er sähe in der Ferne ein Licht und rief seinen Gesellen zu.', // rief has a verb reading: not zusehen
    'Sagte die Frau und schloß das Tor zu.', // unknown schloß may be the verb: not zusagen
    'Sondern auch die weisen Frauen dazu ein.', // weisen is an adjective, not einweisen
    'Und der Griffel fuhr über die Tafel hin.', // not hindern
    'Er ging hin und her.', // a pair of particles
    'Sie standen auf- und abgeladen.', // shortened compound
  ])('no pair: %s', async (text) => {
    expect((await pairs(text)).found).toEqual([]);
  });

  it('keeps paragraphs apart and returns one map per paragraph', async () => {
    const maps = await sep.splitVerbs([tokenize('Ich rufe dich'), tokenize('morgen an.'), tokenize('Er gibt auf.')]);
    expect(maps.map((m) => m.size)).toEqual([0, 0, 2]);
  });

  it('never throws: an unavailable dictionary gives empty maps', async () => {
    failing = true;
    expect(await sep.splitVerbs([tokenize('Ich rufe dich morgen an.'), []])).toEqual([new Map(), new Map()]);
  });
});

describe('splitVerbText', () => {
  it('joins adjacent words with a space and separated ones with an ellipsis', async () => {
    const a = tokenize('Er hört auf.');
    const [ma] = await sep.splitVerbs([a]);
    expect(sep.splitVerbText(a, [...ma.values()][0])).toBe('hört auf');
    const b = tokenize('Ruf mich an!');
    const [mb] = await sep.splitVerbs([b]);
    expect(sep.splitVerbText(b, [...mb.values()][0])).toBe('Ruf … an');
  });
});
