import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LexEntry, LocalHit } from '../dict/types';
import type { ArticleVariant, Card, Lang, LookupResult } from '../types';
import { fieldsFromEntry, fieldsFromLookup } from '../reading/store';

const mocks = vi.hoisted(() => ({
  lookupLocal: vi.fn<(w: string) => Promise<LocalHit[]>>(),
  articleVariants: vi.fn<(e: LexEntry) => Promise<LexEntry[]>>(),
  lookupWord: vi.fn<(w: string, lang: Lang, signal?: AbortSignal) => Promise<LookupResult | null>>(),
}));
vi.mock('../dict/local', () => ({ lookupLocal: mocks.lookupLocal, articleVariants: mocks.articleVariants }));
vi.mock('../lookup/lookup', () => ({ lookupWord: mocks.lookupWord }));

const {
  articleCardFields,
  articleRowsOf,
  displayOf,
  entryFields,
  formsOf,
  loadWordInfo,
  mergeInfo,
  needsRemote,
  prepsText,
  reflexiveReadingOf,
  remoteFor,
} = await import('./wordInfo');
const { asReflexive } = await import('../german/reflexive');

function lex(term: string, over: Partial<LexEntry> = {}): LexEntry {
  return { term, pos: 'other', genders: [], plural: '', praeteritum: '', partizip2: '', auxiliary: '', tr: { ru: '', en: '' }, rank: 1, ...over };
}
function result(term: string, over: Partial<LookupResult> = {}): LookupResult {
  return { term, pos: 'other', genders: [], plural: '', praeteritum: '', partizip2: '', auxiliary: '', translation: '', examples: [], source: 'wiktionary', ...over };
}

const gehen = lex('gehen', { pos: 'verb', praeteritum: 'ging', partizip2: 'gegangen', auxiliary: 'sein', tr: { ru: 'идти', en: 'go' } });
const haus = lex('Haus', { pos: 'noun', genders: ['n'], plural: 'Häuser', tr: { ru: 'дом', en: 'house' } });
const seeM = lex('See', { pos: 'noun', genders: ['m'], plural: 'Seen', tr: { ru: 'озеро', en: 'lake' }, rank: 900 });
const seeF = lex('See', { pos: 'noun', genders: ['f'], tr: { ru: 'море', en: '' }, rank: 2000 });
const noTr = lex('Quatsch', { pos: 'noun', genders: ['m'] });
const remoteSee = result('See', {
  pos: 'noun',
  genders: ['m'],
  plural: 'Seen',
  translation: 'lake',
  examples: [{ de: 'Der See ist tief.' }],
  articles: [
    { genders: ['m'], plural: 'Seen', translation: 'lake', examples: [{ de: 'Der See ist tief.' }] },
    { genders: ['f'], plural: '', translation: 'sea', examples: [{ de: 'Die See ist rau.' }] },
  ],
});

/** The logic WordSheet.svelte had inline before it moved to wordInfo.ts (kept to prove parity). */
const legacy = {
  info(local: LexEntry | null, remote: LookupResult | null, lang: Lang): (Partial<Card> & { term: string }) | null {
    const base = local ? fieldsFromEntry(local, lang) : null;
    const extra = remote ? fieldsFromLookup(remote) : null;
    if (!base && !extra) return null;
    if (!base) return { ...extra!, term: extra!.term! };
    if (!extra) return { ...base, term: base.term! };
    return {
      ...base,
      term: base.term!,
      translation: base.translation || extra.translation,
      genders: base.genders?.length ? base.genders : extra.genders,
      plural: base.plural || extra.plural,
      examples: extra.examples,
    };
  },
  articleRows(local: LexEntry | null, localArticles: LexEntry[], remote: LookupResult | null, lang: Lang): ArticleVariant[] {
    const online = remote?.term === local?.term || !local ? (remote?.articles ?? []) : [];
    if (localArticles.length > 1) {
      return localArticles.map((e) => {
        const r = online.find((a) => a.genders[0] === e.genders[0]);
        return { genders: [...e.genders], plural: e.plural || r?.plural || '', translation: e.tr[lang] || r?.translation || '', examples: r?.examples ?? [] };
      });
    }
    return online;
  },
  untranslated(best: LexEntry | null, variants: LexEntry[], lang: Lang) {
    const untranslated = variants.length > 1 ? variants.some((v) => !v.tr[lang]) : !best?.tr[lang];
    return !best || untranslated;
  },
};

beforeEach(() => {
  mocks.lookupLocal.mockReset();
  mocks.articleVariants.mockReset();
  mocks.lookupWord.mockReset();
  mocks.articleVariants.mockImplementation(async (e) => (e.term === 'See' ? [seeM, seeF] : [e]));
});

describe('merge logic (same as WordSheet had)', () => {
  const locals = [null, gehen, haus, seeM, noTr];
  const remotes = [null, result('gehen', { pos: 'verb', translation: 'to go', examples: [{ de: 'Ich gehe.' }] }), remoteSee, result('Quatsch', { pos: 'noun', genders: ['m'], plural: '', translation: 'nonsense' }), result('Hund', { articles: [] })];
  const langs: Lang[] = ['ru', 'en'];

  it('mergeInfo matches the old inline version for every combination', () => {
    for (const l of locals) for (const r of remotes) for (const lang of langs) expect(mergeInfo(l, r, lang)).toEqual(legacy.info(l, r, lang));
  });

  it('articleRowsOf matches the old inline version for every combination', () => {
    const variantsOf = (l: LexEntry | null) => (l?.term === 'See' ? [seeM, seeF] : l ? [l] : []);
    for (const l of locals) for (const r of remotes) for (const lang of langs) {
      expect(articleRowsOf(l, variantsOf(l), r, lang)).toEqual(legacy.articleRows(l, variantsOf(l), r, lang));
    }
  });

  it('needsRemote matches the old check', () => {
    for (const [b, v] of [[null, []], [gehen, [gehen]], [noTr, [noTr]], [seeM, [seeM, seeF]]] as [LexEntry | null, LexEntry[]][])
      for (const lang of langs) expect(needsRemote(b, v, lang)).toBe(legacy.untranslated(b, v, lang));
  });

  it('fills local gaps from the lookup, keeps local grammar', () => {
    const info = mergeInfo(noTr, result('Quatsch', { pos: 'noun', genders: ['f'], plural: 'x', translation: 'nonsense', examples: [{ de: 'So ein Quatsch!' }] }), 'en');
    expect(info).toMatchObject({ term: 'Quatsch', genders: ['m'], plural: 'x', translation: 'nonsense', examples: [{ de: 'So ein Quatsch!' }] });
  });

  it('split noun rows: offline entries, gaps and examples from the lookup', () => {
    const rows = articleRowsOf(seeM, [seeM, seeF], remoteSee, 'en');
    expect(rows).toEqual([
      { genders: ['m'], plural: 'Seen', translation: 'lake', examples: [{ de: 'Der See ist tief.' }] },
      { genders: ['f'], plural: '', translation: 'sea', examples: [{ de: 'Die See ist rau.' }] },
    ]);
    expect(articleCardFields('See', rows[1])).toEqual({ term: 'See', pos: 'noun', genders: ['f'], plural: '', translation: 'sea', examples: [{ de: 'Die See ist rau.' }] });
  });

  it('display and forms', () => {
    expect(formsOf(displayOf(mergeInfo(gehen, null, 'ru')))).toBe('ging – ist gegangen');
    expect(formsOf(displayOf(mergeInfo(haus, null, 'ru')))).toBe('die Häuser');
    expect(formsOf(displayOf(mergeInfo(lex('schön', { pos: 'adj' }), null, 'ru')))).toBe('');
    expect(displayOf(null)).toBeNull();
  });
});

describe('loadWordInfo', () => {
  const run = (word: string, opts: { online?: boolean; entry?: LexEntry | null; lang?: Lang; signal?: AbortSignal } = {}) => {
    const states: unknown[] = [];
    const p = loadWordInfo(word, {
      entry: opts.entry,
      lang: opts.lang ?? 'ru',
      isOnline: () => opts.online ?? true,
      signal: opts.signal ?? new AbortController().signal,
      onchange: (s) => states.push(s),
    });
    return { p, states };
  };

  it('offline dictionary only when it has a translation', async () => {
    mocks.lookupLocal.mockResolvedValue([{ entry: gehen, form: 'ging' }]);
    const { p, states } = run('ging');
    const s = await p;
    expect(s).toMatchObject({ local: gehen, localArticles: [gehen], localDone: true, form: 'ging', remoteState: 'idle', remote: null });
    expect(states).toHaveLength(1);
    expect(mocks.lookupWord).not.toHaveBeenCalled();
  });

  it('online lookup (by the lemma) when the offline entry has no translation', async () => {
    mocks.lookupLocal.mockResolvedValue([{ entry: noTr }]);
    const r = result('Quatsch', { translation: 'чепуха' });
    mocks.lookupWord.mockResolvedValue(r);
    const { p, states } = run('quatsch');
    const s = await p;
    expect(mocks.lookupWord).toHaveBeenCalledWith('Quatsch', 'ru', expect.anything());
    expect(states).toMatchObject([{ remoteState: 'loading' }, { remoteState: 'done', remote: r }]);
    expect(s.form).toBe('');
  });

  it('split noun with one article untranslated goes online', async () => {
    mocks.lookupLocal.mockResolvedValue([{ entry: seeM }, { entry: seeF }]);
    mocks.lookupWord.mockResolvedValue(remoteSee);
    const s = await run('See', { lang: 'en' }).p;
    expect(s.localArticles).toEqual([seeM, seeF]);
    expect(s.remoteState).toBe('done');
  });

  it('unknown word: precomputed entry, else online; offline → nothing', async () => {
    mocks.lookupLocal.mockResolvedValue([]);
    expect((await run('Häuser', { entry: haus }).p).local).toBe(haus);
    const off = await run('Blabla', { online: false }).p;
    expect(off).toMatchObject({ local: null, localDone: true, remoteState: 'idle' });
    expect(mocks.lookupWord).not.toHaveBeenCalled();
  });

  it('a failing lookup is reported, never thrown', async () => {
    mocks.lookupLocal.mockRejectedValue(new Error('piece missing'));
    mocks.lookupWord.mockRejectedValue(new Error('429'));
    const s = await run('Blabla').p;
    expect(s).toMatchObject({ local: null, remoteState: 'failed' });
  });

  it('reports nothing after abort', async () => {
    const ctrl = new AbortController();
    mocks.lookupLocal.mockImplementation(async () => {
      ctrl.abort();
      return [{ entry: gehen }];
    });
    const { p, states } = run('gehen', { signal: ctrl.signal });
    await p;
    expect(states).toEqual([]);
  });
});

describe('reflexive verbs', () => {
  const treffen = lex('treffen', {
    pos: 'verb',
    praeteritum: 'traf',
    partizip2: 'getroffen',
    auxiliary: 'haben',
    tr: { ru: 'встретить', en: 'meet' },
    reflexive: 'also',
    trRefl: { ru: 'встречаться', en: 'meet up' },
    preps: 'mit + Dat',
  });
  const plainTreffen = lex('treffen', { pos: 'verb', tr: { ru: 'встретить', en: 'meet' } });
  const beeilen = lex('beeilen', { pos: 'verb', tr: { ru: 'торопиться', en: 'hurry' }, reflexive: 'only', preps: 'mit + Dat' });
  const remoteTreffen = result('treffen', {
    pos: 'verb',
    translation: 'встретить',
    preps: 'auf + Akk',
    examples: [{ de: 'Ich treffe ihn.' }],
    reflexive: { translation: 'встречаться', examples: [{ de: 'Wir treffen uns.' }] },
  });

  it('"sich treffen" without dictionary hits: the verb read reflexively, no lookup when flagged', async () => {
    mocks.lookupLocal.mockImplementation(async (w) => (w === 'treffen' ? [{ entry: treffen, form: undefined }] : []));
    const s = await loadWordInfo('sich treffen', { lang: 'ru', isOnline: () => true, signal: new AbortController().signal });
    expect(s.local).toMatchObject({ term: 'sich treffen', tr: { ru: 'встречаться' } });
    expect(mocks.lookupWord).not.toHaveBeenCalled();
    expect(mergeInfo(s.local, null, 'ru')).toMatchObject({ term: 'sich treffen', translation: 'встречаться', preps: 'mit + Dat' });
  });

  it('a verb the dictionary doesn\'t know as reflexive asks the lookup for "sich …"', async () => {
    mocks.lookupLocal.mockImplementation(async (w) => (w === 'treffen' ? [{ entry: plainTreffen }] : []));
    mocks.lookupWord.mockResolvedValue(result('sich treffen', { pos: 'verb', translation: 'встречаться', preps: 'mit + Dat' }));
    const s = await loadWordInfo('sich treffen', { lang: 'ru', isOnline: () => true, signal: new AbortController().signal });
    expect(mocks.lookupWord).toHaveBeenCalledWith('sich treffen', 'ru', expect.anything());
    expect(mergeInfo(s.local, s.remote, 'ru')).toMatchObject({ term: 'sich treffen', translation: 'встречаться', preps: 'mit + Dat' });
  });

  it('a reflexive-only verb is shown as "sich beeilen"', async () => {
    mocks.lookupLocal.mockResolvedValue([{ entry: beeilen, form: 'beeilt' }]);
    const s = await loadWordInfo('beeilt', { lang: 'ru', isOnline: () => true, signal: new AbortController().signal });
    expect(s.local?.term).toBe('sich beeilen');
    expect(mergeInfo(s.local, null, 'ru')).toMatchObject({ term: 'sich beeilen', translation: 'торопиться', preps: 'mit + Dat' });
  });

  it('remoteFor reads a plain lookup as its reflexive reading, without the plain prepositions', () => {
    const r = remoteFor(asReflexive(plainTreffen), remoteTreffen)!;
    expect(r).toMatchObject({ term: 'sich treffen', translation: 'встречаться', examples: [{ de: 'Wir treffen uns.' }] });
    expect(r.preps).toBeUndefined();
    expect(r.reflexive).toBeUndefined();
    expect(remoteFor(plainTreffen, remoteTreffen)).toBe(remoteTreffen);
    expect(mergeInfo(asReflexive(plainTreffen), remoteTreffen, 'ru')).toMatchObject({ term: 'sich treffen', translation: 'встречаться' });
  });

  it('reflexiveReadingOf: the "sich …" row of a plain verb', () => {
    expect(reflexiveReadingOf(treffen, null, 'ru')).toMatchObject({ term: 'sich treffen', pos: 'verb', translation: 'встречаться', preps: 'mit + Dat' });
    // From the lookup only: its reflexive reading, not the plain reading's prepositions.
    const fromRemote = reflexiveReadingOf(null, remoteTreffen, 'ru')!;
    expect(fromRemote).toMatchObject({ term: 'sich treffen', translation: 'встречаться', examples: [{ de: 'Wir treffen uns.' }] });
    expect(fromRemote.preps).toBeUndefined();
    expect(reflexiveReadingOf(plainTreffen, remoteTreffen, 'en')).toMatchObject({ term: 'sich treffen', translation: 'встречаться' });
    expect(reflexiveReadingOf(plainTreffen, null, 'ru')).toBeNull();
    expect(reflexiveReadingOf(asReflexive(treffen), null, 'ru')).toBeNull();
    expect(reflexiveReadingOf(haus, null, 'ru')).toBeNull();
  });

  it('prepositions: on the "sich …" reading of an also-reflexive verb only; shown joined', () => {
    expect(entryFields(treffen, 'ru').preps).toBeUndefined();
    expect(entryFields(asReflexive(treffen), 'ru')).toMatchObject({ term: 'sich treffen', preps: 'mit + Dat' });
    expect(entryFields(beeilen, 'ru').preps).toBe('mit + Dat');
    expect(prepsText('auf + Akk; über + Akk')).toBe('auf + Akk · über + Akk');
    expect(prepsText(undefined)).toBe('');
  });
});
