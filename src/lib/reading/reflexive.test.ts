// Reflexive verbs in running text: with a small injected dictionary, and with the real offline
// dictionary (public/dict, served by a stubbed fetch) whose verbs get their `reflexive` flags
// from a list here until the generated data carries them.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LexEntry, LocalHit } from '../dict/types';
import type { Lookup } from './separable';
import { tokenize, type Token } from './text';

type Reflexive = typeof import('./reflexive');
type Separable = typeof import('./separable');
type Local = typeof import('../dict/local');

const DICT = path.join(__dirname, '../../../public/dict');

let refl: Reflexive;
let sep: Separable;
let local: Local;
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
  refl = await import('./reflexive');
  sep = await import('./separable');
  local = await import('../dict/local');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------- A tiny injected dictionary ----------

function lex(term: string, over: Partial<LexEntry> = {}): LexEntry {
  return { term, pos: 'verb', genders: [], plural: '', praeteritum: '', partizip2: '', auxiliary: 'haben', tr: { ru: '', en: '' }, rank: 100, ...over };
}

const treffen = lex('treffen', { reflexive: 'also', tr: { ru: 'встретить', en: 'meet' }, trRefl: { ru: 'встречаться', en: 'meet up' } });
const beeilen = lex('beeilen', { reflexive: 'only', tr: { ru: 'торопиться', en: 'hurry' } });
const sehen = lex('sehen');
const haben = lex('haben');
const TINY: Record<string, LexEntry[]> = {
  treffen: [treffen],
  trifft: [treffen],
  beeilt: [beeilen],
  beeilen: [beeilen],
  sieht: [sehen],
  hat: [haben],
  morgen: [lex('morgen', { pos: 'other' })],
};
const tiny: Lookup = async (w) => (TINY[w.toLowerCase()] ?? []).map((entry) => ({ entry }));

/** Found reflexive verbs as [verb, pronoun, lemma]. */
async function findWith(lookup: Lookup, text: string, withSplits = false): Promise<{ tokens: Token[]; found: string[][] }> {
  const tokens = tokenize(text);
  const splits = withSplits ? await sep.findSplitVerbs(tokens, lookup) : undefined;
  const map = await refl.findReflexives(tokens, lookup, splits);
  const unique = [...new Set(map.values())].sort((a, b) => a.verb - b.verb);
  return {
    tokens,
    found: unique.map((r) => [refl.reflexiveText(tokens, r), r.entry.term]),
  };
}

describe('findReflexives (injected dictionary)', () => {
  it('maps verb and pronoun to one object with the reflexive reading', async () => {
    const tokens = tokenize('Wir treffen uns morgen.');
    const map = await refl.findReflexives(tokens, tiny);
    const verb = tokens.findIndex((t) => t.text === 'treffen');
    const pronoun = tokens.findIndex((t) => t.text === 'uns');
    expect(map.size).toBe(2);
    expect(map.get(verb)).toBe(map.get(pronoun));
    expect(map.get(verb)).toMatchObject({ verb, pronoun, entry: { term: 'sich treffen', tr: { ru: 'встречаться' } } });
    expect(map.get(verb)!.particle).toBeUndefined();
  });

  it.each([
    ['Wir treffen uns morgen.', 'treffen uns'],
    ['Treffen wir uns?', 'Treffen … uns'],
    ['Morgen treffen wir uns.', 'treffen … uns'],
    ['Er hat sich beeilt.', 'sich beeilt'],
    ['Ich weiß, dass wir uns morgen treffen.', 'uns … treffen'],
    ['Sie trifft sich mit ihm.', 'trifft sich'],
    ['Beeil dich!', 'Beeil dich'],
  ])('%s', async (text, written) => {
    const { found } = await findWith(tiny, text);
    expect(found.map((f) => f[0])).toEqual([written]);
  });

  it('does nothing for verbs without the flag or when the dictionary has none', async () => {
    expect((await findWith(tiny, 'Er sieht mich.')).found).toEqual([]);
    const none: Lookup = async (w) => (TINY[w.toLowerCase()] ?? []).map((e) => ({ entry: { ...e, reflexive: undefined } }));
    expect((await findWith(none, 'Wir treffen uns morgen.')).found).toEqual([]);
  });

  it('the pronoun must agree with the subject', async () => {
    expect((await findWith(tiny, 'Sie trifft mich morgen.')).found).toEqual([]);
    expect((await findWith(tiny, 'Er trifft dich.')).found).toEqual([]);
    expect((await findWith(tiny, 'Wir treffen euch.')).found).toEqual([]);
    expect((await findWith(tiny, 'Das Kind trifft mich.')).found).toEqual([]);
  });

  it('skips paragraphs without a reflexive pronoun without looking anything up', async () => {
    const spy = vi.fn(tiny);
    expect((await refl.findReflexives(tokenize('Er trifft den Mann.'), spy)).size).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });
});

// ---------- The real dictionary, with reflexive flags ----------

const FLAGS: Record<string, { reflexive: 'also' | 'only'; trRefl?: { ru: string; en: string } }> = {
  treffen: { reflexive: 'also', trRefl: { ru: 'встречаться', en: 'meet up' } },
  beeilen: { reflexive: 'only' },
  freuen: { reflexive: 'also' },
  anziehen: { reflexive: 'also', trRefl: { ru: 'одеваться', en: 'get dressed' } },
  setzen: { reflexive: 'also' },
  handeln: { reflexive: 'also' },
  waschen: { reflexive: 'also' },
  vorstellen: { reflexive: 'also' },
  ausruhen: { reflexive: 'also' },
  erholen: { reflexive: 'only' },
  fühlen: { reflexive: 'also' },
  interessieren: { reflexive: 'also' },
  unterhalten: { reflexive: 'also' },
  kümmern: { reflexive: 'also' },
  legen: { reflexive: 'also' },
  holen: { reflexive: 'also' },
  meinen: { reflexive: 'also' },
  ansehen: { reflexive: 'also' },
};

/** lookupLocal() with the flags above (as the regenerated dictionary will have them). */
const flagged: Lookup = async (w) =>
  (await local.lookupLocal(w)).map((h): LocalHit => {
    const f = FLAGS[h.entry.term];
    return f && h.entry.pos === 'verb' ? { ...h, entry: { ...h.entry, ...f } } : h;
  });

const real = (text: string) => findWith(flagged, text, true);

describe('findReflexives (real dictionary)', () => {
  it.each([
    ['Wir treffen uns morgen am Bahnhof.', 'treffen uns', 'sich treffen'],
    ['Treffen wir uns heute?', 'Treffen … uns', 'sich treffen'],
    ['Morgen treffen wir uns im Park.', 'treffen … uns', 'sich treffen'],
    ['Er hat sich beeilt.', 'sich beeilt', 'sich beeilen'],
    ['Ich habe mich sehr gefreut.', 'mich … gefreut', 'sich freuen'],
    ['Ich freue mich auf das Wochenende.', 'freue mich', 'sich freuen'],
    ['Freust du dich?', 'Freust … dich', 'sich freuen'],
    ['Ich weiß, dass wir uns morgen treffen.', 'uns … treffen', 'sich treffen'],
    ['Er kommt nicht, weil er sich erholen muss.', 'sich erholen', 'sich erholen'],
    ['Ich ziehe mich schnell an.', 'ziehe mich … an', 'sich anziehen'],
    ['Ich habe mich schon angezogen.', 'mich … angezogen', 'sich anziehen'],
    ['Darf ich mich vorstellen?', 'mich vorstellen', 'sich vorstellen'],
    ['Es handelt sich um einen Fehler.', 'handelt sich', 'sich handeln'],
    ['Die Kinder setzen sich auf den Boden.', 'setzen sich', 'sich setzen'],
    ['Beeil dich!', 'Beeil dich', 'sich beeilen'],
    ['Beeilen Sie sich bitte.', 'Beeilen … sich', 'sich beeilen'],
    ['Wascht euch die Hände!', 'Wascht euch', 'sich waschen'],
    ['Sie interessiert sich für Musik.', 'interessiert sich', 'sich interessieren'],
    ['Wir haben uns lange unterhalten.', 'uns … unterhalten', 'sich unterhalten'],
    ['Er hat keine Lust, sich zu beeilen.', 'sich … beeilen', 'sich beeilen'],
    ['Der Mann, der sich um den Garten kümmert, ist alt.', 'sich … kümmert', 'sich kümmern'],
    ['Nun legt euch ans Feuer!', 'legt euch', 'sich legen'],
    ['Er hat sich meine Bücher angesehen.', 'sich … angesehen', 'sich ansehen'], // not meinen
  ])('%s', async (text, written, lemma) => {
    expect((await real(text)).found).toEqual([[written, lemma]]);
  });

  it('takes the subject over into a continuing clause', async () => {
    expect((await real('Ich stehe auf, wasche mich und ziehe mich an.')).found).toEqual([
      ['wasche mich', 'sich waschen'],
      ['ziehe mich an', 'sich anziehen'],
    ]);
    expect((await real('Ich habe gearbeitet und mich dann ausgeruht.')).found).toEqual([['mich … ausgeruht', 'sich ausruhen']]);
  });

  it('maps all three tokens of a split reflexive verb to one object', async () => {
    const tokens = tokenize('Ich ziehe mich schnell an.');
    const splits = await sep.findSplitVerbs(tokens, flagged);
    const map = await refl.findReflexives(tokens, flagged, splits);
    const at = (w: string) => tokens.findIndex((t) => t.text === w);
    const r = map.get(at('ziehe'))!;
    expect(r).toMatchObject({ verb: at('ziehe'), pronoun: at('mich'), particle: at('an'), entry: { term: 'sich anziehen' } });
    expect(map.get(at('mich'))).toBe(r);
    expect(map.get(at('an'))).toBe(r);
    expect(r.entry.tr.ru).toBe('одеваться');
  });

  it.each([
    'Er sieht mich.', // sehen: not reflexive; mich doesn't agree with er anyway
    'Sie kennt mich.',
    'Es freut mich.', // es freut mich: mich is no reflexive of es
    'Das freut mich sehr.',
    'Ich treffe dich morgen.',
    'Er trifft uns morgen.',
    'Ich rufe dich morgen an.', // anrufen: not reflexive; rufen isn't tried
    'Er denkt nur an sich.', // after a preposition
    'Sie kommt mit uns.',
    'Mir ist kalt.',
    'Gib mir das Buch!',
    'Da ist jemand und will dich holen.', // a modal has no imperative
    'Nun hol mich hier raus!', // an imperative takes no "mich"
  ])('no pair: %s', async (text) => {
    expect((await real(text)).found).toEqual([]);
  });

  it('without flags (the dictionary as generated before) nothing is paired', async () => {
    const tokens = tokenize('Wir treffen uns morgen.');
    const map = await refl.findReflexives(tokens, (w) => local.lookupLocal(w));
    const hasFlags = !!(await local.lookupLocal('treffen'))[0]?.entry.reflexive;
    expect(map.size).toBe(hasFlags ? 2 : 0);
  });
});

describe('reflexiveVerbs', () => {
  it('returns one map per paragraph and never throws', async () => {
    const maps = await refl.reflexiveVerbs([tokenize('Wir treffen uns.'), tokenize('Er geht.'), []]);
    expect(maps).toHaveLength(3);
    failing = true;
    vi.resetModules();
    refl = await import('./reflexive');
    expect(await refl.reflexiveVerbs([tokenize('Wir treffen uns morgen.'), []])).toEqual([new Map(), new Map()]);
  });
});

describe('verbGroups and texts', () => {
  it('a reflexive verb wins over the split verb sharing its tokens', async () => {
    const tokens = tokenize('Ich ziehe mich schnell an, dann rufe ich dich an.');
    const splits = await sep.findSplitVerbs(tokens, flagged);
    const reflexives = await refl.findReflexives(tokens, flagged, splits);
    const groups = refl.verbGroups(splits, reflexives);
    const at = (w: string, from = 0) => tokens.findIndex((t, i) => i >= from && t.text === w);
    const g = groups.get(at('an'))!;
    expect(g).toMatchObject({ verb: at('ziehe'), tokens: [at('ziehe'), at('mich'), at('an')], entry: { term: 'sich anziehen' } });
    expect(refl.groupText(tokens, g)).toBe('ziehe mich … an');
    const call = groups.get(at('rufe'))!;
    expect(call.entry.term).toBe('anrufen');
    expect(call.tokens).toEqual([at('rufe'), at('an', at('dich'))]);
    expect(refl.groupText(tokens, call)).toBe('rufe … an');
    expect(new Set(groups.values()).size).toBe(2);
  });

  it('joinedText joins neighbours with a space and gaps with an ellipsis', () => {
    const tokens = tokenize('Er hört auf.');
    expect(refl.joinedText(tokens, [2, 0])).toBe('Er hört');
    expect(refl.joinedText(tokens, [0, 4])).toBe('Er … auf');
  });
});
