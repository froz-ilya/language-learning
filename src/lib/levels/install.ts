import { db } from '../db/schema';
import { emptyCard, levelFolder } from '../db/repo';
import type { Card, Lang } from '../types';
import { LEVEL_TITLES, type LevelCode, type LevelFile, type LevelIndex, type LevelWord } from './types';

const CHUNK = 200;

function levelUrl(file: string): string {
  return `${import.meta.env.BASE_URL}levels/${file}`;
}

async function getJson<T>(file: string): Promise<T> {
  const res = await fetch(levelUrl(file));
  if (!res.ok) throw new Error(`Could not load ${file} (${res.status})`);
  return (await res.json()) as T;
}

/** Fetch public/levels/index.json (works offline once cached). */
export function fetchLevelIndex(): Promise<LevelIndex> {
  return getJson<LevelIndex>('index.json');
}

/** Folder name shown in the library, e.g. "A1 · Beginner". */
export function levelFolderName(code: LevelCode): string {
  return `${code} · ${LEVEL_TITLES[code]}`;
}

/** Turn a preset word into a card for the given set, translated into `lang`. */
export function wordToCard(word: LevelWord, setId: number, lang: Lang, now = Date.now()): Card {
  const ex = word.example;
  return {
    ...emptyCard(setId),
    term: word.term,
    translation: word.tr[lang] || word.tr.en || word.tr.ru || '',
    pos: word.pos,
    genders: [...word.genders],
    plural: word.plural,
    praeteritum: word.praeteritum,
    partizip2: word.partizip2,
    auxiliary: word.auxiliary,
    examples: ex?.de ? [{ de: ex.de, tr: ex[lang] || ex.en || ex.ru || '' }] : [],
    presetId: word.id,
    known: 0,
    needsFill: 0,
    createdAt: now,
  };
}

/** Topic names in order of first appearance. */
export function topicsInOrder(words: LevelWord[]): string[] {
  const seen = new Set<string>();
  for (const w of words) seen.add(w.topic);
  return [...seen];
}

/**
 * Install a level into the library: a folder with `level = code`, one set per topic
 * (`level`, `topic` set), cards with `presetId`, translations in `lang`.
 * Idempotent: words whose presetId already exists are skipped. Returns the folder id.
 */
export async function installLevel(
  code: LevelCode,
  lang: Lang,
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const file = await getJson<LevelFile>(`${code}.json`);
  const words = file.words ?? [];

  const { folderId, setIds } = await db.transaction('rw', db.folders, db.sets, async () => {
    const now = Date.now();
    const existing = await levelFolder(code);
    const folderId =
      existing?.id ?? ((await db.folders.add({ name: levelFolderName(code), level: code, createdAt: now })) as number);
    const sets = await db.sets.where('folderId').equals(folderId).toArray();
    const setIds = new Map<string, number>();
    for (const s of sets) if (s.topic && !setIds.has(s.topic)) setIds.set(s.topic, s.id!);
    let i = 0;
    for (const topic of topicsInOrder(words)) {
      if (setIds.has(topic)) continue;
      // createdAt increases with topic order so sets sorted by creation keep the file order.
      const id = (await db.sets.add({ name: topic, folderId, level: code, topic, createdAt: now + i++ })) as number;
      setIds.set(topic, id);
    }
    return { folderId, setIds };
  });

  const ids = words.map((w) => w.id);
  const present = new Set<string>();
  for (let i = 0; i < ids.length; i += 500) {
    const rows = await db.cards.where('presetId').anyOf(ids.slice(i, i + 500)).toArray();
    for (const c of rows) present.add(c.presetId);
  }
  const todo = words.filter((w) => !present.has(w.id));
  const total = todo.length;
  onProgress?.(0, total);

  const now = Date.now();
  for (let i = 0; i < todo.length; i += CHUNK) {
    const cards = todo.slice(i, i + CHUNK).map((w, j) => wordToCard(w, setIds.get(w.topic)!, lang, now + i + j));
    await db.transaction('rw', db.cards, async () => {
      await db.cards.bulkAdd(cards);
    });
    onProgress?.(Math.min(i + CHUNK, total), total);
  }
  return folderId;
}

/** Remove an installed level with all its words and progress. */
export async function uninstallLevel(code: LevelCode): Promise<void> {
  await db.transaction('rw', [db.folders, db.sets, db.cards, db.reviews], async () => {
    const folders = await db.folders.where('level').equals(code).toArray();
    for (const folder of folders) {
      const setIds = (await db.sets.where('folderId').equals(folder.id!).primaryKeys()) as number[];
      const cardIds = (await db.cards.where('setId').anyOf(setIds).primaryKeys()) as number[];
      await db.reviews.bulkDelete(cardIds);
      await db.cards.bulkDelete(cardIds);
      await db.sets.bulkDelete(setIds);
      await db.folders.delete(folder.id!);
    }
  });
}
