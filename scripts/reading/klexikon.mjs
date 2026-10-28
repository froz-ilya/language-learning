#!/usr/bin/env node
// @ts-nocheck
// Level catalog of MiniKlexikon and Klexikon → public/reading/klexikon.json (+ the Read tab's
// levels per source, src/lib/reading/sources/klexikon-levels.json).
//
//   node scripts/reading/klexikon.mjs --update    (npm run data:klexikon) only what changed on
//       the sites since the catalog's sync time: recent changes + delete/move logs, then the
//       new/edited pages in batches of 50. Needs nothing but the committed catalog (the monthly
//       GitHub Action runs this). Leaves the files untouched when nothing changed.
//       --summary=<dir> writes title.txt / body.md for a pull request.
//   node scripts/reading/klexikon.mjs --offline   (npm run data:reading) re-rates the catalog's
//       articles from the download cache, e.g. after the dictionary or the estimator changed.
//       No requests. Articles the cache doesn't have (added by an update elsewhere) keep their row.
//   node scripts/reading/klexikon.mjs --full [--offline]   rebuilds the article list itself from
//       a full download (cached in scripts/reading/.cache/klexikon/, delete it to download again):
//       every main-namespace article, 50 per request.
//
// Politeness: requests one at a time, ≥1.5 s apart, maxlag=5, a descriptive User-Agent, backing
// off on 429/5xx/maxlag (Retry-After honoured). Each article is rated with the app's own code
// (src/lib/reading/rate.ts via Vite, offline dictionary in public/dict), without a clamp.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { downloadAll, politeGet } from './lib/mwdump.mjs';
import { loadShared } from './lib/shared.mjs';
import { buildCatalog, catalogLevels } from './lib/catalog.mjs';
import { rater, rowsOf, summaryTitle, updateCatalog } from './lib/update.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const CACHE = path.join(HERE, '.cache/klexikon');
const OUT = path.join(ROOT, 'public/reading/klexikon.json');
/** Levels each source is listed at on the Read tab (imported by src/lib/reading/sources/index.ts). */
const LEVELS_OUT = path.join(ROOT, 'src/lib/reading/sources/klexikon-levels.json');
const args = process.argv.slice(2);
const OFFLINE = args.includes('--offline');
const FULL = args.includes('--full');
const UPDATE = args.includes('--update');
const SUMMARY = args.find((a) => a.startsWith('--summary='))?.slice(10);

const SITES = [
  { id: 'miniklexikon', name: 'MiniKlexikon', host: 'miniklexikon.zum.de' },
  { id: 'klexikon', name: 'Klexikon', host: 'klexikon.zum.de' },
];

const today = () => new Date().toISOString().slice(0, 10);
const readCatalog = () => (fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null);

/** Writes the catalog and the levels file if their content changed; true when written. */
function write(catalog) {
  const json = JSON.stringify(catalog);
  const levels = `${JSON.stringify(catalogLevels(catalog), null, 2)}\n`;
  const old = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  const strip = (s) => s.replace(/"generated":"[^"]*",/, '');
  const changed = strip(old) !== strip(json);
  if (changed) fs.writeFileSync(OUT, json);
  if (!fs.existsSync(LEVELS_OUT) || fs.readFileSync(LEVELS_OUT, 'utf8') !== levels) fs.writeFileSync(LEVELS_OUT, levels);
  for (const [id, byLevel] of Object.entries(catalog.sources)) {
    const counts = Object.entries(byLevel).map(([l, list]) => `${l} ${list.length}`).join(', ');
    const total = Object.values(byLevel).reduce((n, l) => n + l.length, 0);
    console.log(`${id}: ${total} articles (${counts})`);
  }
  console.log(`Read tab levels: ${Object.entries(catalogLevels(catalog)).map(([id, l]) => `${id} ${l.join(' ')}`).join(' · ')}`);
  const out = changed ? json : old;
  console.log(`${(out.length / 1024).toFixed(0)} KB raw, ${(zlib.gzipSync(out).length / 1024).toFixed(0)} KB gzip → ${path.relative(ROOT, OUT)}${changed ? '' : ' (unchanged)'}`);
  if (json.length > 300 * 1024) throw new Error('klexikon.json is over 300 KB');
  return changed;
}

/** Pages fetched by --update runs on this machine (newest revision wins over the full download). */
function updatePages(dir) {
  const out = new Map();
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir).sort()) {
    for (const p of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) {
      if (!out.has(p.title) || out.get(p.title).timestamp < p.timestamp) out.set(p.title, p);
    }
  }
  return out;
}

/** When the cached full download was made (oldest cache file, minus an hour of margin). */
function cacheTime(dir) {
  const times = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => fs.statSync(path.join(dir, f)).mtimeMs);
  return new Date(Math.min(...times) - 3600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

async function rebuild() {
  const stats = { requests: 0 };
  const committed = readCatalog();
  const pages = {};
  const sync = {};
  const only = {};
  for (const s of SITES) {
    const dir = path.join(CACHE, s.host);
    const base = await downloadAll(`https://${s.host}/api.php`, dir, { offline: OFFLINE, stats });
    const updates = updatePages(path.join(dir, 'updates'));
    pages[s.id] = [...base.filter((p) => !updates.has(p.title)), ...updates.values()];
    const known = committed?.sync?.[s.id];
    if (FULL || !known) {
      // The article list comes from the download itself.
      sync[s.id] = updates.size ? [...updates.values()].reduce((t, p) => (p.timestamp > t ? p.timestamp : t), cacheTime(dir)) : cacheTime(dir);
    } else {
      sync[s.id] = known;
      only[s.id] = rowsOf(committed.sources[s.id]);
    }
  }
  console.log(`HTTP requests made: ${stats.requests}${stats.requests ? ` (${stats.retries ?? 0} refused and retried)` : ' (all from cache)'}`);
  const shared = await loadShared(ROOT);
  const buildStats = {};
  const catalog = await buildCatalog(pages, shared, { generated: today(), sync, only, stats: buildStats });
  if (buildStats.kept) console.log(`${buildStats.kept} articles kept as they were (no text in the local cache)`);
  write(catalog);
}

async function update() {
  const committed = readCatalog();
  const shared = await loadShared(ROOT);
  const stats = { requests: 0 };
  for (const s of SITES) {
    const since = committed?.sync?.[s.id];
    if (since && Date.now() - Date.parse(since) > 85 * 86400_000) {
      console.warn(`${s.name}: last sync ${since} is older than the ~90 days of recent changes; consider --full`);
    }
  }
  const getFor = (id) => {
    const site = SITES.find((s) => s.id === id);
    const api = `https://${site.host}/api.php`;
    return async (params) => {
      const data = await politeGet(api, params, stats);
      // Keep fetched text locally so --offline rebuilds use it (a CI runner just discards it).
      const pages = params.titles
        ? (data?.query?.pages ?? [])
            .filter((p) => p.ns === 0 && !p.redirect && typeof p.revisions?.[0]?.slots?.main?.content === 'string')
            .map((p) => ({ title: p.title, wikitext: p.revisions[0].slots.main.content, timestamp: p.revisions[0].timestamp }))
        : [];
      if (pages.length) {
        const dir = path.join(CACHE, site.host, 'updates');
        fs.mkdirSync(dir, { recursive: true });
        const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}.json`;
        fs.writeFileSync(path.join(dir, name), JSON.stringify(pages));
      }
      return data;
    };
  };
  const r = await updateCatalog(committed, { sites: SITES, getFor, rate: rater(shared), today: today() });
  for (const s of r.sites) {
    const c = s.changes;
    console.log(
      `${s.name}: ${s.events} changes since ${s.since}, ${s.fetched} pages fetched → ${c.added.length} new, ${c.removed.length} removed, ${c.renamed.length} renamed, ${c.updated.length} re-rated`,
    );
  }
  for (const line of r.log) console.log(line);
  console.log(`HTTP requests made: ${stats.requests} (${stats.retries ?? 0} refused and retried)`);
  if (!r.catalog) {
    console.log('Nothing changed: catalog left as it is.');
    return;
  }
  write(r.catalog);
  if (SUMMARY) {
    fs.mkdirSync(SUMMARY, { recursive: true });
    fs.writeFileSync(path.join(SUMMARY, 'title.txt'), `${summaryTitle(r.totals)}\n`);
    fs.writeFileSync(
      path.join(SUMMARY, 'body.md'),
      [
        'Monthly update of the MiniKlexikon/Klexikon level catalog (`npm run data:klexikon`).',
        '',
        ...(r.log.length ? r.log : ['- No article changes (sync time refreshed).']),
        '',
        `${stats.requests} API requests. Merging deploys the new list.`,
        '',
      ].join('\n'),
    );
  }
}

(UPDATE ? update() : rebuild()).catch((e) => {
  console.error(e);
  process.exit(1);
});
