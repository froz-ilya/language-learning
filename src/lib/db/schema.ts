import Dexie, { type EntityTable } from 'dexie';
import type { Card, Folder, LookupResult, Review, Settings, WordSet } from '../types';
import type { SavedArticle } from '../reading/types';

export interface LookupCacheEntry {
  /** `${lang}:${word}` */
  key: string;
  result: LookupResult | null;
  fetchedAt: number;
}

export class AppDB extends Dexie {
  folders!: EntityTable<Folder, 'id'>;
  sets!: EntityTable<WordSet, 'id'>;
  cards!: EntityTable<Card, 'id'>;
  reviews!: EntityTable<Review, 'cardId'>;
  lookupCache!: EntityTable<LookupCacheEntry, 'key'>;
  settings!: EntityTable<Settings, 'id'>;
  articles!: EntityTable<SavedArticle, 'id'>;

  constructor() {
    super('deutsch');
    this.version(1).stores({
      folders: '++id, name',
      sets: '++id, folderId, name',
      cards: '++id, setId, term, starred, needsFill, pos',
      reviews: 'cardId, due, lastWrong',
      lookupCache: 'key',
      settings: 'id',
    });
    // v2: level presets + manual "known" status.
    this.version(2)
      .stores({
        folders: '++id, name, level',
        sets: '++id, folderId, name, level',
        cards: '++id, setId, term, starred, needsFill, pos, known, presetId',
      })
      .upgrade(async (tx) => {
        await tx.table('folders').toCollection().modify((f) => {
          f.level ??= '';
        });
        await tx.table('sets').toCollection().modify((s) => {
          s.level ??= '';
          s.topic ??= '';
        });
        await tx.table('cards').toCollection().modify((c) => {
          c.known ??= 0;
          c.presetId ??= '';
        });
      });
    // v3: reading — articles saved for offline / linked to their word set.
    this.version(3).stores({
      articles: 'id, source, savedAt, readAt',
    });
  }
}

export const db = new AppDB();

/** Ask iOS/Safari not to evict our data under storage pressure. */
export async function requestPersistence(): Promise<void> {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch {
    // Not supported; nothing to do.
  }
}
