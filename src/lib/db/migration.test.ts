// Data saved by older app versions must open and work in the current one (see CLAUDE.md).
// Each test builds a database exactly as an old version stored it, then opens it with today's code.
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
afterEach(() => vi.unstubAllGlobals());

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

describe('levels that changed lists (index version 2)', () => {
  const tr = (term: string) => ({ ru: `ru-${term}`, en: `en-${term}` });
  /** A word of the new lists; its id is the one it was installed with. */
  const word = (id: string, topic: string) => {
    const term = id.split(':')[1];
    return { id, term, pos: 'noun', genders: ['f'], plural: '', praeteritum: '', partizip2: '', auxiliary: '', tr: tr(term), topic, rank: 1 };
  };
  const LISTS: Record<string, unknown[]> = {
    A1: [word('A1:Haus', 'Wohnen'), word('C1:Koffer', 'Reisen'), word('A1:Abfahrt', 'Reisen')],
    A2: [word('A1:Monat', 'Zeit')],
    B1: [],
    B2: [word('A1:Waffe', 'Gesellschaft'), word('A1:Kerl', 'Gesellschaft'), word('A1:Blut', 'Gesellschaft'), word('A1:Schatz', 'Gesellschaft')],
    C1: [],
    C2: [],
  };
  /** Serves the lists; `files` as a version that isn't the index's models a stale cached copy. */
  function serve({ index = 2, files = 2, offline = false } = {}) {
    vi.stubGlobal('fetch', async (url: string) => {
      if (offline) throw new TypeError('Failed to fetch');
      const code = url.match(/levels\/(\w+)\.json$/)?.[1] ?? '';
      const body = code === 'index' ? { version: index, sources: '', levels: [] } : { level: code, version: files, words: LISTS[code] };
      return { ok: true, status: 200, json: async () => body };
    });
  }
  const oldCard = (setId: number, id: string, extra = {}) => {
    const term = id.split(':')[1];
    const { id: _saved, ...card } = v1Card as typeof v1Card & { id?: number }; // add() writes the id into v1Card
    return { ...card, setId, term, translation: `ru-${term}`, examples: [], notes: '', starred: 0, known: 0, presetId: id, ...extra };
  };

  /** A v6 database: A1 installed from the frequency lists, partly studied, A2 installed too. */
  async function seedV6(levels = ['A1', 'A2']) {
    const d = oldDb(6, V5);
    await d.table('folders').add({ name: 'A1 · Beginner', level: 'A1', createdAt: 1 }); // id 1
    await d.table('sets').add({ name: 'Wohnen', folderId: 1, level: 'A1', topic: 'Wohnen', createdAt: 1 }); // id 1
    await d.table('sets').add({ name: 'Funktionswörter 3', folderId: 1, level: 'A1', topic: 'Funktionswörter 3', createdAt: 2 }); // id 2
    await d.table('folders').add({ name: 'School', level: '', createdAt: 1 }); // id 2
    await d.table('sets').add({ name: 'Mine', folderId: 2, level: '', topic: '', createdAt: 3 }); // id 3
    if (levels.includes('A2')) {
      await d.table('folders').add({ name: 'A2 · Elementary', level: 'A2', createdAt: 1 }); // id 3
      await d.table('sets').add({ name: 'Natur', folderId: 3, level: 'A2', topic: 'Natur', createdAt: 4 }); // id 4
    }
    await d.table('cards').bulkAdd([
      oldCard(1, 'A1:Haus'), // stays
      oldCard(2, 'A1:Waffe'), // → B2, studied
      oldCard(2, 'A1:Kerl'), // → B2, untouched
      oldCard(2, 'A1:Blut', { starred: 1 }), // → B2, starred
      oldCard(2, 'A1:Schatz', { translation: 'my own words' }), // → B2, edited
      oldCard(2, 'A1:Monat'), // → A2, studied
      oldCard(3, 'B1:Abfahrt2', { presetId: 'A1:Abfahrt' }), // the user keeps this one in their own set
      { ...oldCard(2, 'A1:Eigen'), presetId: '' }, // a user word in a level set
    ]);
    const review = (cardId: number) => ({ cardId, due: fsrs.due.getTime(), fsrs, mistakes: 2, lastWrong: 5 });
    await d.table('reviews').bulkPut([review(1), review(2), review(6)]);
    await d.table('settings').put(v1Settings);
    d.close();
  }

  async function sync() {
    const { syncLevels } = await import('../levels/sync');
    const { db } = await import('./schema');
    return { synced: await syncLevels('ru'), db };
  }
  const setOf = async (db: Dexie, presetId: string) => {
    const card = await db.table('cards').where('presetId').equals(presetId).first();
    return card && (await db.table('sets').get(card.setId));
  };

  it('moves words to their new level and keeps every bit of progress', async () => {
    await seedV6();
    serve();
    const { synced, db } = await sync();
    expect(synced).toBe(true);
    expect(await setOf(db, 'A1:Haus')).toMatchObject({ name: 'Wohnen', folderId: 1 });
    // Moved between installed levels: same card, same review.
    expect(await setOf(db, 'A1:Monat')).toMatchObject({ topic: 'Zeit', folderId: 3 });
    expect(await db.table('cards').get(6)).toMatchObject({ presetId: 'A1:Monat' });
    expect(await db.table('reviews').count()).toBe(3);
    // New words of the lists arrive, also ones that were in a level not installed before.
    expect(await setOf(db, 'C1:Koffer')).toMatchObject({ topic: 'Reisen', folderId: 1 });
    expect(await db.table('cards').where('presetId').equals('C1:Koffer').first()).toMatchObject({ translation: 'ru-Koffer' });
    // The user's own words and set stay put, and no duplicate is added for their card.
    expect(await db.table('cards').where('term').equals('Eigen').first()).toMatchObject({ setId: 2 });
    expect(await db.table('cards').where('presetId').equals('A1:Abfahrt').toArray()).toMatchObject([{ setId: 3 }]);
    expect(await db.table('folders').get(1)).toMatchObject({ dataVersion: 2 });
    expect(await db.table('folders').get(3)).toMatchObject({ dataVersion: 2 });
  });

  it('keeps what the user made of a word whose level isn’t installed, in a visible folder', async () => {
    await seedV6();
    serve();
    const { db } = await sync();
    for (const id of ['A1:Waffe', 'A1:Blut', 'A1:Schatz']) {
      expect(await setOf(db, id)).toMatchObject({ name: 'B2 words', level: '', topic: 'B2' });
    }
    expect(await db.table('reviews').get(2)).toMatchObject({ mistakes: 2 });
    expect(await db.table('cards').where('presetId').equals('A1:Schatz').first()).toMatchObject({ translation: 'my own words' });
    const folder = await db.table('folders').filter((f) => f.role === 'moved').first();
    expect(folder).toMatchObject({ name: 'Moved from levels', level: '' });
    // A card nobody touched is only a copy of the list: it comes back with B2.
    expect(await db.table('cards').where('presetId').equals('A1:Kerl').count()).toBe(0);
  });

  it('removes level sets left empty, but keeps one that still holds the user’s word', async () => {
    await seedV6();
    serve();
    const { db } = await sync();
    expect(await db.table('sets').get(1)).toBeTruthy();
    expect(await db.table('sets').get(2)).toBeTruthy(); // "Eigen" is still there
    expect(await db.table('sets').get(4)).toBeUndefined(); // A2's old "Natur" had no words left
  });

  it('moves Today’s focus to the level when its topic set is gone', async () => {
    await seedV6();
    const d = oldDb(6, V5);
    await d.table('settings').update('main', { focus: 'set/4' }); // A2's "Natur", emptied below
    d.close();
    serve();
    const { loadSettings, settings } = await import('../settings.svelte');
    await loadSettings();
    const { db } = await sync();
    expect(settings.focus).toBe('level/A2');
    expect(await db.settings.get('main')).toMatchObject({ focus: 'level/A2' });
  });

  it('leaves a focus on a set that is still there', async () => {
    await seedV6();
    const d = oldDb(6, V5);
    await d.table('settings').update('main', { focus: 'set/1' });
    d.close();
    serve();
    const { loadSettings, settings } = await import('../settings.svelte');
    await loadSettings();
    await sync();
    expect(settings.focus).toBe('set/1');
  });

  it('brings moved words home with their progress when the level is installed', async () => {
    await seedV6();
    serve();
    const { db } = await sync();
    const { installLevel, movedFolder } = await import('../levels/install');
    await installLevel('B2', 'ru');
    expect(await setOf(db, 'A1:Waffe')).toMatchObject({ level: 'B2', topic: 'Gesellschaft' });
    expect(await db.table('cards').where('presetId').equals('A1:Waffe').first()).toMatchObject({ id: 2 });
    expect(await db.table('reviews').get(2)).toBeTruthy();
    expect(await db.table('cards').where('presetId').equals('A1:Kerl').count()).toBe(1);
    expect(await db.table('cards').where('presetId').equals('A1:Waffe').count()).toBe(1);
    expect(await movedFolder()).toBeUndefined();
    expect(await db.table('sets').where('name').equals('B2 words').count()).toBe(0);
  });

  it('runs once: a second launch changes nothing', async () => {
    await seedV6();
    serve();
    const { db } = await sync();
    const before = await db.table('cards').toArray();
    const { syncLevels } = await import('../levels/sync');
    expect(await syncLevels('ru')).toBe(false);
    expect(await db.table('cards').toArray()).toEqual(before);
  });

  it('waits while offline or while the cache still serves the old files', async () => {
    await seedV6();
    serve({ offline: true });
    const { synced, db } = await sync();
    expect(synced).toBe(false);
    serve({ files: 1 });
    const { syncLevels } = await import('../levels/sync');
    expect(await syncLevels('ru')).toBe(false);
    expect(await db.table('cards').count()).toBe(8);
    expect(await db.table('folders').get(1)).not.toHaveProperty('dataVersion');
    // Once the cache has the new files, it happens after all.
    serve();
    expect(await syncLevels('ru')).toBe(true);
  });

  it('is all or nothing: a write failing halfway leaves the old levels, and the next launch redoes it', async () => {
    await seedV6();
    serve();
    const { syncLevels } = await import('../levels/sync');
    const { db } = await import('./schema');
    const before = await db.cards.toArray();
    const setsBefore = await db.sets.count();
    const bulkDelete = vi.spyOn(db.cards, 'bulkDelete').mockRejectedValueOnce(new Error('disk full')); // after cards moved
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await syncLevels('ru')).toBe(false);
    expect(await db.cards.toArray()).toEqual(before);
    expect(await db.sets.count()).toBe(setsBefore);
    expect(await db.folders.filter((f) => f.role === 'moved').count()).toBe(0);
    expect(await db.folders.get(1)).not.toHaveProperty('dataVersion');
    bulkDelete.mockRestore();
    error.mockRestore();
    expect(await syncLevels('ru')).toBe(true);
    expect(await setOf(db, 'A1:Waffe')).toMatchObject({ name: 'B2 words' });
  });

  it('syncs a level restored from an old backup', async () => {
    await seedV6();
    serve();
    const { db } = await sync();
    const { exportBackup, importBackup } = await import('./backup');
    const backup = JSON.parse(await (await exportBackup()).text());
    for (const f of backup.folders) delete f.dataVersion;
    await importBackup(JSON.stringify(backup), 'replace');
    const { syncLevels } = await import('../levels/sync');
    expect(await syncLevels('ru')).toBe(true);
    expect(await setOf(db, 'A1:Waffe')).toMatchObject({ name: 'B2 words' });
    expect(await db.table('reviews').count()).toBe(3);
  });

  it('leaves a database with no levels alone, without any request', async () => {
    await seedV1();
    const fetched = vi.fn();
    vi.stubGlobal('fetch', fetched);
    const { synced } = await sync();
    expect(synced).toBe(false);
    expect(fetched).not.toHaveBeenCalled();
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
