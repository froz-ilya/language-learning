import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LevelFile, LevelIndex, LevelWord } from './types';

// Node has no IndexedDB: a tiny in-memory stand-in for the Dexie tables install.ts uses.
const mem = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  class Table {
    rows = new Map<unknown, Row>();
    next = 1;
    constructor(private pk: string, private auto: boolean) {}
    clear() {
      this.rows.clear();
      this.next = 1;
    }
    async add(row: Row) {
      const r = { ...row };
      if (this.auto && r[this.pk] === undefined) r[this.pk] = this.next++;
      this.rows.set(r[this.pk], r);
      return r[this.pk];
    }
    async bulkAdd(rows: Row[]) {
      for (const r of rows) await this.add(r);
    }
    async put(row: Row) {
      return this.add(row);
    }
    async get(key: unknown) {
      return this.rows.get(key);
    }
    async delete(key: unknown) {
      this.rows.delete(key);
    }
    async bulkDelete(keys: unknown[]) {
      keys.forEach((k) => this.rows.delete(k));
    }
    all() {
      return [...this.rows.values()];
    }
    where(field: string) {
      const coll = (pred: (r: Row) => boolean) => {
        const list = () => this.all().filter(pred);
        return {
          toArray: async () => list(),
          first: async () => list()[0],
          primaryKeys: async () => list().map((r) => r[this.pk]),
          count: async () => list().length,
        };
      };
      return {
        equals: (v: unknown) => coll((r) => r[field] === v),
        anyOf: (vs: unknown[]) => {
          const set = new Set(vs);
          return coll((r) => set.has(r[field]));
        },
      };
    }
  }
  const tables = {
    folders: new Table('id', true),
    sets: new Table('id', true),
    cards: new Table('id', true),
    reviews: new Table('cardId', false),
  };
  return { tables, Table };
});

vi.mock('../db/schema', () => ({
  db: {
    ...mem.tables,
    transaction: async (...args: unknown[]) => (args[args.length - 1] as () => Promise<unknown>)(),
  },
}));

const { fetchLevelIndex, installLevel, uninstallLevel, wordToCard } = await import('./install');

function word(term: string, topic: string, rank: number, extra: Partial<LevelWord> = {}): LevelWord {
  return {
    id: `A1:${term}`,
    term,
    pos: 'noun',
    genders: ['n'],
    plural: '',
    praeteritum: '',
    partizip2: '',
    auxiliary: '',
    tr: { ru: `ru-${term}`, en: `en-${term}` },
    topic,
    rank,
    ...extra,
  };
}

const A1: LevelFile = {
  level: 'A1',
  words: [
    word('Haus', 'Wohnen & Haushalt', 1, {
      plural: 'Häuser',
      example: { de: 'Das Haus ist groß.', ru: 'Дом большой.', en: 'The house is big.' },
    }),
    word('gehen', 'Alltagsverben', 2, {
      pos: 'verb',
      genders: [],
      praeteritum: 'ging',
      partizip2: 'gegangen',
      auxiliary: 'sein',
      tr: { ru: '', en: 'to go' },
      example: { de: 'Ich gehe.', en: 'I go.' },
    }),
    word('Tisch', 'Wohnen & Haushalt', 3, { genders: ['m'] }),
    word('gut', 'Eigenschaften', 4, { pos: 'adj', genders: [] }),
  ],
};

const INDEX: LevelIndex = {
  version: 1,
  sources: 'x',
  levels: [{ code: 'A1', words: 4, topics: [{ name: 'Wohnen & Haushalt', count: 2 }] }],
};

let requested: string[] = [];

beforeEach(() => {
  Object.values(mem.tables).forEach((t) => t.clear());
  requested = [];
  vi.stubGlobal('fetch', async (url: string) => {
    requested.push(url);
    const body = url.endsWith('index.json') ? INDEX : url.endsWith('A1.json') ? A1 : null;
    return { ok: !!body, status: body ? 200 : 404, json: async () => body };
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('fetchLevelIndex', () => {
  it('loads index.json under the base url', async () => {
    expect(await fetchLevelIndex()).toEqual(INDEX);
    expect(requested[0]).toMatch(/levels\/index\.json$/);
  });
  it('throws on a missing file', async () => {
    await expect(installLevel('B2', 'en')).rejects.toThrow(/B2\.json/);
  });
});

describe('wordToCard', () => {
  it('falls back to English and keeps grammar', () => {
    const c = wordToCard(A1.words[1], 7, 'ru');
    expect(c).toMatchObject({
      setId: 7,
      term: 'gehen',
      translation: 'to go',
      pos: 'verb',
      praeteritum: 'ging',
      partizip2: 'gegangen',
      auxiliary: 'sein',
      presetId: 'A1:gehen',
      known: 0,
      needsFill: 0,
      examples: [{ de: 'Ich gehe.', tr: 'I go.' }],
    });
  });
});

describe('installLevel', () => {
  it('creates a folder, one set per topic in order, and cards', async () => {
    const progress: [number, number][] = [];
    const folderId = await installLevel('A1', 'ru', (d, t) => progress.push([d, t]));
    const folder = await mem.tables.folders.get(folderId);
    expect(folder).toMatchObject({ name: 'A1 · Beginner', level: 'A1' });

    const sets = mem.tables.sets.all();
    expect(sets.map((s) => s.name)).toEqual(['Wohnen & Haushalt', 'Alltagsverben', 'Eigenschaften']);
    expect(sets.every((s) => s.level === 'A1' && s.folderId === folderId && s.topic === s.name)).toBe(true);

    const cards = mem.tables.cards.all();
    expect(cards).toHaveLength(4);
    const haus = cards.find((c) => c.term === 'Haus')!;
    expect(haus).toMatchObject({
      translation: 'ru-Haus',
      plural: 'Häuser',
      genders: ['n'],
      presetId: 'A1:Haus',
      examples: [{ de: 'Das Haus ist groß.', tr: 'Дом большой.' }],
      setId: sets[0].id,
    });
    expect(cards.find((c) => c.term === 'Tisch')!.examples).toEqual([]);
    expect(progress.at(-1)).toEqual([4, 4]);
  });

  it('is idempotent and reuses the folder and sets', async () => {
    const id1 = await installLevel('A1', 'en');
    // Simulate a partially installed level: remove one card.
    const tisch = mem.tables.cards.all().find((c) => c.term === 'Tisch')!;
    await mem.tables.cards.delete(tisch.id);
    const progress: [number, number][] = [];
    const id2 = await installLevel('A1', 'en', (d, t) => progress.push([d, t]));
    expect(id2).toBe(id1);
    expect(mem.tables.folders.all()).toHaveLength(1);
    expect(mem.tables.sets.all()).toHaveLength(3);
    expect(mem.tables.cards.all()).toHaveLength(4);
    expect(progress.at(-1)).toEqual([1, 1]);
  });
});

describe('uninstallLevel', () => {
  it('removes folder, sets, cards and reviews but leaves other data', async () => {
    await installLevel('A1', 'en');
    const own = (await mem.tables.cards.add({ setId: 999, term: 'Mine', presetId: '' })) as number;
    const preset = mem.tables.cards.all()[0].id;
    await mem.tables.reviews.add({ cardId: preset, due: 0 });
    await mem.tables.reviews.add({ cardId: own, due: 0 });

    await uninstallLevel('A1');
    expect(mem.tables.folders.all()).toHaveLength(0);
    expect(mem.tables.sets.all()).toHaveLength(0);
    expect(mem.tables.cards.all().map((c) => c.term)).toEqual(['Mine']);
    expect(mem.tables.reviews.all().map((r) => r.cardId)).toEqual([own]);
  });
});
