import { db } from '../db/schema';
import { cardsInFolder, cardsInSet, levelFolder } from '../db/repo';
import type { Card, Review } from '../types';
import { HARD_MISSES, isHard } from '../progress';

/**
 * A study "source" is what you learn from:
 *   set/<id>, folder/<id>, level/<A1…C2> (installed level), or smart/<due|new|starred|mistakes|hard|all|today>.
 * Routes: #/learn/<kind>/<id> (smart session), #/modes/<kind>/<id> (pick a single mode)
 * and #/study/<kind>/<id>/<mode>.
 */
export type SourceKind = 'set' | 'folder' | 'level' | 'smart';
export type SmartId = 'today' | 'due' | 'new' | 'starred' | 'mistakes' | 'hard' | 'all';

export const SMART_LABELS: Record<SmartId, string> = {
  today: 'Today',
  due: 'Due today',
  new: 'New words',
  starred: 'Starred',
  mistakes: 'Mistakes',
  hard: 'Hard words',
  all: 'All words',
};

/** Cards answered wrong within this window count as "Mistakes". */
const MISTAKE_WINDOW_MS = 14 * 24 * 3600 * 1000;

function endOfToday(): number {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

async function dueCardIds(): Promise<number[]> {
  return (await db.reviews.where('due').belowOrEqual(endOfToday()).primaryKeys()) as number[];
}

async function reviewedIds(): Promise<Set<number>> {
  return new Set((await db.reviews.toCollection().primaryKeys()) as number[]);
}

async function mistakeIds(): Promise<number[]> {
  return (await db.reviews.where('lastWrong').above(Date.now() - MISTAKE_WINDOW_MS).primaryKeys()) as number[];
}

/** Hard words (see isHard), most-missed first. */
export async function hardCards(): Promise<{ card: Card; review: Review }[]> {
  const reviews = await db.reviews.filter((r) => r.mistakes >= HARD_MISSES).toArray();
  const cards = await db.cards.bulkGet(reviews.map((r) => r.cardId));
  return reviews
    .map((review, i) => ({ card: cards[i]!, review }))
    .filter(({ card, review }) => card && isHard(card, review))
    .sort((a, b) => b.review.mistakes - a.review.mistakes);
}

/** User-made words only (not level presets) — the default pool of new words. */
function ownCards() {
  return db.cards.filter((c) => !c.presetId).toArray();
}

/**
 * Cards for a smart source. "today" = everything due + the focus source (settings.focus,
 * e.g. "level/A1"; own sets when empty) — the smart session picks new words from it.
 */
export async function smartCards(id: SmartId, focus = ''): Promise<Card[]> {
  switch (id) {
    case 'today': {
      const due = await smartCards('due');
      const [kind, fid] = focus.split('/') as [SourceKind, string];
      const pool = focus && kind !== 'smart' ? await cardsForSource(kind, fid) : await ownCards();
      const seen = new Set(due.map((c) => c.id));
      return [...due, ...pool.filter((c) => !seen.has(c.id))];
    }
    case 'due':
      return (await db.cards.bulkGet(await dueCardIds())).filter((c): c is Card => !!c);
    case 'new': {
      const seen = await reviewedIds();
      return db.cards.filter((c) => !seen.has(c.id!) && !c.known && !c.presetId).toArray();
    }
    case 'starred':
      return db.cards.where('starred').equals(1).toArray();
    case 'mistakes':
      return (await db.cards.bulkGet(await mistakeIds())).filter((c): c is Card => !!c);
    case 'hard':
      return (await hardCards()).map((h) => h.card);
    case 'all':
      return db.cards.toArray();
  }
}

/** Counts for Today/Home. "new" counts own (non-preset), not-known words never studied. */
export async function smartCounts(): Promise<Record<SmartId, number>> {
  const [due, seen, starred, mistakes, all, hard] = await Promise.all([
    dueCardIds(),
    reviewedIds(),
    db.cards.where('starred').equals(1).count(),
    mistakeIds(),
    db.cards.count(),
    hardCards(),
  ]);
  const fresh = await db.cards.filter((c) => !seen.has(c.id!) && !c.known && !c.presetId).count();
  return {
    today: due.length + fresh,
    due: due.length,
    new: fresh,
    starred,
    mistakes: mistakes.length,
    hard: hard.length,
    all,
  };
}

export async function cardsForSource(kind: SourceKind, id: string, focus = ''): Promise<Card[]> {
  if (kind === 'set') return cardsInSet(Number(id));
  if (kind === 'folder') return cardsInFolder(Number(id));
  if (kind === 'level') {
    const folder = await levelFolder(id);
    return folder ? cardsInFolder(folder.id!) : [];
  }
  return smartCards(id as SmartId, focus);
}

export async function sourceTitle(kind: SourceKind, id: string): Promise<string> {
  if (kind === 'set') return (await db.sets.get(Number(id)))?.name ?? 'Set';
  if (kind === 'folder') return (await db.folders.get(Number(id)))?.name ?? 'Folder';
  if (kind === 'level') return `Level ${id}`;
  return SMART_LABELS[id as SmartId] ?? 'Study';
}
