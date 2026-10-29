// Data saved by older app versions must open and work in the current one (see CLAUDE.md).
// Each test builds a database exactly as an old version stored it, then opens it with today's code.
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Schemas exactly as each released version declared them. Never edit these: add a new one. */
const V1 = {
  folders: '++id, name',
  sets: '++id, folderId, name',
  cards: '++id, setId, term, starred, needsFill, pos',
  reviews: 'cardId, due, lastWrong',
  lookupCache: 'key',
  settings: 'id',
};
const V2 = {
  ...V1,
  folders: '++id, name, level',
  sets: '++id, folderId, name, level',
  cards: '++id, setId, term, starred, needsFill, pos, known, presetId',
};
const V3 = { ...V2, articles: 'id, source, savedAt, readAt' };
/** v4 changed no tables (it only cleared lookupCache). */
const V4 = V3;
/** v5 changed no tables either (it cleared lookupCache again). */
const V5 = V4;

function oldDb(version: number, stores: Record<string, string>) {
  const d = new Dexie('deutsch');
  d.version(version).stores(stores);
  return d;
}

const fsrs = {
  due: new Date('2026-10-20T10:00:00Z'),
  stability: 3.2,
  difficulty: 5.1,
  elapsed_days: 1,
  scheduled_days: 3,
  learning_steps: 0,
  reps: 4,
  lapses: 1,
  state: 2,
  last_review: new Date('2026-10-17T10:00:00Z'),
};

/** A word as v1 saved it: no known/presetId; a flat (single-meaning) translation. */
const v1Card = {
  setId: 1,
  term: 'Tisch',
  translation: 'стол, столик',
  pos: 'noun',
  genders: ['m'],
  plural: 'Tische',
  praeteritum: '',
  partizip2: '',
  auxiliary: '',
  examples: [{ de: 'Der Tisch ist groß.', tr: 'Стол большой.' }],
  notes: 'think of a dish',
  starred: 1,
  needsFill: 0,
  createdAt: 1,
};

/** Settings as v1 saved them (no fields added later). */
const v1Settings = {
  id: 'main',
  lang: 'en',
  voiceURI: 'com.apple.voice.Anna',
  rate: 0.8,
  autoplay: false,
  strictness: 'strict',
  requireArticle: false,
  direction: 'de-x',
};

async function seedV1() {
  const d = oldDb(1, V1);
  await d.table('folders').add({ name: 'School', createdAt: 1 });
  await d.table('sets').add({ name: 'Möbel', folderId: 1, createdAt: 1 });
  await d.table('cards').add(v1Card);
  await d.table('reviews').put({ cardId: 1, due: fsrs.due.getTime(), fsrs, mistakes: 6, lastWrong: 5 });
  await d.table('settings').put(v1Settings);
  await d.table('lookupCache').put({ key: 'ru:Haus', result: null, fetchedAt: 1 });
  d.close();
}

beforeEach(async () => {
  await Dexie.delete('deutsch');
  vi.resetModules();
});

describe('upgrading the database', () => {
  it('opens a v1 database and fills in every field added since', async () => {
    await seedV1();
    const { db } = await import('./schema');

    expect(await db.folders.get(1)).toMatchObject({ name: 'School', level: '' });
    expect(await db.sets.get(1)).toMatchObject({ name: 'Möbel', folderId: 1, level: '', topic: '' });
    expect(await db.cards.get(1)).toMatchObject({ ...v1Card, known: 0, presetId: '' });
    // New indexes work on upgraded rows.
    expect(await db.cards.where('known').equals(0).count()).toBe(1);
    expect(await db.sets.where('level').equals('').count()).toBe(1);
    // Study progress is untouched, dates stay Dates.
    const review = await db.reviews.get(1);
    expect(review?.mistakes).toBe(6);
    expect(review?.fsrs.due).toBeInstanceOf(Date);
    expect(review?.fsrs.stability).toBe(3.2);
    // Tables added later exist; the stale lookup cache is cleared.
    expect(await db.articles.count()).toBe(0);
    expect(await db.lookupCache.count()).toBe(0);
    expect(db.verno).toBe(6);
  });

  it('keeps v1 settings and adds defaults for settings added later', async () => {
    await seedV1();
    const { settings, loadSettings, defaultSettings } = await import('../settings.svelte');
    await loadSettings();
    // Saved choices win…
    expect(settings).toMatchObject(v1Settings);
    // …and every newer setting has its default.
    for (const key of Object.keys(defaultSettings) as (keyof typeof defaultSettings)[]) {
      if (!(key in v1Settings)) expect(settings[key]).toEqual(defaultSettings[key]);
    }
  });

  it('opens a v3 database (first deployed version) with articles and level words', async () => {
    const d = oldDb(3, V3);
    await d.table('folders').add({ name: 'A1 · Beginner', level: 'A1', createdAt: 1 });
    await d.table('sets').add({ name: 'Essen', folderId: 1, level: 'A1', topic: 'Essen', createdAt: 1 });
    await d.table('cards').add({ ...v1Card, known: 1, presetId: 'A1:Tisch' });
    await d.table('articles').put({
      id: 'klexikon:Hund',
      source: 'klexikon',
      title: 'Hund',
      paragraphs: ['Der Hund bellt.'],
      url: 'https://klexikon.zum.de/wiki/Hund',
      license: 'CC BY-SA 4.0',
      attribution: 'Klexikon',
      level: 'A2',
      savedAt: 5,
      readAt: 0,
      setId: 1,
      progress: 0,
    });
    await d.table('lookupCache').put({ key: 'ru:Tisch', result: null, fetchedAt: 1 });
    d.close();

    const { db } = await import('./schema');
    expect(await db.cards.where('presetId').equals('A1:Tisch').first()).toMatchObject({ known: 1 });
    expect(await db.articles.get('klexikon:Hund')).toMatchObject({ setId: 1, savedAt: 5 });
    expect(await db.lookupCache.count()).toBe(0);
  });

  it('opens a v4 database: drops cached lookups of the old shape, keeps the words', async () => {
    const d = oldDb(4, V4);
    await d.table('folders').add({ name: 'A1 · Beginner', level: 'A1', createdAt: 1 });
    await d.table('sets').add({ name: 'Essen', folderId: 1, level: 'A1', topic: 'Essen', createdAt: 1 });
    await d.table('cards').add({ ...v1Card, known: 0, presetId: 'A1:Tisch' });
    await d.table('reviews').put({ cardId: 1, due: fsrs.due.getTime(), fsrs, mistakes: 2, lastWrong: 0 });
    // A lookup as v4 cached it (key "v3:…", examples without meaningExamples/phrases).
    const result = {
      term: 'Tisch',
      pos: 'noun',
      genders: ['m'],
      plural: 'Tische',
      praeteritum: '',
      partizip2: '',
      auxiliary: '',
      translation: 'стол',
      examples: [{ de: 'Der Tisch ist groß.', tr: 'Стол большой.' }],
      source: 'wiktionary',
    };
    await d.table('lookupCache').put({ key: 'v3:ru:Tisch', result, fetchedAt: Date.now(), via: 'de.wiktionary' });
    d.close();

    const { db } = await import('./schema');
    expect(db.verno).toBe(6);
    expect(await db.lookupCache.count()).toBe(0);
    expect(await db.cards.get(1)).toMatchObject({ ...v1Card, known: 0, presetId: 'A1:Tisch' });
    expect(await db.sets.get(1)).toMatchObject({ name: 'Essen', level: 'A1' });
    expect((await db.reviews.get(1))?.fsrs.due).toBeInstanceOf(Date);
  });

  it('opens a v5 database: drops cached lookups of the old shape, keeps words saved without preps', async () => {
    const d = oldDb(5, V5);
    await d.table('folders').add({ name: 'School', level: '', createdAt: 1 });
    await d.table('sets').add({ name: 'Verben', folderId: 1, level: '', topic: '', createdAt: 1 });
    // Words as v5 saved them: no `preps`; a reflexive verb is just a term with "sich".
    const tisch = { ...v1Card, id: 1, known: 0, presetId: '' };
    const freuen = { ...v1Card, id: 2, term: 'sich freuen', translation: 'радоваться', pos: 'verb', genders: [], plural: '', praeteritum: 'freute', partizip2: 'gefreut', auxiliary: 'haben', examples: [], notes: '', starred: 0, known: 0, presetId: '' };
    await d.table('cards').add(tisch);
    await d.table('cards').add(freuen);
    await d.table('reviews').put({ cardId: 2, due: fsrs.due.getTime(), fsrs, mistakes: 1, lastWrong: 0 });
    // A lookup as v5 cached it (key "v4:…", with meaningExamples/phrases but no reflexive/preps).
    const result = {
      term: 'freuen',
      pos: 'verb',
      genders: [],
      plural: '',
      praeteritum: 'freute',
      partizip2: 'gefreut',
      auxiliary: 'haben',
      translation: 'радоваться',
      examples: [{ de: 'Ich freue mich.', tr: 'Я рад.' }],
      meaningExamples: [[{ de: 'Ich freue mich.', tr: 'Я рад.' }]],
      phrases: [{ de: 'sich des Lebens freuen', tr: 'наслаждаться жизнью' }],
      source: 'wiktionary',
    };
    await d.table('lookupCache').put({ key: 'v4:ru:freuen', result, fetchedAt: Date.now(), via: 'de.wiktionary' });
    d.close();

    const { db } = await import('./schema');
    expect(db.verno).toBe(6);
    expect(await db.lookupCache.count()).toBe(0);
    const [a, b] = [(await db.cards.get(1))!, (await db.cards.get(2))!];
    expect(a).toEqual(tisch);
    expect(b).toEqual(freuen);
    expect(b).not.toHaveProperty('preps');
    expect((await db.reviews.get(2))?.fsrs.due).toBeInstanceOf(Date);
    // Such a card takes prepositions later like any field.
    const { mergeIntoCard } = await import('../lookup/lookup');
    const filled = mergeIntoCard(b, { ...result, term: 'sich freuen', preps: 'auf + Akk; über + Akk' } as never);
    expect(filled).toEqual({ ...b, examples: result.examples, preps: 'auf + Akk; über + Akk', needsFill: 0 });
    await db.cards.put(filled);
    expect((await db.cards.get(2))?.preps).toBe('auf + Akk; über + Akk');
  });

  it('upgraded words still work with today’s logic', async () => {
    await seedV1();
    const { db } = await import('./schema');
    const { statusOf, isHard } = await import('../progress');
    const { splitMeanings } = await import('../german/meanings');
    const card = (await db.cards.get(1))!;
    const review = await db.reviews.get(1);
    expect(statusOf(card, review)).toBe('learning');
    expect(isHard(card, review)).toBe(true);
    // A flat old translation reads as one meaning with its synonyms.
    expect(splitMeanings(card.translation)).toEqual([['стол', 'столик']]);
  });
});

describe('restoring old backups', () => {
  it('imports a v1 backup file into the current database', async () => {
    const { db } = await import('./schema');
    const { importBackup } = await import('./backup');
    const file = {
      app: 'deutsch',
      version: 1,
      exportedAt: '2026-10-27T10:00:00Z',
      folders: [{ id: 1, name: 'School', createdAt: 1 }],
      sets: [{ id: 1, name: 'Möbel', folderId: 1, createdAt: 1 }],
      cards: [{ ...v1Card, id: 1 }],
      reviews: [{ cardId: 1, due: 0, fsrs: JSON.parse(JSON.stringify(fsrs)), mistakes: 2, lastWrong: 0 }],
      settings: [v1Settings],
    };
    await importBackup(JSON.stringify(file), 'replace');
    expect(await db.cards.get(1)).toMatchObject({ term: 'Tisch', known: 0, presetId: '' });
    expect(await db.sets.get(1)).toMatchObject({ level: '', topic: '' });
    expect((await db.reviews.get(1))?.fsrs.due).toBeInstanceOf(Date);
  });

  it('imports a v2 backup made before preps, and round-trips preps', async () => {
    const { db } = await import('./schema');
    const { exportBackup, importBackup } = await import('./backup');
    const card = { ...v1Card, id: 1, known: 1, presetId: '' };
    const file = {
      app: 'deutsch',
      version: 2,
      exportedAt: '2026-10-28T10:00:00Z',
      folders: [{ id: 1, name: 'School', level: '', createdAt: 1 }],
      sets: [{ id: 1, name: 'Möbel', folderId: 1, level: '', topic: '', createdAt: 1 }],
      cards: [card, { ...card, id: 2, term: 'sich freuen', preps: ' auf + Akk ' }, { ...card, id: 3, term: 'warten', preps: 42 }],
      reviews: [],
      settings: [],
    };
    await importBackup(JSON.stringify(file), 'replace');
    expect(await db.cards.get(1)).toEqual(card);
    expect(await db.cards.get(2)).toEqual({ ...card, id: 2, term: 'sich freuen', preps: 'auf + Akk' });
    // A value that isn't text is dropped, the rest of the card kept.
    expect(await db.cards.get(3)).toEqual({ ...card, id: 3, term: 'warten' });

    const text = await (await exportBackup()).text();
    await importBackup(text, 'merge');
    const copies = (await db.cards.toArray()).filter((c) => c.id! > 3);
    expect(copies.map((c) => [c.term, c.preps])).toEqual([
      ['Tisch', undefined],
      ['sich freuen', 'auf + Akk'],
      ['warten', undefined],
    ]);
  });
});
