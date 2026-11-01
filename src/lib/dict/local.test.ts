// Offline dictionary runtime on small hand-made pieces (__fixtures__/), served by a stubbed fetch.
import { readFileSync, existsSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  compactForm,
  encodeEntry,
  formsOfEntry,
  narrowTargets,
  normalizeKey as buildNormalizeKey,
  pieceFile,
  ruleCandidates as buildRuleCandidates,
  SUFFIXES as BUILD_SUFFIXES,
} from '../../../scripts/dict/lib.mjs';
import {
  caseFromExamples,
  prepFromExamples,
  prepsOfPattern,
  reflexiveFields,
  reflexiveOf,
} from '../../../scripts/dict/reflexive.mjs';
import { baseFromCompound, compoundOf, hasPlainSense, layoutExtra, noteVerb, selectExtra } from '../../../scripts/dict/separable.mjs';
import type { LexEntry } from './types';

type Local = typeof import('./local');

const FIXTURES = new URL('./__fixtures__/', import.meta.url);

let local: Local;
let requests: string[];
let failing: boolean;
/** Requests that fail while everything else loads. */
let failingFiles: RegExp | null;
/** Extra files served in addition to the fixtures (name → JSON text). */
let extra: Record<string, string>;

function stubFetch() {
  vi.stubGlobal('fetch', async (url: string) => {
    const name = String(url).split('/dict/')[1];
    requests.push(name);
    if (failing || failingFiles?.test(name)) throw new TypeError('Failed to fetch');
    const text = extra[name] ?? (existsSync(new URL(name, FIXTURES)) ? readFileSync(new URL(name, FIXTURES), 'utf8') : null);
    if (text === null) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => JSON.parse(text) };
  });
}

beforeEach(async () => {
  requests = [];
  failing = false;
  failingFiles = null;
  extra = {};
  stubFetch();
  vi.resetModules();
  local = await import('./local');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const terms = (hits: { entry: LexEntry }[]) => hits.map((h) => h.entry.term);

describe('lookupLocal', () => {
  it('finds a lemma and decodes the compact entry', async () => {
    const [hit] = await local.lookupLocal('Tisch');
    expect(hit.form).toBeUndefined();
    expect(hit.entry).toEqual({
      term: 'Tisch',
      pos: 'noun',
      genders: ['m'],
      plural: 'Tische',
      praeteritum: '',
      partizip2: '',
      auxiliary: '',
      tr: { ru: 'стол', en: 'table' },
      rank: 676,
      level: 'A2',
    });
    const [gehen] = await local.lookupLocal('gehen');
    expect(gehen.entry).toMatchObject({ pos: 'verb', praeteritum: 'ging', partizip2: 'gegangen', auxiliary: 'sein', level: 'A1' });
  });

  it('maps inflected forms to their lemmas, across pieces, best first', async () => {
    const hits = await local.lookupLocal('ging');
    expect(terms(hits)).toEqual(['gehen', 'ausgehen']);
    expect(hits[0].form).toBe('ging');
    expect(hits[1].entry.partizip2).toBe('ausgegangen');
    expect(terms(await local.lookupLocal('Häuser'))).toEqual(['Haus']);
    expect(terms(await local.lookupLocal('war'))).toEqual(['sein']);
  });

  it('falls back to ending rules for regular forms that are not stored', async () => {
    const hits = await local.lookupLocal('Tische');
    expect(terms(hits)).toEqual(['Tisch']);
    expect(hits[0].form).toBe('Tische');
    expect(terms(await local.lookupLocal('schönen'))).toEqual(['schön']);
    expect(await local.lookupLocal('Tischlampe')).toEqual([]);
  });

  it('handles any capitalisation, the typed case first', async () => {
    expect(terms(await local.lookupLocal('tisch'))).toEqual(['Tisch']);
    expect(terms(await local.lookupLocal('TISCH'))).toEqual(['Tisch']);
    expect(terms(await local.lookupLocal('Ging'))).toEqual(['gehen', 'ausgehen']);
    expect(terms(await local.lookupLocal('Essen'))).toEqual(['Essen', 'essen']);
    expect(terms(await local.lookupLocal('essen'))).toEqual(['essen', 'Essen']);
  });

  it('returns homographs ordered by rank', async () => {
    const hits = await local.lookupLocal('sein');
    expect(hits.map((h) => `${h.entry.term}/${h.entry.pos}`)).toEqual(['sein/verb', 'sein/other']);
  });

  it('keeps the articles of a noun whose articles differ in meaning apart (See, See#f)', async () => {
    const hits = await local.lookupLocal('See');
    expect(hits.map((h) => [h.entry.term, h.entry.genders, h.entry.tr.ru])).toEqual([
      ['See', ['m'], 'озеро'],
      ['See', ['f'], 'море'],
    ]);
    expect(hits[1].entry).toMatchObject({ plural: 'Seen', level: 'B2', rank: 2632 });
    // Inflected forms reach both ("Seen" by the ending rules).
    expect((await local.lookupLocal('Seen')).map((h) => h.entry.genders[0])).toEqual(['m', 'f']);
    const [m, f] = hits.map((h) => h.entry);
    expect((await local.articleVariants(f)).map((e) => e.genders[0])).toEqual(['m', 'f']);
    expect((await local.articleVariants(m)).map((e) => e.genders[0])).toEqual(['m', 'f']);
    // Other words have just themselves.
    const [seele] = await local.lookupLocal('Seele');
    expect(await local.articleVariants(seele.entry)).toEqual([seele.entry]);
    const [tisch] = await local.lookupLocal('Tisch');
    expect(await local.articleVariants(tisch.entry)).toEqual([tisch.entry]);
  });

  it('strips articles and punctuation', async () => {
    expect(terms(await local.lookupLocal('der Tisch'))).toEqual(['Tisch']);
    expect(terms(await local.lookupLocal('  „Das Haus,“ '))).toEqual(['Haus']);
    expect(terms(await local.lookupLocal('eine Schule.'))).toEqual(['Schule']);
    expect(terms(await local.lookupLocal('die Häuser'))).toEqual(['Haus']);
    expect(await local.lookupLocal('...')).toEqual([]);
  });

  it('decodes the reflexive data of verbs (tags r/R, trailing trRefl and preps)', async () => {
    const [treffen] = await local.lookupLocal('treffen');
    expect(treffen.entry).toEqual({
      term: 'treffen',
      pos: 'verb',
      genders: [],
      plural: '',
      praeteritum: 'traf',
      partizip2: 'getroffen',
      auxiliary: 'haben',
      tr: { ru: 'встретить; попадать', en: 'meet; hit' },
      rank: 195,
      level: 'A1',
      reflexive: 'also',
      trRefl: { ru: 'встречаться', en: '' },
    });
    const [beeilen] = await local.lookupLocal('beeilen');
    expect(beeilen.entry).toMatchObject({ reflexive: 'only', preps: 'mit + Dat', auxiliary: 'haben', level: 'A2' });
    expect(beeilen.entry.trRefl).toBeUndefined();
    // Entries without the data (older pieces, other words) have none of the fields.
    const [gehen] = await local.lookupLocal('gehen');
    expect(gehen.entry).not.toHaveProperty('reflexive');
    expect(gehen.entry).not.toHaveProperty('trRefl');
    expect(gehen.entry).not.toHaveProperty('preps');
    expect((await local.lookupLocal('Treffen'))[0].entry).not.toHaveProperty('reflexive');
  });

  it('reads "sich …" as the reflexive verb', async () => {
    const [hit, ...rest] = await local.lookupLocal('sich treffen');
    expect(rest).toEqual([]); // the noun "Treffen" is not a reflexive verb
    expect(hit.form).toBeUndefined();
    expect(hit.entry).toMatchObject({ term: 'sich treffen', reflexive: 'also', praeteritum: 'traf', rank: 195 });
    // The reflexive meanings' translations, else the verb's own.
    expect(hit.entry.tr).toEqual({ ru: 'встречаться', en: 'meet; hit' });
    expect(terms(await local.lookupLocal('Sich Treffen'))).toEqual(['sich treffen']);
    expect(terms(await local.lookupLocal('  sich   beeilen '))).toEqual(['sich beeilen']);
    expect((await local.lookupLocal('sich beeilen'))[0].entry).toMatchObject({ reflexive: 'only', tr: { ru: 'торопиться, спешить', en: 'hurry' } });
    // Inflected: the input as typed.
    const [trifft] = await local.lookupLocal('sich trifft');
    expect(trifft).toMatchObject({ form: 'sich trifft', entry: { term: 'sich treffen' } });
  });

  it('ranks verbs known as reflexive before verbs without reflexive data', async () => {
    // "ging": gehen (#32, no data) and ausgehen (#910, reflexive 'also').
    expect(terms(await local.lookupLocal('ging'))).toEqual(['gehen', 'ausgehen']);
    expect(terms(await local.lookupLocal('sich ging'))).toEqual(['sich ausgehen', 'sich gehen']);
    // A verb without reflexive data still comes, with its own translations.
    const [gehen] = await local.lookupLocal('sich gehen');
    expect(gehen.entry).toMatchObject({ term: 'sich gehen', tr: { ru: 'идти, пойти', en: 'go, walk' } });
    expect(await local.lookupLocal('sich Tisch')).toEqual([]);
    expect(await local.lookupLocal('sich')).toEqual([]);
  });

  it('returns [] for unknown words and prefixes without a piece', async () => {
    expect(await local.lookupLocal('Xylophon')).toEqual([]);
    expect(await local.lookupLocal('zzz')).toEqual([]);
  });
});

describe('determiner forms of a verb homograph', () => {
  it('reads the forms of the possessive sein as the possessive, the verb\'s as the verb', async () => {
    for (const w of ['seinen', 'seine', 'seinem', 'seiner', 'seines']) {
      expect((await local.lookupLocal(w)).map((h) => `${h.entry.term}/${h.entry.pos}`)).toEqual(['sein/other']);
    }
    for (const w of ['war', 'seid', 'seien', 'seist']) expect((await local.lookupLocal(w))[0].entry).toMatchObject({ term: 'sein', pos: 'verb' });
    // The word itself still has both readings, the verb first.
    expect((await local.lookupLocal('sein')).map((h) => h.entry.pos)).toEqual(['verb', 'other']);
  });

  // Form-of entries as in the dump: pos "unknown", which says nothing about the homographs.
  const form = (word: string, ...senses: [string, string[], string][]) => ({
    word,
    pos: 'unknown',
    senses: senses.map(([gloss, tags, lemma]) => ({ glosses: [gloss], tags: ['form-of', ...tags], form_of: [{ word: lemma }] })),
  });
  const sein = ['sein|verb', 'sein|pron'];

  it('picks the homograph a form-of entry names (narrowTargets)', () => {
    const seinen = form('seinen', ['Akkusativ Singular Maskulinum des Possessivpronomens sein', ['accusative', 'masculine', 'singular'], 'sein']);
    expect(narrowTargets(seinen, 'sein', 'unknown', sein)).toEqual(['sein|pron']);
    const seine = form('seine', ['feminine Form des Pronomens sein', [], 'sein']);
    expect(narrowTargets(seine, 'sein', 'unknown', sein)).toEqual(['sein|pron']);
    const bin = form('bin', ['1. Person Singular Präsens Indikativ von sein', [], 'sein']);
    expect(narrowTargets(bin, 'sein', 'unknown', sein)).toEqual(['sein|verb']);
    // No word of the part of speech in the gloss: the case tags say it is declined.
    const ihrer = form('ihrer', ['Genitiv Plural von foo', ['genitive', 'plural'], 'foo']);
    expect(narrowTargets(ihrer, 'foo', 'unknown', ['foo|verb', 'foo|pron'])).toEqual(['foo|pron']);
    // A pronoun's person is no verb: "3. Person …" inside a pronoun's gloss.
    const es = form('seiner', ['Genitiv der 3. Person Singular des Personalpronomens es', ['genitive'], 'es']);
    expect(narrowTargets(es, 'es', 'unknown', ['es|pron', 'es|noun'])).toEqual(['es|pron']);
    const naher = form('näher', ['Komparativ von nahe', [], 'nahe']);
    expect(narrowTargets(naher, 'nahe', 'unknown', ['nahe|adj', 'nahe|prep'])).toEqual(['nahe|adj']);
  });

  it('leaves targets alone when the form says nothing or its pos already decides', () => {
    const silent = form('xyz', ['Variante von foo', [], 'foo']);
    expect(narrowTargets(silent, 'foo', 'unknown', ['foo|verb', 'foo|pron'])).toEqual(['foo|verb', 'foo|pron']);
    // The named part of speech isn't among the keys: better a guess than a lost form.
    const wahrende = form('währende', ['Nominativ Singular Femininum der starken Deklination des Positivs des Adjektivs während', ['nominative'], 'während']);
    expect(narrowTargets(wahrende, 'während', 'adj', ['während|prep', 'während|conj'])).toEqual(['während|prep', 'während|conj']);
    expect(narrowTargets(silent, 'foo', 'unknown', ['foo|verb'])).toEqual(['foo|verb']);
    expect(narrowTargets(silent, 'foo', 'verb', ['foo|verb', 'foo|pron'])).toEqual(['foo|verb', 'foo|pron']);
  });
});

describe('extra layer of separable verbs', () => {
  const sep = () => requests.filter((r) => r.startsWith('sep/'));

  it('finds a separable verb the main pieces lack, with all its data', async () => {
    const [hit, ...rest] = await local.lookupLocal('auffächern');
    expect(rest).toEqual([]);
    expect(hit.form).toBeUndefined();
    expect(hit.entry).toEqual({
      term: 'auffächern',
      pos: 'verb',
      genders: [],
      plural: '',
      praeteritum: 'fächerte auf',
      partizip2: 'aufgefächert',
      auxiliary: 'haben',
      tr: { ru: 'раскладывать веером', en: 'fan out' },
      rank: 50113,
      reflexive: 'also',
      trRefl: { ru: 'расходиться веером', en: '' },
      preps: 'in + Akk',
    });
  });

  it('reads it as a reflexive verb', async () => {
    const [hit] = await local.lookupLocal('sich auffächern');
    expect(hit.entry).toMatchObject({ term: 'sich auffächern', tr: { ru: 'расходиться веером', en: 'fan out' }, preps: 'in + Akk' });
  });

  it('finds it from its forms: by the ending rules, else the stored ones', async () => {
    for (const w of ['auffächerte', 'auffächert', 'aufgefächert', 'aufzufächern']) {
      expect(await local.lookupLocal(w)).toMatchObject([{ form: w, entry: { term: 'auffächern' } }]);
    }
    expect(terms(await local.lookupLocal('aufschrieb'))).toEqual(['aufschreiben']);
  });

  it('reads a verbal form behind a noun as the base verb, next to the noun', async () => {
    const hits = await local.lookupLocal('fächerte');
    expect(hits.map((h) => `${h.entry.term}/${h.entry.pos}`)).toEqual(['Fächer/noun', 'auffächern/verb', 'fächern/verb']);
    expect(hits[2]).toMatchObject({ form: 'fächerte', entry: { praeteritum: 'fächerte', partizip2: 'gefächert' } });
    // The infinitive: a lemma, typed exactly, comes first and without `form`.
    const [first] = await local.lookupLocal('fächern');
    expect(first.form).toBeUndefined();
    expect(first.entry.term).toBe('fächern');
    expect(terms(await local.lookupLocal('gefächert'))).toEqual(['fächern']);
  });

  it('finds a particle verb of the main pieces from a base verb of the extra layer', async () => {
    expect(terms(await local.lookupLocal('tischte'))).toEqual(['Tisch', 'auftischen', 'tischen']);
  });

  it('keeps a form that alone reads as the noun with the noun ("tischen*")', async () => {
    expect(terms(await local.lookupLocal('tischen'))).toEqual(['Tisch']);
    expect(sep()).toEqual([]);
  });

  it('loads nothing extra for normal lookups', async () => {
    for (const w of ['Tisch', 'tisch', 'der Tisch', 'Tische', 'tische', 'Häuser', 'ging', 'Ging', 'gehen', 'sein', 'seinen', 'schönen', 'Fächer', 'Fächern', 'Fächerte', 'sich treffen', 'Essen']) {
      await local.lookupLocal(w);
    }
    await local.lemmatize('Hasen');
    expect(await local.lemmatize('auffächerte')).toBeNull(); // rates whole texts: main pieces only
    await local.rankOf('Haus');
    await local.prefixLocal('sch');
    expect(sep()).toEqual([]);
  });

  it('keeps a capitalised word with a main hit to that hit', async () => {
    expect(terms(await local.lookupLocal('Fächer'))).toEqual(['Fächer']);
    expect(terms(await local.lookupLocal('Fächerte'))).toEqual(['Fächer']);
    // Without a main hit the capital only means the start of a sentence.
    expect(terms(await local.lookupLocal('Auffächerte'))).toEqual(['auffächern']);
  });

  it('treats a failed fetch as a miss, and retries later', async () => {
    failingFiles = /^sep\//;
    expect(await local.lookupLocal('auffächern')).toEqual([]);
    expect(terms(await local.lookupLocal('fächerte'))).toEqual(['Fächer']);
    expect(await local.lookupLocal('sich auffächern')).toEqual([]);
    failingFiles = null;
    expect(terms(await local.lookupLocal('auffächern'))).toEqual(['auffächern']);
  });

  it('works with an index from before the layer', async () => {
    extra = { 'index.json': JSON.stringify({ version: 1, sources: '', count: 1, pieces: { fa: 'fa.json', au: 'au.json' } }) };
    expect(await local.lookupLocal('auffächern')).toEqual([]);
    expect(terms(await local.lookupLocal('fächerte'))).toEqual(['Fächer']);
    expect(sep()).toEqual([]);
  });

  describe('build (scripts/dict/separable.mjs)', () => {
    /** A kaikki verb entry: `split` makes it separable ("riss ab" of abreißen). */
    const verb = (word: string, forms: [string, string[]][], senses: object[] = [{ sense_index: '1', glosses: ['x'] }]) => ({
      word,
      pos: 'verb',
      senses,
      forms: forms.map(([form, tags]) => ({ form, tags })),
    });
    const abbeizen = verb('abbeizen', [
      ['beize ab', ['present']],
      ['beizte ab', ['past']],
      ['abgebeizt', ['participle-2', 'perfect']],
      ['abzubeizen', ['active', 'extended', 'infinitive']],
    ]);
    const words: Record<string, object> = {
      abbeizen: { rec: { word: 'abbeizen' }, praeteritum: 'beizte ab', partizip2: 'abgebeizt', auxiliary: 'haben', tr: { ru: '', en: 'strip' } },
      beizen: { rec: { word: 'beizen' }, praeteritum: 'beizte', partizip2: 'gebeizt', auxiliary: 'haben', tr: { ru: '', en: '' } },
    };
    type Picked = { verbs: { entry: LexEntry; forms: Set<string>; made: boolean }[]; stats: object; compounds: Map<string, string[]> };
    const pick = selectExtra as unknown as (o: object) => Picked;
    const select = (verbs: Map<string, unknown>, mainVerbs: string[] = [], hand = {}, wordOf = (t: string) => words[t]) =>
      pick({ verbs, mainVerbs: new Set(mainVerbs), wordOf, usable: () => true, mainRank: () => undefined, hand });

    it('reads the particle from the forms table', () => {
      expect(formsOfEntry(abbeizen)).toMatchObject({ particle: 'ab', split: ['beize', 'beizte'] });
      expect(formsOfEntry(verb('beizen', [['beizte', ['past']]])).particle).toBe('');
      // Only the start of the word counts ("kam nach" isn't of "bekommen").
      expect(formsOfEntry(verb('bekommen', [['kam nach', ['past']]])).particle).toBe('');
    });

    it('takes translated particle verbs and the base verb they need', () => {
      const verbs = new Map();
      noteVerb(verbs, abbeizen);
      const { verbs: out, stats, compounds } = select(verbs);
      expect(out.map((v) => [v.entry.term, v.entry.rank])).toEqual([['abbeizen', 50001], ['beizen', 50002]]);
      expect(out[0].entry).toMatchObject({ pos: 'verb', praeteritum: 'beizte ab', partizip2: 'abgebeizt', auxiliary: 'haben', tr: { en: 'strip' } });
      expect(out[1].made).toBe(false);
      expect(compounds.get('beizen')).toEqual(['abbeizen']);
      expect(stats).toMatchObject({ separable: 1, realBases: 1, madeBases: 0 });
      // A base the dump doesn't have is made from the particle verb's table.
      const made = select(verbs, [], {}, (t) => (t === 'beizen' ? (undefined as unknown as object) : words[t]));
      expect(made.verbs[1]).toMatchObject({ made: true, entry: { term: 'beizen', praeteritum: 'beizte', partizip2: 'gebeizt' } });
      // Already in the main pieces: nothing to add but its base.
      expect(select(verbs, ['abbeizen']).verbs.map((v) => v.entry.term)).toEqual(['beizen']);
      expect(select(verbs, ['abbeizen', 'beizen']).verbs).toEqual([]);
    });

    it('leaves out verbs without a translation or with only dated and regional senses', () => {
      const dated = verb('abasen', [['aste ab', ['past']]], [{ sense_index: '1', glosses: ['x'], tags: ['Austrian German'] }]);
      expect(hasPlainSense(abbeizen)).toBe(true);
      expect(hasPlainSense(dated)).toBe(false);
      const verbs = new Map();
      noteVerb(verbs, dated);
      noteVerb(verbs, verb('abfoo', [['foo ab', ['past']]]));
      words.abasen = { rec: { word: 'abasen' }, praeteritum: 'aste ab', partizip2: 'abgeast', auxiliary: 'haben', tr: { ru: '', en: 'x' } };
      const { verbs: out, stats } = select(verbs);
      expect(out).toEqual([]);
      expect(stats).toMatchObject({ marked: 1, untranslated: 1 });
    });

    it('makes a verb the dump lacks from its base verb, hand-translated', () => {
      const fachern = verb('fächern', [
        ['fächere', ['present']],
        ['fächerte', ['past']],
        ['gefächert', ['participle-2', 'perfect']],
      ]);
      const verbs = new Map();
      noteVerb(verbs, fachern);
      words['fächern'] = { rec: { word: 'fächern' }, praeteritum: 'fächerte', partizip2: 'gefächert', auxiliary: 'haben', tr: { ru: '', en: '' } };
      const hand = { fächern: { tr: { ru: 'р', en: 'e' } }, auffächern: { particle: 'auf', base: 'fächern', tr: { ru: 'а', en: 'b' }, reflexive: 'also' } };
      const { verbs: out } = select(verbs, [], hand);
      const by = (term: string) => out.find((v) => v.entry.term === term)!;
      expect(by('auffächern').entry).toMatchObject({ praeteritum: 'fächerte auf', partizip2: 'aufgefächert', reflexive: 'also' });
      expect([...by('auffächern').forms].sort()).toEqual(['auffächere', 'auffächerte', 'aufgefächert', 'aufzufächern']);
      expect(by('fächern').entry.tr).toEqual({ ru: 'р', en: 'e' });
    });

    it('derives forms both ways', () => {
      const c = compoundOf('auf', { term: 'fächern', praeteritum: 'fächerte', partizip2: 'gefächert', auxiliary: 'haben', forms: ['fächerte', 'gefächert'] });
      expect(c).toMatchObject({ term: 'auffächern', praeteritum: 'fächerte auf', partizip2: 'aufgefächert' });
      const b = baseFromCompound('beraumen', 'an', { praeteritum: 'beraumte an', partizip2: 'anberaumt', auxiliary: 'haben', split: new Set(['beraume', 'beraumte']) });
      expect(b).toMatchObject({ term: 'beraumen', praeteritum: 'beraumte', partizip2: 'beraumt' });
      expect([...b.forms].sort()).toEqual(['beraume', 'beraumt', 'beraumte']);
    });

    it('stores what the ending rules miss, and gates what the main pieces shadow', () => {
      const entry = (term: string, rank: number, praeteritum = '', partizip2 = '') =>
        ({ term, pos: 'verb', genders: [], plural: '', praeteritum, partizip2, auxiliary: 'haben', tr: { ru: 'р', en: '' }, rank }) as LexEntry;
      const verbs = [
        { entry: entry('auffächern', 50001, 'fächerte auf', 'aufgefächert'), forms: new Set(['auffächerte', 'aufgefächert']), made: false },
        { entry: entry('fächern', 50002, 'fächerte', 'gefächert'), forms: new Set(['fächern', 'fächerte', 'fächer', 'fächre']), made: false },
        { entry: entry('deutschen', 50003, 'deutschte', 'gedeutscht'), forms: new Set(['deutschte']), made: true },
        { entry: entry('speien', 50004, 'spie', 'gespien'), forms: new Set(['spie', 'gespien']), made: false },
        { entry: entry('sondern', 50005, 'sonderte', 'gesondert'), forms: new Set(['sonderte']), made: false },
        { entry: entry('erheitern', 50006, 'erheiterte', 'erheitert'), forms: new Set(['erheitert']), made: false },
      ];
      const main: Record<string, { any: boolean; verb: boolean }> = {
        fächern: { any: true, verb: false },
        fächerte: { any: true, verb: false },
        deutschen: { any: true, verb: false },
        deutschte: { any: true, verb: false },
        sondern: { any: true, verb: false },
        sonderte: { any: true, verb: false },
        spie: { any: true, verb: false },
        erheitert: { any: true, verb: false }, // an adjective, mostly
        gefächert: { any: false, verb: true },
      };
      const { lemmas, forms, gate } = layoutExtra(verbs, new Map([['fächern', ['auffächern']]]), (f: string) => main[f] ?? { any: false, verb: false }, (f: string) => f === 'sondern');
      expect([...lemmas.keys()]).toEqual(verbs.map((v) => v.entry.term));
      expect(Object.fromEntries(forms)).toEqual({ aufgefächert: ['auffächern'], spie: ['speien'], gespien: ['speien'], fächern: ['auffächern'] });
      expect(gate).toEqual(['deutschen*', 'fächern', 'sondern*', 'spie']);
    });
  });
});

describe('loading', () => {
  it('loads the index once and shares one request per piece', async () => {
    await Promise.all([local.lookupLocal('Haus'), local.lookupLocal('Hase'), local.lookupLocal('haus'), local.rankOf('Haus')]);
    expect(requests.filter((r) => r === 'index.json')).toHaveLength(1);
    expect(requests.filter((r) => r === 'ha.json')).toHaveLength(1);
    await local.lookupLocal('Häuser');
    expect(requests.filter((r) => r === 'ha.json')).toHaveLength(1);
  });

  it('returns empty results when fetching fails, and retries later', async () => {
    failing = true;
    expect(await local.lookupLocal('Tisch')).toEqual([]);
    expect(await local.lemmatize('ging')).toBeNull();
    expect(await local.prefixLocal('sch')).toEqual([]);
    expect(await local.rankOf('Tisch')).toBeNull();
    failing = false;
    expect(terms(await local.lookupLocal('Tisch'))).toEqual(['Tisch']);
  });

  it('survives a missing piece file', async () => {
    expect(await local.lookupLocal('zzz')).toEqual([]);
    expect(requests).toContain('missing.json');
  });
});

describe('lemmatize', () => {
  it('handles sentence-initial capitals and noun plurals', async () => {
    expect((await local.lemmatize('Ging'))?.term).toBe('gehen');
    expect((await local.lemmatize('Häuser'))?.term).toBe('Haus');
    expect((await local.lemmatize('war'))?.term).toBe('sein');
    expect((await local.lemmatize('Hasen'))?.term).toBe('Hase');
    expect(await local.lemmatize('Qwertz')).toBeNull();
  });
});

describe('prefixLocal', () => {
  it('returns lemmas by normalised prefix, most frequent first', async () => {
    expect((await local.prefixLocal('sch')).map((e) => e.term)).toEqual(['schon', 'schön', 'Schule']);
    expect((await local.prefixLocal('schö')).map((e) => e.term)).toEqual(['schon', 'schön']);
    expect((await local.prefixLocal('Sch', 2)).map((e) => e.term)).toEqual(['schon', 'schön']);
  });

  it('includes pieces split off under a 2-letter prefix', async () => {
    expect((await local.prefixLocal('sc')).map((e) => e.term)).toEqual(['schon', 'schön', 'Schule']);
    expect(requests).toEqual(expect.arrayContaining(['sc.json', 'sch.json']));
  });

  it('needs at least two letters', async () => {
    expect(await local.prefixLocal('s')).toEqual([]);
    expect(requests).toEqual([]);
  });
});

describe('rankOf', () => {
  it('returns the rank of the lemma, the typed case first', async () => {
    expect(await local.rankOf('Haus')).toBe(120);
    expect(await local.rankOf('haus')).toBe(120);
    expect(await local.rankOf('sein')).toBe(2);
    expect(await local.rankOf('Essen')).toBe(400);
    expect(await local.rankOf('Häuser')).toBeNull();
    expect(await local.rankOf('sich treffen')).toBe(195);
  });
});

describe('build compatibility (scripts/dict/lib.mjs)', () => {
  it('shares normalizeKey and the ending rules', () => {
    for (const w of ['Straße', 'Übung', 'schöneren', 'Ärger', 'Öl']) expect(local.normalizeKey(w)).toBe(buildNormalizeKey(w));
    expect(local.SUFFIXES).toEqual(BUILD_SUFFIXES);
    for (const w of ['tische', 'schöneren', 'arbeitete', 'lehrerinnen', 'machst']) expect(local.ruleCandidates(w)).toEqual(buildRuleCandidates(w));
    expect(pieceFile({ sc: 'a.json', sch: 'b.json' }, 'Schule')).toBe('b.json');
    expect(pieceFile({ sc: 'a.json', sch: 'b.json' }, 'Scanner')).toBe('a.json');
  });

  it('decodes what the build encodes', async () => {
    const entries: LexEntry[] = [
      { term: 'machen', pos: 'verb', genders: [], plural: '', praeteritum: 'machte', partizip2: 'gemacht', auxiliary: 'haben', tr: { ru: 'делать', en: 'do, make' }, rank: 40, level: 'A1' },
      { term: 'Maus', pos: 'noun', genders: ['f'], plural: 'Mäuse', praeteritum: '', partizip2: '', auxiliary: '', tr: { ru: 'мышь', en: '' }, rank: 9000 },
      { term: 'Mann', pos: 'noun', genders: ['m'], plural: 'Männer', praeteritum: '', partizip2: '', auxiliary: '', tr: { ru: 'мужчина', en: 'man' }, rank: 70, level: 'A1' },
      { term: 'Mantel', pos: 'noun', genders: ['m'], plural: 'Mäntel', praeteritum: '', partizip2: '', auxiliary: '', tr: { ru: 'пальто', en: 'coat' }, rank: 2000, level: 'B1' },
      { term: 'mal', pos: 'other', genders: [], plural: '', praeteritum: '', partizip2: '', auxiliary: '', tr: { ru: 'раз', en: 'once' }, rank: 30, level: 'A1' },
      { term: 'matt', pos: 'adj', genders: [], plural: '', praeteritum: '', partizip2: '', auxiliary: '', tr: { ru: 'матовый', en: 'matt' }, rank: 12000 },
      {
        term: 'malen', pos: 'verb', genders: [], plural: '', praeteritum: 'malte', partizip2: 'gemalt', auxiliary: 'haben',
        tr: { ru: 'рисовать', en: 'paint' }, rank: 1167, reflexive: 'also', trRefl: { ru: '', en: 'picture oneself' }, preps: 'mit + Dat',
      },
      // Reflexive data without Präteritum / Partizip II: their places are kept.
      { term: 'mausern', pos: 'verb', genders: [], plural: '', praeteritum: '', partizip2: '', auxiliary: '', tr: { ru: 'линять', en: 'moult' }, rank: 15000, reflexive: 'only', preps: 'zu + Dat' },
    ];
    expect(compactForm('machen', 'machte')).toBe('2te');
    expect(encodeEntry(entries[7])).toEqual([15000, 'vR', 'линять', 'moult', '', '', '', '', 'zu + Dat']);
    // The build sizes its budget without the reflexive data.
    expect(encodeEntry(entries[6], { reflexive: false })).toEqual([1167, 'vh', 'рисовать', 'paint', '2te', 'gemalt']);
    const piece = { lemmas: Object.fromEntries(entries.map((e) => [e.term, encodeEntry(e)])), forms: {} };
    extra = {
      'index.json': JSON.stringify({ version: 1, sources: '', count: entries.length, pieces: { ma: 'ma.json' } }),
      'ma.json': JSON.stringify(piece),
    };
    for (const e of entries) expect((await local.lookupLocal(e.term))[0].entry).toEqual(e);
    expect((await local.prefixLocal('ma')).map((e) => e.term)).toEqual(['mal', 'machen', 'Mann', 'malen', 'Mantel', 'Maus', 'matt', 'mausern']);
  });
});

describe('reflexive data (scripts/dict/reflexive.mjs)', () => {
  type Sense = { sense_index?: string; glosses?: string[]; tags?: string[]; raw_tags?: string[]; examples?: { text: string }[] };
  type Tr = { lang_code: string; sense_index: string; sense?: string; word: string };
  const verb = (word: string, senses: Sense[], translations: Tr[] = []) => ({ word, pos: 'verb', lang_code: 'de', senses, translations });
  const ex = (...texts: string[]) => texts.map((text) => ({ text }));
  // Shaped like the kaikki.org de-edition entries (trimmed).
  const freuen = verb(
    'freuen',
    [
      { sense_index: '1', glosses: ['Freude erleben oder empfinden'], tags: ['reflexive'], raw_tags: ['sich (über etwas) freuen'], examples: ex('Peter freut sich über sein gutes Schulzeugnis.') },
      { sense_index: '2', glosses: ['Vorfreude empfinden'], tags: ['reflexive'], raw_tags: ['sich auf etwas freuen'], examples: ex('Ich freue mich schon auf unser nächstes Treffen.') },
      { sense_index: '3', glosses: ['jemandem Freude bereiten'], tags: ['impersonal', 'transitive'], examples: ex('Es freut mich außerordentlich.') },
    ],
    [
      { lang_code: 'ru', sense_index: '1', sense: 'reflexiv: sich (über etwas) freuen: Freude erleben oder empfinden', word: 'радоваться' },
      { lang_code: 'en', sense_index: '1', sense: 'reflexiv: sich (über etwas) freuen: Freude erleben oder empfinden', word: 'be glad' },
      { lang_code: 'en', sense_index: '2', sense: 'bei dem Gedanken an ein zukünftiges Ereignis Freude empfinden', word: 'look forward to' },
      { lang_code: 'ru', sense_index: '3', sense: 'jemandem Freude bereiten', word: 'радовать' },
    ],
  );
  const beeilen = verb('beeilen', [
    { sense_index: '1', glosses: ['sich schneller bewegen'], tags: ['intransitive', 'reflexive'] },
    { sense_index: '1a', glosses: ['sich schneller bewegen', 'sich beeilen, um (gleich, noch, sofort) etwas zu machen: etwas schneller machen'], tags: ['intransitive', 'reflexive'] },
  ]);
  const interessieren = verb(
    'interessieren',
    [
      { glosses: ['transitiv, unpersönlich:'] },
      { sense_index: '1', glosses: ['jemandes Interesse erregen'], raw_tags: ['jemanden (für etwas) interessieren'] },
      { glosses: ['reflexiv:'] },
      { sense_index: '2', glosses: ['an etwas/jemandem Interesse haben'], raw_tags: ['sich für etwas/jemanden interessieren'] },
    ],
    [
      { lang_code: 'ru', sense_index: '1', sense: 'transitiv', word: 'интересовать' },
      { lang_code: 'ru', sense_index: '2', sense: 'reflexiv', word: 'интересоваться' },
    ],
  );
  const gehen = verb('gehen', [
    { sense_index: '1', glosses: ['sich schreitend fortbewegen'], tags: ['intransitive'], examples: ex('Ich gehe über die Straße.') },
    { sense_index: '15', glosses: ['(Computer) auf etwas gehen: den Mauszeiger auf etwas bewegen'], tags: ['intransitive'] },
  ]);

  it('extracts prepositions and their case from usage patterns', () => {
    expect(prepsOfPattern('sich auf etwas freuen')).toEqual([{ prep: 'auf', case: '' }]);
    expect(prepsOfPattern('sich für etwas/jemanden interessieren')).toEqual([{ prep: 'für', case: 'Akk' }]);
    expect(prepsOfPattern('warten auf das Ereignis (Akkusativ)')).toEqual([{ prep: 'auf', case: 'Akk' }]);
    expect(prepsOfPattern('auf etwas (Akk.) ankommen')).toEqual([{ prep: 'auf', case: 'Akk' }]);
    expect(prepsOfPattern('sich auf etwas/jemanden verlassen')).toEqual([{ prep: 'auf', case: 'Akk' }]);
    expect(prepsOfPattern('an etwas/jemandem hängen')).toEqual([{ prep: 'an', case: 'Dat' }]);
    expect(prepsOfPattern('an etwas teilnehmen')).toEqual([{ prep: 'an', case: '' }]);
    expect(prepsOfPattern('sich mit jemandem über etwas streiten')).toEqual([{ prep: 'mit', case: 'Dat' }, { prep: 'über', case: '' }]);
    expect(prepsOfPattern('sich wegen etwas schämen')).toEqual([{ prep: 'wegen', case: 'Gen' }]);
    expect(prepsOfPattern('reflexiv, mit „um“')).toEqual([{ prep: 'um', case: 'Akk' }]);
    // Not an object: an infinitive clause, a note, a list of prepositions.
    expect(prepsOfPattern('sich beeilen, um (gleich, noch) etwas zu machen')).toEqual([]);
    expect(prepsOfPattern('in der Redewendung „zu haben sein“')).toEqual([]);
    expect(prepsOfPattern('mit einem abhängigen Infinitiv eines Verbs')).toEqual([]);
    expect(prepsOfPattern('an/auf/in etwas tippen')).toEqual([]);
  });

  it('reads the case of a two-way preposition from examples, only when they agree', () => {
    expect(caseFromExamples('über', ['Peter freut sich über sein gutes Schulzeugnis.'])).toBe('Akk');
    expect(caseFromExamples('auf', ['Ich freue mich schon auf unser nächstes Treffen.', 'Wir warten aufs Essen.'])).toBe('Akk');
    expect(caseFromExamples('an', ['Er nimmt an der Sitzung teil.', 'Sie nahm am Rennen teil.'])).toBe('Dat');
    expect(caseFromExamples('an', ['Er denkt an den Urlaub.', 'Er nimmt an der Sitzung teil.'])).toBe('');
    // "die Händler auf dem Markt": the noun's, not the verb's.
    expect(caseFromExamples('auf', ['Die Händler auf dem Markt gehen auf Betrug aus.'])).toBe('');
    expect(caseFromExamples('auf', ['Er wartet auf Peter.'])).toBe('');
    expect(prepFromExamples(['Ich erinnere mich noch genau daran.', 'Ich erinnere mich an dich.'])).toBe('an');
    expect(prepFromExamples(['Ich erinnere mich daran.', 'Danach ging er.'])).toBe('');
  });

  it('tells "also" from "only" reflexive verbs and collects their data', () => {
    const fields = (e: object, tr = { ru: '', en: '' }) => reflexiveFields([reflexiveOf(e)], tr);
    expect(fields(freuen, { ru: 'радоваться', en: 'be glad; look forward to' })).toEqual({ reflexive: 'also', preps: 'über + Akk; auf + Akk' });
    expect(reflexiveOf(freuen).tr).toEqual({ ru: [['радоваться']], en: [['be glad'], ['look forward to']] });
    expect(fields(beeilen)).toEqual({ reflexive: 'only' });
    // Header senses ("reflexiv:") and translation labels.
    expect(fields(interessieren, { ru: 'интересовать; интересоваться', en: '' })).toEqual({
      reflexive: 'also',
      trRefl: { ru: 'интересоваться', en: '' },
      preps: 'für + Akk',
    });
    // Not reflexive: a gloss that uses another reflexive verb; a field's pattern gives no preposition.
    expect(fields(gehen)).toEqual({});
    // Tagged reflexive and transitive ("jemanden / sich waschen"): both.
    expect(fields(verb('waschen', [{ sense_index: '1', glosses: ['reinigen'], tags: ['reflexive', 'transitive'], raw_tags: ['auch'] }]))).toEqual({ reflexive: 'also' });
    // One homonym not reflexive: 'also'.
    expect(reflexiveFields([reflexiveOf(beeilen), reflexiveOf(gehen)], { ru: '', en: '' }).reflexive).toBe('also');
  });
});

describe('generated dictionary (public/dict)', () => {
  const DICT = new URL('../../../public/dict/', import.meta.url);
  beforeEach(() => {
    vi.stubGlobal('fetch', async (url: string) => {
      const file = new URL(String(url).split('/dict/')[1], DICT);
      if (!existsSync(file)) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(file, 'utf8')) };
    });
  });

  it.skipIf(!existsSync(new URL('index.json', DICT)))('lemmatises common forms', async () => {
    const lemma = async (w: string) => (await local.lemmatize(w))?.term;
    expect(await lemma('ging')).toBe('gehen');
    expect(await lemma('Ging')).toBe('gehen');
    expect(await lemma('Häuser')).toBe('Haus');
    expect(await lemma('schöneren')).toBe('schön');
    expect(await lemma('war')).toBe('sein');
    expect(await lemma('der Tisch')).toBe('Tisch');
    expect(terms(await local.lookupLocal('rief'))).toContain('anrufen');
    expect((await local.lookupLocal('Tisch'))[0].entry).toMatchObject({ pos: 'noun', genders: ['m'], plural: 'Tische' });
    expect((await local.prefixLocal('Sch')).length).toBe(8);
  });

  it.skipIf(!existsSync(new URL('index.json', DICT)))('reads determiner forms as determiners, not as verbs', async () => {
    const verb = async (w: string) => (await local.lookupLocal(w)).filter((h) => h.entry.pos === 'verb').map((h) => h.entry.term);
    for (const w of ['seinen', 'seine', 'seinem', 'seiner', 'seines', 'seins', 'deine', 'deinen', 'ihre', 'ihren', 'unsere', 'unseren', 'eure']) {
      expect(await verb(w), w).toEqual([]);
    }
    expect((await local.lookupLocal('seinen'))[0].entry).toMatchObject({ term: 'sein', pos: 'other' });
    // "meine" is also meinen, rightly.
    expect(await verb('meine')).toEqual(['meinen']);
    for (const w of ['bin', 'bist', 'ist', 'sind', 'seid', 'war', 'waren', 'warst', 'gewesen', 'sei', 'seien', 'seist', 'wäre', 'wären']) {
      expect(await verb(w), w).toContain('sein');
    }
    expect((await local.lookupLocal('bin')).map((h) => h.entry.pos)).toEqual(['verb']);
  });

  it.skipIf(!existsSync(new URL('sep', DICT)))('has the extra layer of separable verbs', async () => {
    const pos = (hits: { entry: LexEntry }[]) => hits.map((h) => `${h.entry.term}/${h.entry.pos}`);
    expect((await local.lookupLocal('auffächern'))[0].entry).toMatchObject({ term: 'auffächern', pos: 'verb', praeteritum: 'fächerte auf', partizip2: 'aufgefächert', reflexive: 'also' });
    expect((await local.lookupLocal('auffächern'))[0].entry.tr.ru).toBeTruthy();
    expect((await local.lookupLocal('auffächern'))[0].entry.rank).toBeGreaterThan(30000);
    expect((await local.lookupLocal('sich auffächern'))[0].entry.term).toBe('sich auffächern');
    expect(terms(await local.lookupLocal('auffächerte'))).toEqual(['auffächern']);
    expect(pos(await local.lookupLocal('fächerte'))).toEqual(expect.arrayContaining(['Fächer/noun', 'fächern/verb']));
    // From the dump, with a base verb the main pieces lack.
    expect((await local.lookupLocal('abbestellen'))[0].entry).toMatchObject({ praeteritum: 'bestellte ab', partizip2: 'abbestellt' });
    expect(terms(await local.lookupLocal('tischte'))).toEqual(expect.arrayContaining(['auftischen', 'tischen']));
  });

  it.skipIf(!existsSync(new URL('sep', DICT)))('leaves ordinary words alone', async () => {
    const asked: string[] = [];
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', async (url: string) => {
      asked.push(String(url));
      return real(url);
    });
    for (const w of ['Tisch', 'Tische', 'Haus', 'Häuser', 'ging', 'war', 'und', 'sondern', 'der', 'schönen', 'deutschen', 'klaren', 'Regen', 'regen', 'ausgezeichnet', 'seinen']) {
      expect((await local.lookupLocal(w)).every((h) => h.entry.rank < 30000), w).toBe(true);
    }
    expect(asked.filter((u) => u.includes('/sep/'))).toEqual([]);
  });

  it.skipIf(!existsSync(new URL('index.json', DICT)))('knows reflexive verbs and their prepositions', async () => {
    const entry = async (w: string) => (await local.lookupLocal(w))[0].entry;
    expect((await entry('treffen')).reflexive).toBe('also');
    expect((await entry('beeilen')).reflexive).toBe('only');
    expect((await entry('gehen')).reflexive).toBeUndefined();
    expect((await entry('freuen')).preps).toContain('auf + Akk');
    expect((await entry('warten')).preps).toBe('auf + Akk');
    expect(await entry('sich interessieren')).toMatchObject({ term: 'sich interessieren', preps: 'für + Akk' });
    expect((await entry('sich interessieren')).tr.ru).toBe('интересоваться');
  });

  it.skipIf(!existsSync(new URL('index.json', DICT)))('keeps distinct meanings apart ("; ")', async () => {
    const tr = async (w: string) => (await local.lookupLocal(w))[0].entry.tr;
    // Folge: consequence / sequence / episode of a series.
    const folge = await tr('Folge');
    expect(folge.ru.split('; ').length).toBeGreaterThanOrEqual(3);
    expect(folge.ru).toContain('эпизод');
    expect(folge.en).toContain('episode');
    expect((await tr('Bank')).en).toBe('bench; bank');
    // Single-meaning words stay as they are.
    expect((await tr('Tisch')).ru).toBe('стол');
    // At most 3 meanings everywhere.
    for (const w of ['Zug', 'Schloss', 'Strom', 'gehen', 'Haus']) {
      const t = await tr(w);
      expect(t.ru.split('; ').length).toBeLessThanOrEqual(3);
      expect(t.en.split('; ').length).toBeLessThanOrEqual(3);
    }
  });
});
