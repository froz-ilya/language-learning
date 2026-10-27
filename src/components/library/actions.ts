import { go } from '../../lib/router.svelte';
import { dur } from '../../lib/motion';
import { db } from '../../lib/db/schema';
import { addFolder, addSet, cardsInFolder, cardsInSet, deleteSet, levelFolder, type Snapshot } from '../../lib/db/repo';
import { chooseAction, promptText, ui, undoToast } from '../../lib/ui/dialogs.svelte';
import { emptyProgress, progressFor, setKnown, type Progress } from '../../lib/progress';
import { fetchLevelIndex } from '../../lib/levels/install';
import { LEVEL_TITLES, LEVELS, type LevelCode, type LevelIndex } from '../../lib/levels/types';
import type { Card, Review, WordSet } from '../../lib/types';

/** Shared helpers for the library screens (Today, Library, Levels, Folder, Set). */

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Intro delay for list item i: a short stagger, capped to the first ~10 items. */
export const stagger = (i: number, step = 35) => dur(Math.min(i, 10) * step);

/** "12 / 40 learned" or "No words yet". */
export function learnedLine(p: Progress | undefined): string {
  if (!p) return '';
  if (!p.total) return 'No words yet';
  return `${p.done} / ${p.total} learned`;
}

export function sumProgress(list: Progress[]): Progress {
  const p = emptyProgress();
  for (const x of list) {
    p.total += x.total;
    p.new += x.new;
    p.learning += x.learning;
    p.learned += x.learned;
    p.known += x.known;
  }
  p.done = p.learned + p.known;
  p.ratio = p.total ? p.done / p.total : 0;
  return p;
}

/**
 * Run `fn` once the current action sheet has closed — for chooseAction items that open
 * another dialog (prompt, confirm, second sheet), so the two never fight over ui.dialog.
 */
export function afterSheet<T>(fn: () => T | Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const tryStart = () => {
      if (ui.dialog?.kind === 'actions') setTimeout(tryStart, 30);
      else Promise.resolve().then(fn).then(resolve, reject);
    };
    setTimeout(tryStart, 0);
  });
}

/** Ask for a name and create a set. Opens it unless `open` is false. Returns the id. */
export async function createSet(folderId = 0, open = true): Promise<number | null> {
  const name = await promptText({ title: 'New set', placeholder: 'e.g. Food, Travel, Chapter 3', confirmLabel: 'Create' });
  if (!name) return null;
  const id = await addSet(name, folderId);
  if (open) go(`/set/${id}`);
  return id;
}

export async function createFolder(): Promise<number | null> {
  const name = await promptText({ title: 'New folder', placeholder: 'Folder name', confirmLabel: 'Create' });
  if (!name) return null;
  const id = await addFolder(name);
  go(`/folder/${id}`);
  return id;
}

/** Delete a set with an "Undo" toast. */
export async function removeSet(set: Pick<WordSet, 'id' | 'name'>): Promise<void> {
  undoToast(`Deleted “${set.name}”`, await deleteSet(set.id!));
}

/**
 * "+ Add word" from anywhere: straight to the editor when there is one own set, a picker
 * when there are several, and a fresh "My words" set when there are none.
 */
export async function quickAddWord(): Promise<void> {
  const sets = (await db.sets.toArray()).filter((s) => !s.level).sort((a, b) => b.createdAt - a.createdAt);
  if (!sets.length) {
    go('/card/new', { set: await addSet('My words') });
    return;
  }
  if (sets.length === 1) {
    go('/card/new', { set: sets[0].id! });
    return;
  }
  await chooseAction('Add a word to…', [
    ...sets.map((s) => ({ label: s.name, icon: 'cards' as const, run: () => go('/card/new', { set: s.id! }) })),
    {
      label: 'New set…',
      icon: 'plus' as const,
      run: () =>
        void afterSheet(async () => {
          const id = await createSet(0, false);
          if (id) go('/card/new', { set: id });
        }),
    },
  ]);
}

/**
 * Mark words known / not learned, with an "Undo" toast that puts the previous statuses and
 * study progress back.
 */
export async function setKnownWithUndo(ids: number[], known: boolean, message: string): Promise<void> {
  if (!ids.length) return;
  const [cards, reviews] = await Promise.all([db.cards.bulkGet(ids), db.reviews.bulkGet(ids)]);
  const snapshot: Snapshot = {
    folders: [],
    sets: [],
    cards: cards.filter((c): c is Card => !!c),
    reviews: reviews.filter((r): r is Review => !!r),
  };
  await setKnown(ids, known);
  undoToast(message, snapshot);
}

// ---------- Levels ----------

let indexPromise: Promise<LevelIndex | null> | undefined;

/** public/levels/index.json, cached for the session; null when it can't be loaded. */
export function levelIndex(): Promise<LevelIndex | null> {
  indexPromise ??= fetchLevelIndex().catch((e) => {
    console.warn('level index unavailable', e);
    indexPromise = undefined;
    return null;
  });
  return indexPromise;
}

export function isLevel(code: string): code is LevelCode {
  return (LEVELS as string[]).includes(code);
}

export function levelName(code: LevelCode): string {
  return `${code} · ${LEVEL_TITLES[code]}`;
}

/** Progress of an installed level, or null when it isn't installed. */
export async function levelProgress(code: LevelCode): Promise<Progress | null> {
  const folder = await levelFolder(code);
  if (!folder) return null;
  return progressFor(await cardsInFolder(folder.id!));
}

export interface FocusInfo {
  title: string;
  /** "level" | "set" | "folder" */
  kind: string;
  progress: Progress;
  /** Words in the focus that were never studied (and aren't marked known). */
  fresh: number;
}

/** What settings.focus ("level/A1", "set/3", "folder/2") points at, or null if it's gone. */
export async function focusInfo(focus: string): Promise<FocusInfo | null> {
  const [kind, id] = focus.split('/');
  if (!kind || !id) return null;
  let title = '';
  let cards;
  if (kind === 'level' && isLevel(id)) {
    const folder = await levelFolder(id);
    if (!folder) return null;
    title = levelName(id);
    cards = await cardsInFolder(folder.id!);
  } else if (kind === 'set') {
    const set = await db.sets.get(Number(id));
    if (!set) return null;
    title = set.name;
    cards = await cardsInSet(set.id!);
  } else if (kind === 'folder') {
    const folder = await db.folders.get(Number(id));
    if (!folder) return null;
    title = folder.name;
    cards = await cardsInFolder(folder.id!);
  } else return null;
  const progress = await progressFor(cards);
  return { title, kind, progress, fresh: progress.new };
}
