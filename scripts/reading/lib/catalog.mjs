// @ts-nocheck
// Builds the Klexikon/MiniKlexikon level catalog from downloaded pages (pure apart from the
// rating, which comes from the app's own modules: see shared.mjs). Used by klexikon.mjs and
// by the app's tests (src/lib/reading/catalog.test.ts), so both rate the same way.

export const CATALOG_VERSION = 1;
/** Articles with fewer words are stubs: too short to rate or to be worth reading. */
export const MIN_WORDS = 40;
const LEVEL_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const SKIP_TITLES = new Set(['Hauptseite']);
/** Navigation pages in the main namespace: link lists, not texts. */
const SKIP_TITLE_RE = /^(?:Artikelübersicht\b|(?:Mini)?Klexikon:)/;

/**
 * One catalog row for a page, or null when it can't be rated.
 * `shared` = { wikitextToParagraphs, rateParagraphs, countWords, isHeading } (the app's modules).
 */
export async function rateArticle(page, shared) {
  if (SKIP_TITLES.has(page.title) || SKIP_TITLE_RE.test(page.title)) return null;
  const paragraphs = shared.wikitextToParagraphs(page.wikitext);
  const body = paragraphs.filter((p) => !shared.isHeading(p));
  const words = body.reduce((n, p) => n + shared.countWords(p), 0);
  if (words < MIN_WORDS) return null;
  const level = await shared.rateParagraphs(paragraphs, page.title);
  if (!level) return null;
  return { title: page.title, level, words };
}

/** Rows (Map title → { level, words }) → { [level]: [title, words][] }, sorted by title. */
export function sourcesFromRows(rows) {
  const byLevel = {};
  for (const [title, { level, words }] of rows) (byLevel[level] ??= []).push([title, words]);
  const sorted = {};
  for (const l of LEVEL_ORDER) {
    if (!byLevel[l]) continue;
    sorted[l] = byLevel[l].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  }
  return sorted;
}

/**
 * { version, generated, license, sync?, sources: { [sourceId]: { [level]: [title, words][] } } }
 * Rows are sorted by title so rebuilds give small diffs. No snippets: they would quadruple the
 * file (≈390 KB instead of ≈95 KB for ~5,000 articles).
 *
 * `only[sourceId]` (Map title → row, the committed catalog): rebuild just these articles —
 * re-rated where the page text is at hand, kept as they are otherwise (pages added by an
 * incremental update elsewhere). Pages deleted on the site since the cache was made stay out.
 * `stats.kept` counts the rows kept without text.
 */
export async function buildCatalog(pagesBySource, shared, { generated = '', sync, only, stats = {} } = {}) {
  const sources = {};
  stats.kept = 0;
  for (const [id, pages] of Object.entries(pagesBySource)) {
    const byTitle = new Map();
    for (const p of pages) if (!byTitle.has(p.title)) byTitle.set(p.title, p);
    const rows = new Map();
    if (only?.[id]) {
      for (const [title, row] of only[id]) {
        const page = byTitle.get(title);
        if (!page) {
          rows.set(title, row);
          stats.kept++;
          continue;
        }
        const r = await rateArticle(page, shared);
        if (r) rows.set(title, { level: r.level, words: r.words });
      }
    } else {
      for (const page of byTitle.values()) {
        const r = await rateArticle(page, shared);
        if (r) rows.set(r.title, { level: r.level, words: r.words });
      }
    }
    sources[id] = sourcesFromRows(rows);
  }
  return { version: CATALOG_VERSION, generated, license: 'CC BY-SA 4.0', ...(sync ? { sync } : {}), sources };
}

/** A source is listed at a level when the catalog has at least this many articles there. */
export const MIN_PER_LEVEL = 20;

/** { [sourceId]: levels with ≥MIN_PER_LEVEL articles } (src/lib/reading/sources/klexikon-levels.json). */
export function catalogLevels(catalog) {
  const out = {};
  for (const [id, byLevel] of Object.entries(catalog.sources)) {
    out[id] = LEVEL_ORDER.filter((l) => (byLevel[l]?.length ?? 0) >= MIN_PER_LEVEL);
  }
  return out;
}
