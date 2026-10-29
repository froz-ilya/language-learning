import { db } from '../db/schema';
import { addFolder, addSet, emptyCard, saveCard } from '../db/repo';
import type { Card, Lang, LookupResult } from '../types';
import type { LexEntry } from '../dict/types';
import { isReflexiveTerm } from '../german/reflexive';
import type { LevelCode } from '../levels/types';
import type { Article, SavedArticle } from './types';
import { plainToParagraphs } from './text';

/** Name of the user folder that holds one word set per article. */
export const READING_FOLDER = 'Reading';
const MAX_SET_NAME = 60;
const DAY = 24 * 60 * 60 * 1000;

// ---------- Routes ----------

/** "<source>:<rest>" → "/article/<source>/<encodeURIComponent(rest)>" (the router decodes parts). */
export function articlePath(id: string): string {
  const i = id.indexOf(':');
  return `/article/${id.slice(0, i)}/${encodeURIComponent(id.slice(i + 1))}`;
}

/** Inverse of articlePath, from route.parts (["article", source, rest]). */
export function articleIdFromParts(parts: string[]): string {
  return `${parts[1]}:${parts[2] ?? ''}`;
}

// ---------- Rows ----------

function newRow(article: Article): SavedArticle {
  return {
    id: article.id,
    source: article.source,
    title: article.title,
    // Copy: the reader's article may be a reactive proxy, which IndexedDB can't clone.
    paragraphs: [...article.paragraphs],
    url: article.url,
    license: article.license,
    attribution: article.attribution,
    level: '',
    savedAt: 0,
    readAt: 0,
    setId: 0,
    progress: 0,
    openedAt: 0,
  };
}

/** Create the db.articles row if needed, then apply `changes`. Returns the updated row. */
export function upsertArticle(article: Article, changes: Partial<SavedArticle> = {}): Promise<SavedArticle> {
  return db.transaction('rw', db.articles, async () => {
    const existing = await db.articles.get(article.id);
    const row: SavedArticle = { ...(existing ?? newRow(article)), ...changes };
    // Keep the text with the row so the article, its word set and progress stay linked offline.
    if (!row.paragraphs?.length) row.paragraphs = [...article.paragraphs];
    await db.articles.put(row);
    return row;
  });
}

/** Called when the reader opens an article: stamps openedAt (for "Continue reading"). */
export function trackOpen(article: Article): Promise<SavedArticle> {
  return upsertArticle(article, { openedAt: Date.now() });
}

export async function setLevel(id: string, level: LevelCode | ''): Promise<void> {
  await db.articles.update(id, { level });
}

export async function setProgress(id: string, progress: number): Promise<void> {
  await db.articles.update(id, { progress });
}

/** "Stop reading": forget the position so the article leaves "Continue reading". */
export async function stopReading(id: string): Promise<void> {
  await db.articles.update(id, { progress: 0 });
}

export async function markRead(id: string, read: boolean): Promise<void> {
  await db.articles.update(id, { readAt: read ? Date.now() : 0 });
}

export async function saveForOffline(article: Article): Promise<void> {
  await upsertArticle(article, { savedAt: Date.now(), paragraphs: [...article.paragraphs] });
}

export async function removeFromSaved(id: string): Promise<void> {
  await db.articles.update(id, { savedAt: 0 });
}

export async function deleteArticle(id: string): Promise<void> {
  await db.articles.delete(id);
}

/**
 * Forget rows that were only opened (not saved, not read, no word set) more than `days` ago,
 * so browsing doesn't fill the device with cached texts.
 */
export async function pruneTracked(days = 30): Promise<number> {
  const before = Date.now() - days * DAY;
  return db.articles
    .filter((a) => !a.savedAt && !a.readAt && !a.setId && a.source !== 'paste' && (a.openedAt ?? 0) < before)
    .delete();
}

/** A pasted text becomes a saved 'paste' article. Returns its id. */
export async function createPasted(title: string, text: string): Promise<string> {
  const paragraphs = plainToParagraphs(text);
  const id = `paste:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const now = Date.now();
  await db.articles.add({
    ...newRow({
      id,
      source: 'paste',
      title: title.trim() || paragraphs[0]?.split(/\s+/).slice(0, 6).join(' ') || 'My text',
      paragraphs,
      url: '',
      license: '',
      attribution: 'Your own text',
    }),
    savedAt: now,
  });
  return id;
}

// ---------- The article's word set ----------

export function articleSetName(title: string): string {
  const t = title.trim().replace(/\s+/g, ' ');
  return t.length <= MAX_SET_NAME ? t : `${t.slice(0, MAX_SET_NAME - 1).trimEnd()}…`;
}

/** The user folder "Reading" (created on first use). */
async function readingFolder(): Promise<number> {
  const existing = await db.folders.where('name').equals(READING_FOLDER).filter((f) => !f.level).first();
  return existing?.id ?? addFolder(READING_FOLDER);
}

/**
 * The word set linked to this article; on first use creates it (named after the article, in
 * the "Reading" folder) and stores its id on the article row.
 */
export async function ensureArticleSet(article: Article): Promise<number> {
  const row = await db.articles.get(article.id);
  if (row?.setId && (await db.sets.get(row.setId))) return row.setId;
  const setId = await addSet(articleSetName(article.title), await readingFolder());
  await upsertArticle(article, { setId });
  return setId;
}

/**
 * Card fields from the offline dictionary. Its prepositions go along, except to the plain verb
 * of a verb that is also reflexive: there they are the "sich …" reading's (see lookup.ts).
 */
export function fieldsFromEntry(entry: LexEntry, lang: Lang): Partial<Card> {
  const preps = (entry.preps ?? '').trim();
  const ownPreps = !!preps && (entry.reflexive !== 'also' || isReflexiveTerm(entry.term));
  return {
    term: entry.term,
    pos: entry.pos,
    genders: [...entry.genders],
    plural: entry.plural,
    praeteritum: entry.praeteritum,
    partizip2: entry.partizip2,
    auxiliary: entry.auxiliary,
    translation: entry.tr[lang] ?? '',
    ...(ownPreps ? { preps } : {}),
  };
}

/** Card fields from an online lookup (its own reading: "sich beeilen" keeps its "sich"). */
export function fieldsFromLookup(r: LookupResult): Partial<Card> {
  return {
    term: r.term,
    pos: r.pos,
    genders: [...r.genders],
    plural: r.plural,
    praeteritum: r.praeteritum,
    partizip2: r.partizip2,
    auxiliary: r.auxiliary,
    translation: r.translation,
    examples: r.examples.map((e) => ({ ...e })),
    ...(r.preps ? { preps: r.preps } : {}),
  };
}

/** A card for the article's set; `context` (the sentence it was read in) becomes the first example. */
export function buildCard(setId: number, fields: Partial<Card>, context?: string): Card {
  const card: Card = { ...emptyCard(setId), ...fields, setId };
  // Prepositions are optional: a card without them has none (not an empty field).
  if (!card.preps?.trim()) delete card.preps;
  if (context && !card.examples.some((e) => e.de === context)) card.examples = [{ de: context }, ...card.examples].slice(0, 3);
  card.needsFill = card.translation.trim() ? 0 : 1;
  return card;
}

/**
 * Add a word to the article's set (creating the set on first add). If the set already has a
 * card with this term (case-insensitive), that card is returned instead.
 */
export async function addWordToArticle(
  article: Article,
  fields: Partial<Card> & { term: string },
  context?: string,
): Promise<{ cardId: number; setId: number; created: boolean }> {
  const setId = await ensureArticleSet(article);
  const term = fields.term.trim().toLowerCase();
  const existing = (await db.cards.where('setId').equals(setId).toArray()).find((c) => c.term.toLowerCase() === term);
  if (existing) return { cardId: existing.id!, setId, created: false };
  const cardId = await saveCard(buildCard(setId, fields, context));
  return { cardId, setId, created: true };
}
