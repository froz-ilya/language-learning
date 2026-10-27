import { db } from './schema';
import type { Card, Folder, Review, WordSet } from '../types';

/** Everything a delete removed or changed, so an "Undo" toast can put it back. */
export interface Snapshot {
  folders: Folder[];
  sets: WordSet[];
  cards: Card[];
  reviews: Review[];
}

export function restoreSnapshot(s: Snapshot) {
  return db.transaction('rw', [db.folders, db.sets, db.cards, db.reviews], async () => {
    await db.folders.bulkPut(s.folders);
    await db.sets.bulkPut(s.sets);
    await db.cards.bulkPut(s.cards);
    await db.reviews.bulkPut(s.reviews);
  });
}

export function emptyCard(setId: number): Card {
  return {
    setId,
    term: '',
    translation: '',
    pos: 'other',
    genders: [],
    plural: '',
    praeteritum: '',
    partizip2: '',
    auxiliary: '',
    examples: [],
    notes: '',
    starred: 0,
    needsFill: 0,
    known: 0,
    presetId: '',
    createdAt: Date.now(),
  };
}

// Folders

export function addFolder(name: string): Promise<number> {
  return db.folders.add({ name: name.trim(), level: '', createdAt: Date.now() }) as Promise<number>;
}

export function renameFolder(id: number, name: string) {
  return db.folders.update(id, { name: name.trim() });
}

/** Deleting a folder keeps its sets: they become unfiled. Returns an undo snapshot. */
export function deleteFolder(id: number): Promise<Snapshot> {
  return db.transaction('rw', db.folders, db.sets, async () => {
    const folder = await db.folders.get(id);
    const sets = await db.sets.where('folderId').equals(id).toArray();
    await db.sets.where('folderId').equals(id).modify({ folderId: 0 });
    await db.folders.delete(id);
    return { folders: folder ? [folder] : [], sets, cards: [], reviews: [] };
  });
}

// Sets

export function addSet(name: string, folderId = 0): Promise<number> {
  return db.sets.add({ name: name.trim(), folderId, level: '', topic: '', createdAt: Date.now() }) as Promise<number>;
}

export function updateSet(id: number, changes: Partial<WordSet>) {
  return db.sets.update(id, changes);
}

/** Deletes the set with its words and progress. Returns an undo snapshot. */
export function deleteSet(id: number): Promise<Snapshot> {
  return db.transaction('rw', db.sets, db.cards, db.reviews, async () => {
    const set = await db.sets.get(id);
    const cards = await db.cards.where('setId').equals(id).toArray();
    const ids = cards.map((c) => c.id!);
    const reviews = (await db.reviews.bulkGet(ids)).filter((r): r is Review => !!r);
    await db.reviews.bulkDelete(ids);
    await db.cards.bulkDelete(ids);
    await db.sets.delete(id);
    return { folders: [], sets: set ? [set] : [], cards, reviews };
  });
}

// Cards

export async function saveCard(card: Card): Promise<number> {
  const clean: Card = {
    ...card,
    term: card.term.trim(),
    translation: card.translation.trim(),
    examples: card.examples.filter((e) => e.de.trim()),
  };
  return (await db.cards.put(clean)) as number;
}

/** Deletes a word and its progress. Returns an undo snapshot. */
export function deleteCard(id: number): Promise<Snapshot> {
  return db.transaction('rw', db.cards, db.reviews, async () => {
    const card = await db.cards.get(id);
    const review = await db.reviews.get(id);
    await db.reviews.delete(id);
    await db.cards.delete(id);
    return { folders: [], sets: [], cards: card ? [card] : [], reviews: review ? [review] : [] };
  });
}

export function toggleStar(card: Card) {
  return db.cards.update(card.id!, { starred: card.starred ? 0 : 1 });
}

export async function addCards(cards: Card[]): Promise<void> {
  await db.cards.bulkAdd(cards);
}

// Queries

export function cardsInSet(setId: number) {
  return db.cards.where('setId').equals(setId).toArray();
}

export async function cardsInFolder(folderId: number) {
  const setIds = (await db.sets.where('folderId').equals(folderId).primaryKeys()) as number[];
  return db.cards.where('setId').anyOf(setIds).toArray();
}

export function setsInFolder(folderId: number): Promise<WordSet[]> {
  return db.sets.where('folderId').equals(folderId).sortBy('name');
}

/** User folders only (level preset folders are shown on the Levels tab). */
export async function allFolders(): Promise<Folder[]> {
  return (await db.folders.orderBy('name').toArray()).filter((f) => !f.level);
}

/** Folder of an installed level, if any. */
export function levelFolder(code: string): Promise<Folder | undefined> {
  return db.folders.where('level').equals(code).first();
}

/** Number of cards per set id. */
export async function cardCounts(): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  await db.cards.each((c) => counts.set(c.setId, (counts.get(c.setId) ?? 0) + 1));
  return counts;
}
