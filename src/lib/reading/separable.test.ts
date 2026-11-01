// Separable verbs split across a clause, detected against the real offline dictionary
// (public/dict, served by a stubbed fetch).
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LexEntry } from '../dict/types';
import type { Lookup } from './separable';
import { tokenize, type Token } from './text';

type Separable = typeof import('./separable');
type Local = typeof import('../dict/local');

const DICT = path.join(__dirname, '../../../public/dict');

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
  sep = await import('./separable');
  local = await import('../dict/local');
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

const auffaechern: LexEntry = {
  term: 'auffächern',
  pos: 'verb',
  genders: [],
  plural: '',
  praeteritum: 'fächerte auf',
  partizip2: 'aufgefächert',
  auxiliary: 'haben',
  tr: { ru: 'раскрывать веером', en: 'fan out' },
  rank: 90000,
};

/** The real dictionary plus the rare-verb layer: forms of auffächern, without a verb fächern. */
const withRare: Lookup = async (w) => {
  const hits = await local.lookupLocal(w);
  const lower = w.toLowerCase();
  if (lower === 'auffächern') return [{ entry: auffaechern }];
  if (lower.startsWith('auffächer') || lower === 'fächerte') return [...hits, { entry: auffaechern, form: w }];
  return hits;
};

async function pairsWithRare(text: string): Promise<[string, string, string][]> {
  const tokens = tokenize(text);
  const map = await sep.findSplitVerbs(tokens, withRare);
  const unique = [...new Set(map.values())].sort((a, b) => a.verb - b.verb);
  return unique.map((s) => [tokens[s.verb].text, tokens[s.particle].text, s.entry.term]);
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

  // Joined verbs whose base verb isn't a dictionary verb (no "strengen", "regen", "spulen").
  it.each([
    ['Ich strenge mich sehr an.', 'strenge', 'an', 'anstrengen'],
    ['Streng dich an!', 'Streng', 'an', 'anstrengen'],
    ['Die Kinder strengen sich an.', 'strengen', 'an', 'anstrengen'],
    ['Das regte mich auf.', 'regte', 'auf', 'aufregen'],
    ['Er breitete die Decke aus.', 'breitete', 'aus', 'ausbreiten'],
    ['Er spulte den Film vor.', 'spulte', 'vor', 'vorspulen'],
    ['Sie ruhte sich dort aus.', 'ruhte', 'aus', 'ausruhen'],
    ['Er harrte seit Jahren aus.', 'harrte', 'aus', 'ausharren'],
    ['Er wog die Gründe ab.', 'wog', 'ab', 'abwägen'], // strong: listed for both spellings
  ])('unknown base verb: %s', async (text, verb, particle, lemma) => {
    expect((await pairs(text)).found).toEqual([[verb, particle, lemma]]);
  });

  it.each([
    'Er ist uns nahe.', // not nahen ("nahe" + "er" by ending rules)
    'Sie waren mit armen Menschen um.', // an adjective before its noun: not umarmen
    'Regen und Schnee auf.', // a noun: not aufregen
    'Sie ging und spie ihn wieder aus.', // spie is lower-case and has no reading: not ausgehen
  ])('no pair with an unknown base verb: %s', async (text) => {
    expect((await pairs(text)).found).toEqual([]);
  });

  it('a lower-case word with only noun hits is unread, so its segment borrows no verb', async () => {
    expect((await pairs('Geh sittsam und lauf nicht vom Weg ab.')).found).toEqual([['lauf', 'ab', 'ablaufen']]);
    expect((await pairs('Sie lachte und fächerte es auf.')).found).toEqual([]); // not auflachen
  });

  it.each([
    ['Es fächerte sich in die Regenbogen-Farben auf.', 'fächerte'],
    ['Der Pfau fächerte sein Gefieder auf.', 'fächerte'],
    ['Sie lachte und fächerte es auf.', 'fächerte'],
    ['Fächerte es sich auf?', 'Fächerte'],
    ['Fächere die Karten auf!', 'Fächere'],
    ['Sie fächert die Karten auf.', 'fächert'],
  ])('a rare verb from the lazily loaded layer: %s', async (text, verb) => {
    expect(await pairsWithRare(text)).toEqual([[verb, 'auf', 'auffächern']]);
  });

  it('does no lookups for a paragraph without a clause-final particle', async () => {
    const spy = vi.fn(withRare);
    expect((await sep.findSplitVerbs(tokenize('Er sieht den Mann. Sie geht nach Hause.'), spy)).size).toBe(0);
    expect(spy).not.toHaveBeenCalled();
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

describe('splitGuess', () => {
  /** The guess for the `word` in `text` (the n-th occurrence), written as tokens. */
  function guess(text: string, word: string, n = 0) {
    const tokens = tokenize(text);
    const t = tokens.flatMap((x, i) => (x.text === word ? [i] : []))[n];
    const g = sep.splitGuess(tokens, t);
    if (!g) return null;
    const out: Record<string, string> = { verb: tokens[g.verb].text, particle: tokens[g.particle].text, term: g.term };
    if (g.pronoun !== undefined) out.pronoun = tokens[g.pronoun].text;
    return out;
  }

  it.each([
    ['Es fächerte sich in die Regenbogen-Farben auf.', 'fächerte', 'sich', 'auf', 'sich auffächern'],
    ['Er lenkte ihn ab.', 'lenkte', undefined, 'ab', 'ablenken'],
    ['Ich lenkte mich ab.', 'lenkte', 'mich', 'ab', 'sich ablenken'],
    ['Du lenkst dir das ab.', 'lenkst', 'dir', 'ab', 'sich ablenken'],
    ['Die Gruppe teilte sich in zwei Hälften auf.', 'teilte', 'sich', 'auf', 'sich aufteilen'],
    ['Die kleine Gruppe teilte sich auf.', 'teilte', 'sich', 'auf', 'sich aufteilen'],
    ['Am Ende fächerte es sich auf.', 'fächerte', 'sich', 'auf', 'sich auffächern'],
    ['Dann fächerte es sich auf.', 'fächerte', 'sich', 'auf', 'sich auffächern'],
    ['Nun teilte die Gruppe sich auf.', 'teilte', 'sich', 'auf', 'sich aufteilen'],
    ['Frau Meier lenkte ihn ab.', 'lenkte', undefined, 'ab', 'ablenken'],
    ['Sie lachte und fächerte es auf.', 'fächerte', undefined, 'auf', 'auffächern'],
    ['Als er kam, fächerte sie sich auf.', 'fächerte', 'sich', 'auf', 'sich auffächern'],
    ['Fächerte es sich auf?', 'Fächerte', 'sich', 'auf', 'sich auffächern'],
    ['Fächere die Karten auf!', 'Fächere', undefined, 'auf', 'auffächern'],
    ['Fächer es auf.', 'Fächer', undefined, 'auf', 'auffächern'],
    ['Lenk dich ab!', 'Lenk', 'dich', 'ab', 'sich ablenken'],
    ['Lenken Sie sich ab!', 'Lenken', 'sich', 'ab', 'sich ablenken'],
    ['Er fächerte Karten auf.', 'fächerte', undefined, 'auf', 'auffächern'],
    ['Sie kam, fächerte alles auf und ging.', 'fächerte', undefined, 'auf', 'auffächern'],
    ['Dann lenken Sie sich ab.', 'lenken', 'sich', 'ab', 'sich ablenken'],
  ])('%s: verb, particle and pronoun give the same guess', (text, verb, pronoun, particle, term) => {
    const want = { verb, particle, term, ...(pronoun ? { pronoun } : {}) };
    for (const tapped of [verb, particle, ...(pronoun ? [pronoun] : [])]) expect(guess(text, tapped)).toEqual(want);
  });

  it('takes the tapped word when nothing stands in the verb\'s place', () => {
    const text = 'Trotz allem fächerte es sich auf.';
    expect(guess(text, 'fächerte')).toEqual({ verb: 'fächerte', pronoun: 'sich', particle: 'auf', term: 'sich auffächern' });
    expect(guess(text, 'auf')).toBeNull();
  });

  it.each([
    ['fächerte', 'auffächern'],
    ['fächerten', 'auffächern'],
    ['fächertest', 'auffächern'],
    ['fächertet', 'auffächern'],
    ['fächere', 'auffächern'],
    ['fächerst', 'auffächern'],
    ['fächert', 'auffächern'],
    ['fächern', 'auffächern'],
    ['lenkte', 'auflenken'],
    ['lenkten', 'auflenken'],
    ['lenktest', 'auflenken'],
    ['lenktet', 'auflenken'],
    ['lenke', 'auflenken'],
    ['lenkst', 'auflenken'],
    ['lenkt', 'auflenken'],
    ['lenken', 'auflenken'],
    ['wartete', 'aufwarten'],
    ['wartet', 'aufwarten'],
    ['arbeitete', 'aufarbeiten'],
    ['arbeitet', 'aufarbeiten'],
    ['arbeitest', 'aufarbeiten'],
    ['bereite', 'aufbereiten'],
    ['redete', 'aufreden'],
    ['redest', 'aufreden'],
    ['öffnete', 'auföffnen'],
    ['handelte', 'aufhandeln'],
    ['handle', 'aufhandeln'],
    ['wandre', 'aufwandern'],
    ['feierte', 'auffeiern'],
    ['dauert', 'aufdauern'],
    ['probierte', 'aufprobieren'],
    ['leerte', 'aufleeren'],
    ['baute', 'aufbauen'],
    ['freute', 'auffreuen'],
    ['reiste', 'aufreisen'],
    ['lachte', 'auflachen'],
  ])('builds the infinitive of %s', (form, term) => {
    expect(guess(`Sie ${form} es auf.`, form)?.term).toBe(term);
  });

  it.each([
    'kam', 'kamen', 'käme', 'ging', 'gingen', 'sah', 'sahen', 'gibt', 'gibst', 'nimmt', 'hielt', 'hielten', 'hält', 'fiel',
    'schrieb', 'schloß', 'zog', 'zogen', 'hat', 'hast', 'hatte', 'hatten', 'ist', 'sind', 'war', 'waren', 'wird', 'wurde',
    'kann', 'konnte', 'muss', 'mußte', 'dachte', 'brachte',
  ])('builds nothing from the strong or irregular %s', (form) => {
    for (const tapped of [form, 'auf']) expect(guess(`Sie ${form} es auf.`, tapped)).toBeNull();
  });

  it.each([
    ['Das Buch lenkte ihn von der Arbeit.', 'lenkte'], // no particle at the end
    ['Es fächerte sich auf dem Tisch.', 'fächerte'],
    ['Ich weiß, weil er es auf.', 'er'],
    ['Ich weiß, dass er sich lenkte ab.', 'lenkte'], // a subordinate clause
    ['Wenn er sich lenkte auf.', 'lenkte'],
    ['Als er es fächerte auf.', 'fächerte'],
    ['Der Mann, der sich lenkte ab, ging.', 'lenkte'],
    ['Augen auf!', 'auf'], // a noun alone
    ['Tür zu!', 'Tür'],
    ['Er lenkte hin und her.', 'lenkte'], // a pair of particles
    ['Sie lenkte auf- und abladen.', 'lenkte'],
    ['Das ist auf.', 'auf'],
    ['Das Fenster auf.', 'auf'],
    ['Er lenkte Auf.', 'lenkte'], // capitalised: no particle
    ['Da fragte sie wieder.', 'fragte'], // an adverb at the end
    ['Er lachte und ging damit fort.', 'fort'],
    ['Nicht lange danach kam sie heim.', 'heim'],
    ['Er glitt wieder zurück.', 'zurück'],
    ['Sie sah sehr müde und eingeschüchtert aus.', 'aus'], // the first segment's verb
    ['Sie sah müde und eingeschüchtert aus.', 'eingeschüchtert'], // a participle
    ['Er sah ihn an, mit langsamen Schritten auf ihn zu.', 'zu'], // adjectives before a noun
    ['Er lief, und kleine Karten fielen ab.', 'kleine'],
    ['Über ein Weilchen fiel es ein.', 'Über'], // a preposition
  ])('no guess: %s (%s)', (text, tapped) => {
    expect(guess(text, tapped)).toBeNull();
  });

  it.each([
    ['Er lenkte heute die Karten ab.', 'heute'],
    ['Er lenkte heute die Karten ab.', 'die'],
    ['Er lenkte heute die Karten ab.', 'Karten'],
    ['Er lenkte heute die Karten ab.', 'Er'],
    ['Ich lenkte dich ab.', 'dich'], // dich doesn't agree with ich
    ['Es fächerte für sich auf.', 'für'],
    ['Es fächerte für sich auf.', 'sich'], // after a preposition
    ['Es lenkte und fächerte auf.', 'und'],
  ])('tokens outside the verb, particle and pronoun: %s (%s)', (text, tapped) => {
    expect(guess(text, tapped)).toBeNull();
  });

  it('keeps out spaces, punctuation and indices outside the paragraph', () => {
    const tokens = tokenize('Er lenkte ihn ab.');
    expect(tokens.flatMap((_, i) => (tokens[i].word ? [] : [sep.splitGuess(tokens, i)]))).toEqual([null, null, null, null]);
    expect(sep.splitGuess(tokens, -1)).toBeNull();
    expect(sep.splitGuess(tokens, tokens.length)).toBeNull();
    expect(sep.splitGuess([], 0)).toBeNull();
  });

  it('looks up nothing and leaves a pronoun that doesn\'t agree out of the term', () => {
    expect(guess('Ich lenkte dich ab.', 'lenkte')).toEqual({ verb: 'lenkte', particle: 'ab', term: 'ablenken' });
    expect(guess('Es fächerte für sich auf.', 'auf')).toEqual({ verb: 'fächerte', particle: 'auf', term: 'auffächern' });
  });
});
