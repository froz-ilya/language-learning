import { db } from '../db/schema';
import { canonicalName } from '../i18n.svelte';
import { saveSettings, settings } from '../settings.svelte';
import type { Card, Lang, Review, WordSet } from '../types';
import { fetchLevelFile, fetchLevelIndex, movedFolder, removeEmptySets, topicsInOrder, wordToCard } from './install';
import { LEVELS, type LevelCode, type LevelFile, type LevelWord } from './types';

export const MOVED_FOLDER = canonicalName('movedFolder');

/**
 * Bring installed levels up to today's lists when those changed (index.json `version`), once and
 * as one step, so a level never ends up half converted. Runs at launch. Word ids never change, so
 * each card is found again by its presetId, and only its set changes: progress hangs on the card.
 *
 * - The word's level is installed: the card goes to the right topic set there.
 * - It isn't: a card holding anything of the user's waits in the plain "moved" folder until that
 *   level is installed; an untouched one is removed, installing the level brings it back.
 * - Cards the user put into their own sets stay there. New words of installed levels are added.
 * - Today's focus on a topic set that is gone moves to its level.
 *
 * Returns whether anything was synced. Without the network, or if a write fails, nothing has
 * changed and it retries next launch.
 */
export async function syncLevels(lang: Lang): Promise<boolean> {
  const installed = (await db.folders.toArray()).filter((f) => f.level);
  if (!installed.length) return false;
  let version: number;
  let files: LevelFile[];
  try {
    version = (await fetchLevelIndex()).version;
    if (installed.every((f) => (f.dataVersion ?? 1) >= version)) return false;
    files = await Promise.all(LEVELS.map(fetchLevelFile));
  } catch (e) {
    console.warn('level sync postponed', e);
    return false;
  }
  // Right after a release the cache may still serve the previous files: it renews them meanwhile.
  if (files.some((f) => (f.version ?? 1) !== version)) return false;
  try {
    const focused = /^set\/(\d+)$/.exec(settings.focus)?.[1];
    const focusedSet = focused ? await db.sets.get(Number(focused)) : undefined;
    await db.transaction('rw', [db.folders, db.sets, db.cards, db.reviews], async () => {
      await applyLists(files, version, lang);
    });
    if (focusedSet?.level && !(await db.sets.get(focusedSet.id!))) {
      settings.focus = `level/${focusedSet.level}`;
      await saveSettings();
    }
    return true;
  } catch (e) {
    console.error('level sync failed', e);
    return false;
  }
}

/** Does the card hold anything that reinstalling the level wouldn't give back? */
function isUsers(card: Card, word: LevelWord, reviewed: Set<number>): boolean {
  const original = [word.tr.ru, word.tr.en].includes(card.translation);
  return reviewed.has(card.id!) || !!card.known || !!card.starred || !!card.notes || !!card.preps || !original || card.examples.length > 1;
}

async function applyLists(files: LevelFile[], version: number, lang: Lang) {
  const folders = (await db.folders.toArray()).filter((f) => f.level);
  const sets = await db.sets.toArray();
  const levelSets = sets.filter((s) => folders.some((f) => f.id === s.folderId));

  // Where each word belongs: its level, and its topic set when that level is installed.
  const home = new Map<string, { word: LevelWord; level: LevelCode; setId?: number }>();
  for (const file of files) {
    const folderId = folders.find((f) => f.level === file.level)?.id;
    const setIds = new Map<string, number>();
    for (const s of levelSets) if (s.folderId === folderId && s.topic && !setIds.has(s.topic)) setIds.set(s.topic, s.id!);
    if (folderId !== undefined) {
      const now = Date.now();
      for (const [i, topic] of topicsInOrder(file.words).entries()) {
        if (setIds.has(topic)) continue;
        setIds.set(topic, (await db.sets.add({ name: topic, folderId, level: file.level, topic, createdAt: now + i })) as number);
      }
    }
    for (const word of file.words) home.set(word.id, { word, level: file.level, setId: setIds.get(word.topic) });
  }

  let movedId = (await movedFolder())?.id;
  const movedSets = sets.filter((s) => s.folderId === movedId);
  const inLevel = new Set(levelSets.map((s) => s.id));
  const inMoved = new Set(movedSets.map((s) => s.id));
  const reviewed = new Set((await db.reviews.toCollection().primaryKeys()) as Review['cardId'][]);
  const cards = await db.cards.where('presetId').above('').toArray();

  const updates: { key: number; changes: Partial<Card> }[] = [];
  const removed: number[] = [];
  for (const card of cards) {
    const place = home.get(card.presetId);
    if (!place || !(inLevel.has(card.setId) || inMoved.has(card.setId))) continue;
    if (place.setId !== undefined) {
      if (place.setId !== card.setId) updates.push({ key: card.id!, changes: { setId: place.setId } });
    } else if (inLevel.has(card.setId)) {
      if (isUsers(card, place.word, reviewed)) {
        movedId ??= (await db.folders.add({ name: MOVED_FOLDER, level: '', createdAt: Date.now(), role: 'moved' })) as number;
        updates.push({ key: card.id!, changes: { setId: await movedSet(movedId, place.level, movedSets) } });
      } else {
        removed.push(card.id!);
      }
    }
  }
  await db.cards.bulkUpdate(updates);
  await db.cards.bulkDelete(removed);

  const present = new Set(cards.map((c) => c.presetId));
  const fresh = [...home.values()].filter((p) => p.setId !== undefined && !present.has(p.word.id));
  const now = Date.now();
  await db.cards.bulkAdd(fresh.map((p, i) => wordToCard(p.word, p.setId!, lang, now + i)));

  await removeEmptySets([...levelSets.filter((s) => s.topic), ...movedSets]);
  if (movedId !== undefined && !(await db.sets.where('folderId').equals(movedId).count())) await db.folders.delete(movedId);
  for (const f of folders) await db.folders.update(f.id!, { dataVersion: version });
}

/** The set of the "moved" folder for a level ("B2 words"); `topic` holds the level. */
async function movedSet(folderId: number, level: LevelCode, sets: WordSet[]): Promise<number> {
  const found = sets.find((s) => s.topic === level);
  if (found) return found.id!;
  const set: WordSet = { name: canonicalName(`moved:${level}`), folderId, level: '', topic: level, createdAt: Date.now() };
  set.id = (await db.sets.add(set)) as number;
  sets.push(set);
  return set.id;
}
