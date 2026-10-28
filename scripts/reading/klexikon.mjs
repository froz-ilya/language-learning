#!/usr/bin/env node
// @ts-nocheck
// Level catalog of MiniKlexikon and Klexikon → public/reading/klexikon.json.
//   node scripts/reading/klexikon.mjs [--offline]
// Downloads every main-namespace article of both sites ONCE, politely: batched API requests
// (50 articles each, wikitext), one at a time, ≥1.5 s apart, maxlag=5, backing off on
// 429/5xx/maxlag. Raw responses are cached in scripts/reading/.cache/klexikon/ (gitignored);
// --offline rebuilds from the cache only. Each article is rated with the app's own code
// (src/lib/reading/rate.ts, offline dictionary in public/dict), without clamping to a range.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { downloadAll } from './lib/mwdump.mjs';
import { loadShared } from './lib/shared.mjs';
import { buildCatalog } from './lib/catalog.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const CACHE = path.join(HERE, '.cache/klexikon');
const OUT = path.join(ROOT, 'public/reading/klexikon.json');
const OFFLINE = process.argv.includes('--offline');

const SITES = [
  { id: 'miniklexikon', host: 'miniklexikon.zum.de' },
  { id: 'klexikon', host: 'klexikon.zum.de' },
];

async function main() {
  const stats = { requests: 0 };
  const pages = {};
  for (const s of SITES) {
    pages[s.id] = await downloadAll(`https://${s.host}/api.php`, path.join(CACHE, s.host), { offline: OFFLINE, stats });
  }
  console.log(`HTTP requests made: ${stats.requests}${stats.requests ? ` (${stats.retries ?? 0} refused and retried)` : ' (all from cache)'}`);

  const shared = await loadShared(ROOT);
  const catalog = await buildCatalog(pages, shared, { generated: new Date().toISOString().slice(0, 10) });

  const json = JSON.stringify(catalog);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, json);

  for (const [id, byLevel] of Object.entries(catalog.sources)) {
    const counts = Object.entries(byLevel).map(([l, list]) => `${l} ${list.length}`).join(', ');
    const total = Object.values(byLevel).reduce((n, l) => n + l.length, 0);
    console.log(`${id}: ${total} of ${pages[id].length} articles rated (${counts})`);
  }
  const gz = zlib.gzipSync(json).length;
  console.log(`${(json.length / 1024).toFixed(0)} KB raw, ${(gz / 1024).toFixed(0)} KB gzip → ${path.relative(ROOT, OUT)}`);
  if (json.length > 300 * 1024) throw new Error('klexikon.json is over 300 KB');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
