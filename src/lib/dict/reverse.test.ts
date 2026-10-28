// Reverse search (Russian / English → German): the build (scripts/dict/reverse-lib.mjs) on a small
// fixture served by a stubbed fetch, parity of build and runtime, and the committed public/dict/rev.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as lib from '../../../scripts/dict/reverse-lib.mjs';
import type { Lang } from '../types';

type Reverse = typeof import('./reverse');
type Source = { id: string; rank: number; tags: string; tr: string };

let rev: Reverse;
let served: Map<string, string>;
let requests: string[];
let failing: boolean;

/** id, rank, tags, ru, en */
const FIXTURE: [string, number, string, string, string][] = [
  ['Steuer#f', 2753, 'nf4', 'налог', 'tax; taxman'],
  ['Steuer', 2158, 'nn3', 'штурвал, руль', 'rudder'],
  ['Steuerberater', 9000, 'nm', 'налоговый консультант', 'tax advisor'],
  ['Telefon', 473, 'nn1', 'телефон', 'telephone, phone'],
  ['Handy', 641, 'nn2', 'мобильный телефон, сотовый телефон', 'cell phone / cellphone, mobile'],
  ['Telefonbuch', 5000, 'nn', 'телефонная книга', 'phone book'],
  ['Bank', 836, 'nf2', 'скамейка; банк', 'bench; bank'],
  ['Geldinstitut', 15000, 'nn', 'банк, кредитное учреждение', 'bank, financial institution'],
  ['Pritsche', 100, 'nf', 'нары; скамейка', 'plank bed; bench'],
  ['See', 1112, 'nm2', 'озеро', 'lake'],
  ['See#f', 2632, 'nf4', 'море', 'sea'],
  ['Meer', 1111, 'nn2', 'море', 'sea'],
  ['Gehalt', 3053, 'nm4', 'содержание', 'content'],
  ['Gehalt#n', 3498, 'nn4', 'зарплата', 'salary'],
  ['Lohn', 4872, 'nm5', 'зарплата', 'wage'],
  ['spazieren', 1775, 'vs3', 'гулять, прогуливаться', 'stroll, walk'],
  ['Tanne', 6000, 'nf', 'ёлка, пихта', 'fir'],
  ['erkundigen', 7000, 'vh', 'справляться / справиться (&lsqb, осведомляться', 'inquire'],
  ['Fabrik', 900, 'nf2', 'заво́д, фабрика', 'factory'],
  ['abarbeiten', 9500, 'vh', 'отрабатывать', 'process; work one’s fingers down to the bone'],
];

function sources(): Record<Lang, Source[]> {
  const out: Record<Lang, Source[]> = { ru: [], en: [] };
  for (const [id, rank, tags, ru, en] of FIXTURE) {
    out.ru.push({ id, rank, tags, tr: ru });
    out.en.push({ id, rank, tags, tr: en });
  }
  return out;
}

/** Serves a built reverse dictionary (name → JSON text) at …/dict/rev/. */
function serve(files: Map<string, string>) {
  served = files;
  vi.stubGlobal('fetch', async (url: string) => {
    const name = String(url).split('/dict/rev/')[1];
    requests.push(name);
    if (failing) throw new TypeError('Failed to fetch');
    const text = served.get(name);
    if (text === undefined) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => JSON.parse(text) };
  });
}

function build(opts?: { maxFile?: number; cap?: number }) {
  const { index, files } = lib.buildReverse(sources(), opts);
  return new Map([...files, ['index.json', JSON.stringify(index)]]);
}

beforeEach(async () => {
  requests = [];
  failing = false;
  // Tiny files so that keys are split and spread over several files.
  serve(build({ maxFile: 120 }));
  vi.resetModules();
  rev = await import('./reverse');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const ids = async (q: string, lang: Lang, limit?: number) => (await rev.reverseSearch(q, lang, limit)).map((h) => h.id);

describe('reverseSearch ranking', () => {
  it('ranks a whole synonym first, then a word of a synonym, then words being typed', async () => {
    expect(await ids('налог', 'ru')).toEqual(['Steuer#f', 'Steuerberater']);
    expect(await ids('tax', 'en')).toEqual(['Steuer#f', 'Steuerberater']);
    // Telefon is "телефон"; Handy has it in "мобильный телефон"; Telefonbuch only begins with it.
    expect(await ids('телефон', 'ru')).toEqual(['Telefon', 'Handy', 'Telefonbuch']);
    expect(await ids('phone', 'en')).toEqual(['Telefon', 'Handy', 'Telefonbuch']);
    expect(await ids('нал', 'ru')).toEqual(['Steuer#f', 'Steuerberater']);
    expect(await ids('теле', 'ru')).toEqual(['Telefon', 'Handy', 'Telefonbuch']);
  });

  it('returns the German entry with its article and the matched translation', async () => {
    const [steuer] = await rev.reverseSearch('налог', 'ru');
    expect(steuer.translation).toBe('налог');
    expect(steuer.entry).toMatchObject({ term: 'Steuer', pos: 'noun', genders: ['f'], rank: 2753, level: 'B2' });
    expect(steuer.entry.tr).toEqual({ ru: 'налог', en: '' });
    const handy = (await rev.reverseSearch('телефон', 'ru'))[1];
    expect(handy.translation).toBe('мобильный телефон');
    expect(handy.entry.tr.ru).toBe('мобильный телефон');
    const walk = await rev.reverseSearch('walk', 'en');
    expect(walk[0].entry).toMatchObject({ term: 'spazieren', pos: 'verb', auxiliary: 'sein', level: 'B1' });
  });

  it('puts a word whose first meaning matches before one whose later meaning does', async () => {
    // Bank = "скамейка; банк": first for "скамейка" (before the more common Pritsche, whose
    // second meaning it is), after Geldinstitut for "банк".
    expect(await ids('скамейка', 'ru')).toEqual(['Bank', 'Pritsche']);
    expect(await ids('банк', 'ru')).toEqual(['Geldinstitut', 'Bank']);
    expect(await ids('bench', 'en')).toEqual(['Bank', 'Pritsche']);
  });

  it('orders equal matches by frequency and keeps two-article nouns apart', async () => {
    const sea = await rev.reverseSearch('море', 'ru');
    expect(sea.map((h) => [h.id, h.entry.term, h.entry.genders])).toEqual([
      ['Meer', 'Meer', ['n']],
      ['See#f', 'See', ['f']],
    ]);
    const lake = await rev.reverseSearch('озеро', 'ru');
    expect(lake.map((h) => [h.id, h.entry.genders])).toEqual([['See', ['m']]]);
    expect(await ids('зарплата', 'ru')).toEqual(['Gehalt#n', 'Lohn']);
    expect(await ids('salary', 'en')).toEqual(['Gehalt#n']);
  });

  it('matches multi-word queries, also while the last word is typed', async () => {
    expect(await ids('мобильный телефон', 'ru')).toEqual(['Handy']);
    expect((await rev.reverseSearch('сотовый телефон', 'ru'))[0].translation).toBe('сотовый телефон');
    expect(await ids('мобильный тел', 'ru')).toEqual(['Handy']);
    expect(await ids('налоговый консультант', 'ru')).toEqual(['Steuerberater']);
    expect(await ids('tax advisor', 'en')).toEqual(['Steuerberater']);
    expect(await ids('phone book', 'en')).toEqual(['Telefonbuch']);
    expect(await ids('book', 'en')).toEqual(['Telefonbuch']);
    expect(await ids('мобильный утюг', 'ru')).toEqual([]);
  });

  it('normalises case, ё, stress marks and stop words; keeps й', async () => {
    for (const q of ['ёлка', 'елка', 'ЁЛКА', ' Ёлка ']) {
      const hits = await rev.reverseSearch(q, 'ru');
      expect(hits.map((h) => [h.id, h.translation])).toEqual([['Tanne', 'ёлка']]);
    }
    expect((await rev.reverseSearch('завод', 'ru'))[0]).toMatchObject({ id: 'Fabrik', translation: 'заво́д' });
    expect(await ids('to walk', 'en')).toEqual(['spazieren']);
    expect(await ids('Walk', 'en')).toEqual(['spazieren']);
    expect(rev.revNormalize('Чайник Ёж')).toBe('чайник еж');
  });

  it('matches "/" variants and ignores Wiktionary leftovers', async () => {
    expect(await rev.reverseSearch('справиться', 'ru')).toMatchObject([{ id: 'erkundigen', translation: 'справляться / справиться' }]);
    expect(await rev.reverseSearch('cellphone', 'en')).toMatchObject([{ id: 'Handy', translation: 'cell phone / cellphone' }]);
    expect(await ids('cell phone', 'en')).toEqual(['Handy']);
    expect(await ids('lsqb', 'ru')).toEqual([]);
    // Descriptions of more than MAX_WORDS words aren't indexed.
    expect(await ids('fingers', 'en')).toEqual([]);
  });

  it('searches English only for Latin queries and Russian only for Cyrillic ones', async () => {
    expect(rev.queryScript('налог')).toBe('ru');
    expect(rev.queryScript('tax')).toBe('latin');
    expect(rev.queryScript('42 !')).toBe('none');
    expect(await ids('налог', 'en')).toEqual([]);
    expect(await ids('tax', 'ru')).toEqual([]);
    expect(await ids('42', 'en')).toEqual([]);
    expect(await ids('', 'ru')).toEqual([]);
    expect(await ids('to', 'en')).toEqual([]);
    // Two letters aren't completed (too many words begin so), only matched whole.
    expect(await ids('те', 'ru')).toEqual([]);
  });

  it('returns at most limit hits, each id once', async () => {
    expect(await ids('телефон', 'ru', 2)).toEqual(['Telefon', 'Handy']);
    expect(await ids('телефон', 'ru', 0)).toEqual([]);
    // Handy matches "сотовый" and "телефон" (and "мобильный") but is listed once.
    const hits = await ids('телефон', 'ru', 50);
    expect(new Set(hits).size).toBe(hits.length);
  });
});

describe('reverseSearch loading', () => {
  it('fetches the index once and only the files of the query words', async () => {
    serve(build());
    vi.resetModules();
    rev = await import('./reverse');
    await rev.reverseSearch('налог', 'ru');
    await rev.reverseSearch('налоговый', 'ru');
    await rev.reverseSearch('tax', 'en');
    expect(requests.filter((r) => r === 'index.json')).toHaveLength(1);
    expect(requests.filter((r) => r.startsWith('ru-'))).toHaveLength(1);
    expect(requests.filter((r) => r.startsWith('en-'))).toHaveLength(1);
  });

  it('returns [] offline and retries later', async () => {
    failing = true;
    expect(await rev.reverseSearch('налог', 'ru')).toEqual([]);
    failing = false;
    expect(await ids('налог', 'ru')).toEqual(['Steuer#f', 'Steuerberater']);
  });

  it('forgets a failed shard file', async () => {
    const files = build();
    const shard = [...files.keys()].find((n) => n.startsWith('ru-'))!;
    const text = files.get(shard)!;
    files.delete(shard);
    serve(files);
    vi.resetModules();
    rev = await import('./reverse');
    expect(await rev.reverseSearch('налог', 'ru')).toEqual([]);
    files.set(shard, text);
    expect(await ids('налог', 'ru')).toEqual(['Steuer#f', 'Steuerberater']);
  });

  it('never throws on a missing or malformed index or file', async () => {
    for (const index of ['{"version":1,"langs":{}}', '{"version":2,"tags":[],"langs":{"ru":{"keys":{"на":0}}}}', 'null']) {
      serve(new Map([['index.json', index]]));
      vi.resetModules();
      rev = await import('./reverse');
      expect(await rev.reverseSearch('налог', 'ru')).toEqual([]);
    }
    const tags = ['nf'];
    serve(
      new Map([
        ['index.json', JSON.stringify({ version: 2, tags, langs: { ru: { files: ['ru-x.json'], keys: { на: 0, те: 0 } } } })],
        ['ru-x.json', JSON.stringify({ на: 'garbage<<>|', те: 42 })],
      ]),
    );
    vi.resetModules();
    rev = await import('./reverse');
    expect(await rev.reverseSearch('налог', 'ru')).toEqual([]);
    expect(await rev.reverseSearch('телефон', 'ru')).toEqual([]);
  });
});

describe('build and runtime agree (scripts/dict/reverse-lib.mjs)', () => {
  const samples = ['Ёлка', 'заво́д', 'Чайник', 'мобильный телефон, сотовый', 'Café / naïve', "one's own", 'кого-либо', 'X-Ray 42', ''];

  it('normalise and split words the same way', () => {
    expect(rev.B64).toBe(lib.B64);
    expect([...rev.STOP].sort()).toEqual([...lib.STOP].sort());
    for (const s of samples) {
      expect(rev.revNormalize(s)).toBe(lib.revNormalize(s));
      expect(rev.revTokens(s)).toEqual(lib.revTokens(s));
      expect(rev.revWords(s)).toEqual(lib.revWords(s));
      expect(rev.revKey(s)).toBe(lib.revKey(s));
    }
  });

  it('decodes what the build encodes', () => {
    const tagIndex = new Map([['nf4', 0], ['nm', 1], ['vh5', 63]]);
    const tags = Object.assign(new Array<string>(64).fill(''), { 0: 'nf4', 1: 'nm', 63: 'vh5' });
    const postings = [
      { id: 'Steuer#f', rank: 2753, tags: 'nf4', kind: 0, meaning: 0, len: 1, text: 'налог' },
      { id: 'Handy', rank: 1, tags: 'nm', kind: 1, meaning: 3, len: 2, text: 'мобильный телефон / Телефон' },
      { id: 'Zz-top', rank: lib.MAX_RANK, tags: 'vh5', kind: 0, meaning: 2, len: 1, text: 'ёлка' },
    ];
    for (const p of postings) {
      const token = p.id === 'Handy' ? 'телефон' : p.id === 'Zz-top' ? 'елка' : 'налог';
      const [d] = rev.decodePostings(token, lib.encodePosting(p, token, tagIndex), tags);
      expect(d).toEqual({ id: p.id, rank: p.rank, tags: p.tags, kind: p.kind, meaning: p.meaning, text: p.text });
    }
    expect(lib.encodePosting({ ...postings[0], rank: 99999 }, 'налог', tagIndex).slice(0, 4)).toBe(
      lib.encodePosting({ ...postings[0], rank: lib.MAX_RANK }, 'налог', tagIndex).slice(0, 4),
    );
    const tokens: [string, string][] = [['на', 'a'], ['наличные', 'b'], ['наличный', 'c'], ['налог', 'd'], ['налоговый', 'e']];
    expect([...rev.decodeBlock('на', lib.encodeBlock('на', tokens))]).toEqual(tokens);
  });

  it('splits big keys into longer prefixes and keeps every file small', () => {
    const { index, files } = lib.buildReverse(sources(), { maxFile: 120 });
    const keys = Object.keys(index.langs.ru.keys);
    expect(keys.some((k) => k.length > 2)).toBe(true);
    // Files stay under maxFile unless one key's block alone is bigger.
    for (const text of files.values()) {
      if (Object.keys(JSON.parse(text)).length > 1) expect(Buffer.byteLength(text)).toBeLessThanOrEqual(120);
    }
    // Every token is in the block of the longest key it starts with.
    for (const [lang, { files: names, keys: map }] of Object.entries(index.langs)) {
      for (const [key, n] of Object.entries(map)) {
        const block = JSON.parse(files.get(names[n])!)[key];
        for (const token of rev.decodeBlock(key, block).keys()) {
          const longest = Object.keys(map).filter((k) => token.startsWith(k)).sort((a, b) => b.length - a.length)[0];
          expect([lang, longest]).toEqual([lang, key]);
        }
      }
    }
  });

  it('caps the postings of a token', () => {
    const many: Source[] = Array.from({ length: 80 }, (_, i) => ({ id: `W${i}`, rank: 80 - i, tags: 'nm', tr: 'слово' }));
    const list = lib.buildPostings(many).get('слово')!;
    expect(list).toHaveLength(lib.CAP);
    expect(list[0].rank).toBe(1);
  });
});

describe('committed reverse dictionary (public/dict/rev)', () => {
  const REV = new URL('../../../public/dict/rev/', import.meta.url);
  const DICT = new URL('../../../public/dict/', import.meta.url);
  const have = existsSync(new URL('index.json', REV));

  beforeEach(async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      const file = new URL(String(url).split('/dict/rev/')[1], REV);
      requests.push(String(url).split('/dict/rev/')[1]);
      if (!existsSync(file)) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(file, 'utf8')) };
    });
    vi.resetModules();
    rev = await import('./reverse');
  });

  it.skipIf(!have)('stays small: no file over 30 KB, under 1.2 MB in all', () => {
    const sizes = readdirSync(REV).map((f) => statSync(new URL(f, REV)).size);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(30 * 1024);
    expect(sizes.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1.2 * 1024 * 1024);
  });

  it.skipIf(!have)('is up to date with public/dict (run `node scripts/dict/reverse.mjs`)', () => {
    const entries: Record<Lang, Source[]> = { ru: [], en: [] };
    const pieces = readdirSync(DICT).filter((f) => f.endsWith('.json') && f !== 'index.json').sort();
    for (const f of pieces) {
      const { lemmas } = JSON.parse(readFileSync(new URL(f, DICT), 'utf8')) as { lemmas: Record<string, [number, string, string, string]> };
      for (const [id, [rank, tags, ru, en]] of Object.entries(lemmas)) {
        if (ru) entries.ru.push({ id, rank, tags, tr: ru });
        if (en) entries.en.push({ id, rank, tags, tr: en });
      }
    }
    const { index, files } = lib.buildReverse(entries);
    expect(JSON.parse(readFileSync(new URL('index.json', REV), 'utf8'))).toEqual(index);
    expect(readdirSync(REV).filter((f) => f !== 'index.json').sort()).toEqual([...files.keys()].sort());
  });

  it.skipIf(!have)('finds the German words for common Russian and English words', async () => {
    const top3 = async (q: string, lang: Lang) => (await rev.reverseSearch(q, lang, 3)).map((h) => h.id);
    expect(await top3('налог', 'ru')).toContain('Steuer#f');
    expect(await top3('tax', 'en')).toContain('Steuer#f');
    expect(await top3('зарплата', 'ru')).toContain('Gehalt#n');
    expect(await top3('salary', 'en')).toContain('Gehalt#n');
    expect(await top3('озеро', 'ru')).toContain('See');
    expect(await top3('lake', 'en')).toContain('See');
    expect(await top3('море', 'ru')).toEqual(expect.arrayContaining(['Meer', 'See#f']));
    expect(await top3('sea', 'en')).toEqual(expect.arrayContaining(['Meer', 'See#f']));
    expect(await top3('телефон', 'ru')).toContain('Telefon');
    expect(await top3('мобильный телефон', 'ru')).toContain('Handy');
    expect(await top3('гулять', 'ru')).toContain('spazieren');
    expect(await top3('скамейка', 'ru')).toContain('Bank');
    expect(await top3('дом', 'ru')).toContain('Haus');
    expect(await top3('house', 'en')).toContain('Haus');
    expect(await top3('красивый', 'ru')).toContain('schön');
    expect(await top3('большой', 'ru')).toContain('groß');
    const [steuer] = await rev.reverseSearch('налог', 'ru', 1);
    expect(steuer.entry).toMatchObject({ term: 'Steuer', genders: ['f'] });
    const sea = await rev.reverseSearch('море', 'ru', 2);
    expect(sea.map((h) => [h.entry.term, h.entry.genders[0]])).toEqual([['Meer', 'n'], ['See', 'f']]);
  });

  it.skipIf(!have)('loads one shard file for a one-word search', async () => {
    requests = [];
    await rev.reverseSearch('налог', 'ru');
    await rev.reverseSearch('tax', 'en');
    expect(requests.filter((r) => r !== 'index.json')).toHaveLength(2);
  });
});
