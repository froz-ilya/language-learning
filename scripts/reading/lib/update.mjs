// @ts-nocheck
// Incremental update of the Klexikon/MiniKlexikon catalog from the committed file alone: asks a
// site what changed since the catalog's sync time (recent changes + delete/move logs), fetches
// only new/edited pages (50 per request), re-rates them and applies deletions and renames.
// `get(params)` does one API request (politeGet in klexikon.mjs, a fixture stub in tests).
import { rateArticle, sourcesFromRows } from './catalog.mjs';

const BASE = { action: 'query', format: 'json', formatversion: '2', maxlag: '5' };
const BATCH = 50;

/** All results of a list query, following `continue` (one request per page of results). */
async function listAll(get, params, key) {
  const out = [];
  let cont;
  for (;;) {
    const data = await get({ ...BASE, ...params, ...(cont ?? {}) });
    out.push(...(data?.query?.[key] ?? []));
    if (!data?.continue) return out;
    cont = data.continue;
  }
}

/** One second after an ISO time (the API's start times are inclusive). */
const after = (iso) => new Date(Date.parse(iso) + 1000).toISOString().replace(/\.000Z$/, 'Z');

/**
 * What changed on a site since `since` (ISO), oldest first:
 * { type: 'edit' | 'delete' | 'move', title, to?, toNs?, timestamp }.
 * New pages, edits and undeletions are all 'edit' (the page is fetched again).
 */
export async function siteChanges(get, since) {
  const start = after(since);
  const rc = await listAll(
    get,
    { list: 'recentchanges', rcnamespace: '0', rctype: 'new|edit', rcprop: 'title|timestamp|ids', rcdir: 'newer', rcstart: start, rclimit: '500' },
    'recentchanges',
  );
  const log = (type, prop) =>
    listAll(get, { list: 'logevents', letype: type, lenamespace: '0', ledir: 'newer', lestart: start, leprop: prop, lelimit: '500' }, 'logevents');
  const deletes = await log('delete', 'title|type|timestamp|ids');
  const moves = await log('move', 'title|type|timestamp|details|ids');
  const events = [
    ...rc.map((r) => ({ type: 'edit', title: r.title, timestamp: r.timestamp })),
    ...deletes
      .filter((e) => e.action === 'delete' || e.action === 'restore')
      .map((e) => ({ type: e.action === 'delete' ? 'delete' : 'edit', title: e.title, timestamp: e.timestamp })),
    ...moves
      .filter((e) => e.params?.target_title)
      .map((e) => ({ type: 'move', title: e.title, to: e.params.target_title, toNs: e.params.target_ns ?? 0, timestamp: e.timestamp })),
  ];
  events.sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
  return events;
}

/** Current text of pages by title (batches of 50): Map title → { wikitext } | null (gone / redirect / not an article). */
export async function fetchPages(get, titles) {
  const out = new Map();
  const list = [...titles];
  for (let i = 0; i < list.length; i += BATCH) {
    const batch = list.slice(i, i + BATCH);
    const data = await get({ ...BASE, prop: 'info|revisions', rvprop: 'content|timestamp', rvslots: 'main', titles: batch.join('|') });
    for (const t of batch) out.set(t, null);
    // Titles as sent may be normalised by the API ("hund" → "Hund").
    const norm = new Map((data?.query?.normalized ?? []).map((n) => [n.to, n.from]));
    for (const p of data?.query?.pages ?? []) {
      const sent = norm.get(p.title) ?? p.title;
      const content = p.revisions?.[0]?.slots?.main?.content ?? p.revisions?.[0]?.content;
      const ok = !p.missing && !p.invalid && !p.redirect && p.ns === 0 && typeof content === 'string';
      out.set(sent, ok ? { title: p.title, wikitext: content, timestamp: p.revisions[0].timestamp } : null);
    }
  }
  return out;
}

/** Catalog rows of one source as Map title → { level, words }. */
export function rowsOf(byLevel) {
  const rows = new Map();
  for (const [level, list] of Object.entries(byLevel ?? {})) for (const [title, words] of list) rows.set(title, { level, words });
  return rows;
}

/**
 * Applies a site's changes to its rows. Returns { rows, newest, fetched, changes } where
 * changes = { added: [title], removed: [title], renamed: [[from, to]], updated: [title] }.
 * `rate(page)` gives { level, words } or null (too short to rate).
 */
export async function applyChanges(rows, events, { get, rate }) {
  const next = new Map(rows);
  const toFetch = new Set();
  /** Renames as applied, oldest first (a page moved twice ends at its last title). */
  const moved = new Map(); // current title → original title
  for (const e of events) {
    if (e.type === 'edit') toFetch.add(e.title);
    else if (e.type === 'delete') {
      next.delete(e.title);
      toFetch.delete(e.title);
    } else if (e.type === 'move') {
      const row = next.get(e.title);
      next.delete(e.title);
      const wasFetching = toFetch.delete(e.title);
      if (e.toNs !== 0) continue; // moved out of the articles: gone
      if (row) next.set(e.to, row);
      if (wasFetching) toFetch.add(e.to);
      moved.set(e.to, moved.get(e.title) ?? e.title);
      moved.delete(e.title);
    }
  }
  const pages = toFetch.size ? await fetchPages(get, toFetch) : new Map();
  for (const [title, page] of pages) {
    const row = page ? await rate(page) : null;
    if (row) next.set(title, { level: row.level, words: row.words });
    else next.delete(title);
  }

  const changes = { added: [], removed: [], renamed: [], updated: [] };
  const renamedFrom = new Map();
  for (const [to, from] of moved) if (next.has(to) && rows.has(from) && from !== to) renamedFrom.set(from, to);
  for (const [from, to] of renamedFrom) changes.renamed.push([from, to]);
  const renamedTo = new Set(renamedFrom.values());
  for (const title of rows.keys()) if (!next.has(title) && !renamedFrom.has(title)) changes.removed.push(title);
  for (const [title, row] of next) {
    const before = rows.get(title) ?? (renamedTo.has(title) ? rows.get([...renamedFrom].find(([, t]) => t === title)[0]) : null);
    if (!before) changes.added.push(title);
    else if (before.level !== row.level || before.words !== row.words) changes.updated.push(title);
  }
  const newest = events.length ? events[events.length - 1].timestamp : null;
  return { rows: next, newest, fetched: pages.size, changes };
}

/** The app's rating of a fetched page: { level, words } or null. */
export const rater = (shared) => (page) => rateArticle(page, shared);

/** Write the sync time even without changes once it is this old (recent changes last ~90 days). */
export const SYNC_REFRESH_DAYS = 60;

/**
 * One incremental update of the whole catalog. `sites` = [{ id, name }], `getFor(id)` gives the
 * request function of a site. Returns { catalog, totals, log, sites: [{ name, since, events,
 * fetched, changes }] } — `catalog` is null when nothing changed (leave the file as it is).
 */
export async function updateCatalog(committed, { sites, getFor, rate, now = Date.now(), today = '' }) {
  if (!committed?.sync) throw new Error('The catalog has no sync time: build it once with --full');
  const sources = { ...committed.sources };
  const sync = { ...committed.sync };
  const totals = { added: 0, removed: 0, renamed: 0, updated: 0 };
  const log = [];
  const report = [];
  let changed = false;
  for (const s of sites) {
    const since = committed.sync[s.id];
    if (!since) throw new Error(`No sync time for ${s.id}: build it once with --full`);
    const get = getFor(s.id);
    const events = await siteChanges(get, since);
    const before = rowsOf(committed.sources[s.id]);
    const r = await applyChanges(before, events, { get, rate });
    const c = r.changes;
    const n = c.added.length + c.removed.length + c.renamed.length + c.updated.length;
    for (const t of c.added) log.push(`- ${s.name}: new “${t}” (${r.rows.get(t).level})`);
    for (const t of c.removed) log.push(`- ${s.name}: removed “${t}”`);
    for (const [a, b] of c.renamed) log.push(`- ${s.name}: renamed “${a}” → “${b}”`);
    for (const t of c.updated) log.push(`- ${s.name}: “${t}” re-rated ${before.get(t)?.level ?? '?'} → ${r.rows.get(t).level}`);
    for (const k of Object.keys(totals)) totals[k] += c[k].length;
    if (n) {
      sources[s.id] = sourcesFromRows(r.rows);
      changed = true;
    }
    if (r.newest && r.newest > since && (n || now - Date.parse(since) > SYNC_REFRESH_DAYS * 86400_000)) {
      sync[s.id] = r.newest;
      changed = true;
    }
    report.push({ name: s.name, since, events: events.length, fetched: r.fetched, changes: c });
  }
  const catalog = changed ? { version: committed.version, generated: today, license: committed.license, sync, sources } : null;
  return { catalog, totals, log, sites: report };
}

/** Pull request title: "Update reading list (2 new, 1 removed)". */
export function summaryTitle(totals) {
  const parts = [`${totals.added} new`, `${totals.removed} removed`];
  if (totals.renamed) parts.push(`${totals.renamed} renamed`);
  if (totals.updated) parts.push(`${totals.updated} re-rated`);
  return `Update reading list (${parts.join(', ')})`;
}
