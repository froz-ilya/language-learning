// @ts-nocheck
// Builds the Klexikon/MiniKlexikon level catalog from downloaded pages (pure apart from the
// rating, which comes from the app's own modules: see shared.mjs). Used by klexikon.mjs and
// by the app's tests (src/lib/reading/catalog.test.ts), so both rate the same way.

export const CATALOG_VERSION = 1;
/** Articles with fewer words are stubs: too short to rate or to be worth reading. */
export const MIN_WORDS = 40;
const LEVEL_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const SKIP_TITLES = new Set(['Hauptseite']);

/**
 * One catalog row for a page, or null when it can't be rated.
 * `shared` = { wikitextToParagraphs, rateParagraphs, countWords, isHeading } (the app's modules).
 */
export async function rateArticle(page, shared) {
  if (SKIP_TITLES.has(page.title)) return null;
  const paragraphs = shared.wikitextToParagraphs(page.wikitext);
  const body = paragraphs.filter((p) => !shared.isHeading(p));
  const words = body.reduce((n, p) => n + shared.countWords(p), 0);
  if (words < MIN_WORDS) return null;
  const level = await shared.rateParagraphs(paragraphs);
  if (!level) return null;
  return { title: page.title, level, words };
}

/**
 * { version, generated, license, sources: { [sourceId]: { [level]: [title, words][] } } }
 * Rows are sorted by title so rebuilds give small diffs. No snippets: they would quadruple the
 * file (≈390 KB instead of ≈95 KB for ~5,000 articles).
 */
export async function buildCatalog(pagesBySource, shared, { generated = '' } = {}) {
  const sources = {};
  for (const [id, pages] of Object.entries(pagesBySource)) {
    const byLevel = {};
    const seen = new Set();
    for (const page of pages) {
      if (seen.has(page.title)) continue;
      seen.add(page.title);
      const row = await rateArticle(page, shared);
      if (!row) continue;
      (byLevel[row.level] ??= []).push([row.title, row.words]);
    }
    const sorted = {};
    for (const l of LEVEL_ORDER) {
      if (!byLevel[l]) continue;
      sorted[l] = byLevel[l].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    }
    sources[id] = sorted;
  }
  return { version: CATALOG_VERSION, generated, license: 'CC BY-SA 4.0', sources };
}
