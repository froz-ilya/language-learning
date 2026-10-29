import { db } from './schema';
import type { Card, Folder, Review, Settings, WordSet } from '../types';

interface BackupFile {
  app: 'deutsch';
  version: 1 | 2;
  exportedAt: string;
  folders: Folder[];
  sets: WordSet[];
  cards: Card[];
  reviews: Review[];
  settings: Settings[];
}

export async function exportBackup(): Promise<Blob> {
  const data: BackupFile = {
    app: 'deutsch',
    version: 2,
    exportedAt: new Date().toISOString(),
    folders: await db.folders.toArray(),
    sets: await db.sets.toArray(),
    cards: await db.cards.toArray(),
    reviews: await db.reviews.toArray(),
    settings: await db.settings.toArray(),
  };
  return new Blob([JSON.stringify(data)], { type: 'application/json' });
}

/** What happened to a backup file handed to shareOrDownload(). */
export type ShareResult = 'shared' | 'downloaded' | 'cancelled';

/**
 * Save through the iOS share sheet (→ Files / iCloud Drive), or download as a fallback.
 * Resolves after the share sheet closes: 'shared' when the user picked a target,
 * 'cancelled' when they dismissed it, 'downloaded' when the download fallback ran
 * (no Web Share, or share() failed for another reason).
 */
export async function shareOrDownload(blob: Blob, filename: string): Promise<ShareResult> {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}

function reviveDates(r: Review): Review {
  const f = r.fsrs;
  return {
    ...r,
    fsrs: { ...f, due: new Date(f.due), last_review: f.last_review ? new Date(f.last_review) : undefined },
  };
}

/**
 * A card from any backup version as today's code stores it: v1 cards predate level presets and
 * the "known" flag; cards before `preps` have none (it stays absent; a value that isn't text is
 * dropped).
 */
function normalizeCard(c: Card): Card {
  const { preps, ...rest } = c as Card & { preps?: unknown };
  const out: Card = { ...rest, known: c.known ?? 0, presetId: c.presetId ?? '' };
  if (typeof preps === 'string' && preps.trim()) out.preps = preps.trim();
  return out;
}

/**
 * replace: wipe everything and restore the backup as-is.
 * merge: add the backup's folders/sets/cards next to existing ones (new ids).
 */
export async function importBackup(text: string, mode: 'replace' | 'merge'): Promise<{ cards: number }> {
  const data = JSON.parse(text) as BackupFile;
  if (data.app !== 'deutsch' || !Array.isArray(data.cards)) throw new Error('Not a backup file from this app.');
  // v1 backups predate level presets and the "known" flag.
  data.folders = data.folders.map((f) => ({ ...f, level: f.level ?? '' }));
  data.sets = data.sets.map((s) => ({ ...s, level: s.level ?? '', topic: s.topic ?? '' }));
  data.cards = data.cards.map(normalizeCard);
  const reviews = (data.reviews ?? []).map(reviveDates);

  await db.transaction('rw', [db.folders, db.sets, db.cards, db.reviews, db.settings], async () => {
    if (mode === 'replace') {
      await Promise.all([db.folders.clear(), db.sets.clear(), db.cards.clear(), db.reviews.clear()]);
      await db.folders.bulkPut(data.folders);
      await db.sets.bulkPut(data.sets);
      await db.cards.bulkPut(data.cards);
      await db.reviews.bulkPut(reviews);
      if (data.settings?.length) await db.settings.bulkPut(data.settings);
      return;
    }

    const folderIds = new Map<number, number>();
    for (const { id, ...f } of data.folders) folderIds.set(id!, (await db.folders.add(f)) as number);
    const setIds = new Map<number, number>();
    for (const { id, ...s } of data.sets) {
      setIds.set(id!, (await db.sets.add({ ...s, folderId: folderIds.get(s.folderId) ?? 0 })) as number);
    }
    const reviewByCard = new Map(reviews.map((r) => [r.cardId, r]));
    for (const { id, ...c } of data.cards) {
      const setId = setIds.get(c.setId);
      if (setId === undefined) continue;
      const newId = (await db.cards.add({ ...c, setId })) as number;
      const review = reviewByCard.get(id!);
      if (review) await db.reviews.put({ ...review, cardId: newId });
    }
  });
  return { cards: data.cards.length };
}
