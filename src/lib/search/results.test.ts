import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LexEntry, LocalHit } from '../dict/types';
import type { ReverseHit } from '../dict/reverse';
import type { Suggestion } from '../lookup/lookup';
import type { Lang } from '../types';

const mocks = vi.hoisted(() => ({
  lookupLocal: vi.fn<(w: string) => Promise<LocalHit[]>>(),
  suggest: vi.fn<(p: string, lang: Lang, signal?: AbortSignal) => Promise<Suggestion[]>>(),
  reverseSearch: vi.fn<(q: string, lang: Lang, limit?: number) => Promise<ReverseHit[]>>(),
}));
vi.mock('../dict/local', () => ({ lookupLocal: mocks.lookupLocal }));
vi.mock('../lookup/lookup', () => ({ suggest: mocks.suggest }));
vi.mock('../dict/reverse', async (orig) => ({ ...(await orig<typeof import('../dict/reverse')>()), reverseSearch: mocks.reverseSearch }));

const { buildGroups, exactRows, reverseRows, rowLabel, searchWords, suggestionRows } = await import('./results');

function lex(term: string, over: Partial<LexEntry> = {}): LexEntry {
  return { term, pos: 'other', genders: [], plural: '', praeteritum: '', partizip2: '', auxiliary: '', tr: { ru: '', en: '' }, rank: 1, ...over };
}
const haus = lex('Haus', { pos: 'noun', genders: ['n'], tr: { ru: 'дом', en: 'house' }, level: 'A1' });
const hausaufgabe = lex('Hausaufgabe', { pos: 'noun', genders: ['f'], tr: { ru: 'домашнее задание', en: 'homework' } });
const gehen = lex('gehen', { pos: 'verb', tr: { ru: 'идти', en: 'go' } });
const seeM = lex('See', { pos: 'noun', genders: ['m'], tr: { ru: 'озеро', en: 'lake' } });
const seeF = lex('See', { pos: 'noun', genders: ['f'], tr: { ru: 'море', en: 'sea' } });
const sein = lex('sein', { pos: 'verb', tr: { ru: 'быть', en: 'be' } });
const dasSein = lex('Sein', { pos: 'noun', genders: ['n'], tr: { ru: 'бытие', en: 'being' } });
const steuerF = lex('Steuer', { pos: 'noun', genders: ['f'], tr: { ru: 'налог', en: 'tax' } });
const steuerN = lex('Steuer', { pos: 'noun', genders: ['n'], tr: { ru: 'руль', en: 'steering wheel' } });

const dict: Record<string, LocalHit[]> = {
  haus: [{ entry: haus }],
  hausaufgabe: [{ entry: hausaufgabe }],
  ging: [{ entry: gehen, form: 'ging' }],
  see: [{ entry: seeM }, { entry: seeF }],
  sein: [{ entry: sein }, { entry: dasSein }],
};
const hit = (entry: LexEntry, translation: string, id = entry.term): ReverseHit => ({ id, entry, translation });

beforeEach(() => {
  mocks.lookupLocal.mockReset().mockImplementation(async (w) => dict[w.replace(/^(der|die|das)\s+/i, '').toLowerCase()] ?? []);
  mocks.suggest.mockReset().mockResolvedValue([]);
  mocks.reverseSearch.mockReset().mockResolvedValue([]);
});

const signal = () => new AbortController().signal;

describe('rows', () => {
  it('label with the article', () => {
    expect(rowLabel({ term: 'Haus', pos: 'noun', genders: ['n'] })).toBe('das Haus');
    expect(rowLabel({ term: 'Teil', pos: 'noun', genders: ['m', 'n'] })).toBe('der/das Teil');
    expect(rowLabel({ term: 'See', pos: 'noun', genders: ['m', 'f'], gender: 'f' })).toBe('die See');
    expect(rowLabel({ term: 'gehen', pos: 'verb', genders: [] })).toBe('gehen');
  });

  it('inflected form rows say which form was typed', () => {
    expect(exactRows([{ entry: gehen, form: 'ging' }], 'ru')).toMatchObject([{ term: 'gehen', form: 'ging', hint: 'идти' }]);
  });

  it('suggestions get their article from the offline entry; online ones have none', () => {
    const rows = suggestionRows([{ word: 'Haus', preview: 'дом' }, { word: 'See', genders: ['f'], preview: 'море' }, { word: 'Hausboot' }], [haus, seeF, null], 'ru');
    expect(rows.map((r) => [rowLabel(r), r.hint])).toEqual([
      ['das Haus', 'дом'],
      ['die See', 'море'],
      ['Hausboot', ''],
    ]);
  });

  it('reverse rows: German entry, matched translation as hint, one per id', () => {
    const rows = reverseRows([hit(steuerF, 'налог', 'Steuer'), hit(steuerF, 'налог', 'Steuer'), hit(steuerN, 'руль', 'Steuer#n')]);
    expect(rows.map((r) => [r.key, rowLabel(r), r.hint])).toEqual([
      ['Steuer', 'die Steuer', 'налог'],
      ['Steuer#n', 'das Steuer', 'руль'],
    ]);
  });
});

describe('buildGroups', () => {
  it('German first without repeats; "From English" leaves out words shown above', () => {
    const exact = exactRows([{ entry: haus }], 'en');
    const suggested = suggestionRows([{ word: 'Haus', preview: 'house' }, { word: 'Hausaufgabe' }], [haus, hausaufgabe], 'en');
    const english = reverseRows([hit(haus, 'house'), hit(lex('Gebäude', { pos: 'noun', genders: ['n'] }), 'house')]);
    const g = buildGroups({ query: 'haus', exact, suggested, english });
    expect(g.german.map(rowLabel)).toEqual(['das Haus', 'die Hausaufgabe']);
    expect(g.english.map(rowLabel)).toEqual(['das Gebäude']);
    expect(new Set(g.german.map((r) => r.key)).size).toBe(2);
  });

  it('an English query drops online-only suggestions (English words from Wiktionary)', () => {
    const suggested = suggestionRows([{ word: 'housewife', preview: 'домохозяйка' }, { word: 'Haus' }], [null, haus], 'ru');
    const g = buildGroups({ query: 'house', exact: [], suggested, english: reverseRows([hit(haus, 'house'), hit(lex('Gebäude', { pos: 'noun', genders: ['n'] }), 'house')]) });
    expect(g.german.map(rowLabel)).toEqual(['das Haus']);
    expect(g.english.map(rowLabel)).toEqual(['das Gebäude']);
    // Without English hits they stay (a German word the offline dictionary doesn't have).
    expect(buildGroups({ query: 'house', exact: [], suggested, english: [] }).german.map(rowLabel)).toEqual(['housewife', 'das Haus']);
  });

  it('keeps both articles of a split noun, and "sein" apart from "das Sein"', () => {
    const g = buildGroups({ query: 'see', exact: exactRows(dict.see, 'en'), suggested: [], english: reverseRows([hit(seeF, 'sea', 'See#f')]) });
    expect(g.german.map(rowLabel)).toEqual(['der See', 'die See']);
    expect(g.english).toEqual([]);
    const s = buildGroups({ query: 'sein', exact: exactRows(dict.sein, 'en'), suggested: [], english: [] });
    expect(s.german.map(rowLabel)).toEqual(['sein', 'das Sein']);
  });

  it('a typed article puts that article first and selects it', () => {
    const g = buildGroups({ query: 'die See', exact: exactRows(dict.see, 'en'), suggested: [], english: [] });
    expect(g.german.map(rowLabel)).toEqual(['die See', 'der See']);
    expect(g.german[0].gender).toBe('f');
    const online = buildGroups({ query: 'das Hausboot', exact: [], suggested: suggestionRows([{ word: 'Hausboot' }], [null], 'en'), english: [] });
    expect(online.german[0].gender).toBe('n');
  });
});

describe('searchWords', () => {
  it('Latin: German words and "From English" (reverseSearch en), without repeats', async () => {
    mocks.suggest.mockResolvedValue([{ word: 'Haus', preview: 'house' }, { word: 'Hausaufgabe', preview: 'homework' }]);
    mocks.reverseSearch.mockResolvedValue([hit(haus, 'house'), hit(lex('Gebäude', { pos: 'noun', genders: ['n'] }), 'house')]);
    const updates: number[] = [];
    const g = await searchWords(' Haus ', 'en', signal(), (x) => updates.push(x.german.length + x.english.length));
    expect(mocks.reverseSearch).toHaveBeenCalledWith('Haus', 'en', expect.any(Number));
    expect(g.german.map(rowLabel)).toEqual(['das Haus', 'die Hausaufgabe']);
    expect(g.english.map(rowLabel)).toEqual(['das Gebäude']);
    expect(g.russian).toEqual([]);
    expect(updates.length).toBe(3);
  });

  it('an inflected form finds its lemma first ("ging" → gehen)', async () => {
    mocks.suggest.mockResolvedValue([{ word: 'Gingko' }]);
    const g = await searchWords('ging', 'ru', signal());
    expect(g.german[0]).toMatchObject({ term: 'gehen', form: 'ging', hint: 'идти' });
  });

  it('Cyrillic: only reverseSearch ru', async () => {
    mocks.reverseSearch.mockResolvedValue([hit(steuerF, 'налог'), hit(steuerN, 'налог', 'Steuer#n')]);
    const g = await searchWords('налог', 'ru', signal());
    expect(mocks.reverseSearch).toHaveBeenCalledWith('налог', 'ru', expect.any(Number));
    expect(mocks.suggest).not.toHaveBeenCalled();
    expect(mocks.lookupLocal).not.toHaveBeenCalled();
    expect(g.russian.map(rowLabel)).toEqual(['die Steuer', 'das Steuer']);
    expect(g.german).toEqual([]);
  });

  it('short or empty queries search nothing; failing sources give no rows', async () => {
    expect(await searchWords('h', 'ru', signal())).toEqual({ german: [], english: [], russian: [] });
    expect(await searchWords('  ', 'ru', signal())).toEqual({ german: [], english: [], russian: [] });
    expect(mocks.suggest).not.toHaveBeenCalled();
    mocks.suggest.mockRejectedValue(new Error('offline'));
    mocks.reverseSearch.mockRejectedValue(new Error('no index'));
    const g = await searchWords('Haus', 'ru', signal());
    expect(g.german.map(rowLabel)).toEqual(['das Haus']);
    expect(g.english).toEqual([]);
  });

  it('no updates after abort', async () => {
    const ctrl = new AbortController();
    const updates: unknown[] = [];
    mocks.suggest.mockImplementation(async () => {
      ctrl.abort();
      return [{ word: 'Haus' }];
    });
    mocks.lookupLocal.mockImplementation(async () => []);
    await searchWords('Haus', 'ru', ctrl.signal, (g) => updates.push(g));
    expect(updates.length).toBeLessThanOrEqual(1);
  });
});
