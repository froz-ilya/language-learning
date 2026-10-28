// @ts-nocheck
// Polite, cached, sequential download of every main-namespace article of a MediaWiki site via
// the Action API: generator=allpages (50 pages per request) + prop=revisions (wikitext).
// Every raw response is cached (one file per request, keyed by its continue token) so reruns
// don't refetch; with `offline` only the cache is read.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const USER_AGENT = 'deutsch-lernen-pwa/1.0 (https://github.com/froz-ilya/language-learning)';
const PAUSE_MS = 1500;
const MAX_ATTEMPTS = 6;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Query parameters of one allpages+revisions batch (`cont` = the previous response's `continue`). */
export function batchParams(cont) {
  return {
    action: 'query',
    format: 'json',
    formatversion: '2',
    maxlag: '5',
    generator: 'allpages',
    gapnamespace: '0',
    gapfilterredir: 'nonredirects',
    gaplimit: '50',
    prop: 'revisions',
    rvprop: 'content',
    rvslots: 'main',
    ...(cont ?? {}),
  };
}

/** Cache file name for a request: index-independent (continue token hash), so reruns line up. */
function cacheName(cont) {
  const key = cont ? JSON.stringify(cont) : 'start';
  return `${crypto.createHash('sha1').update(key).digest('hex').slice(0, 16)}.json`;
}

/** Pages (title + wikitext) of one response. */
export function pagesOf(data) {
  const out = [];
  for (const p of data?.query?.pages ?? []) {
    const content = p.revisions?.[0]?.slots?.main?.content ?? p.revisions?.[0]?.content;
    if (p.ns === 0 && typeof content === 'string') out.push({ title: p.title, pageid: p.pageid, wikitext: content });
  }
  return out;
}

/**
 * All articles of `api` (e.g. https://klexikon.zum.de/api.php), cached under `cacheDir`.
 * `stats.requests` counts network requests made, `stats.retries` the ones that were refused.
 */
export async function downloadAll(api, cacheDir, { offline = false, stats = { requests: 0 }, log = console.log } = {}) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const pages = new Map();
  let cont;
  let batches = 0;
  for (;;) {
    const file = path.join(cacheDir, cacheName(cont));
    let data;
    if (fs.existsSync(file)) {
      data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } else {
      if (offline) throw new Error(`missing cache ${path.basename(file)} for ${api} (offline)`);
      data = await politeGet(api, batchParams(cont), stats, log);
      fs.writeFileSync(file, JSON.stringify(data));
    }
    batches++;
    for (const p of pagesOf(data)) {
      // With rvcontinue the same generator batch comes again: keep the first copy that has text.
      if (!pages.has(p.title)) pages.set(p.title, p);
    }
    if (!data.continue) break;
    cont = data.continue;
  }
  log(`  ${api}: ${batches} batches, ${pages.size} pages`);
  return [...pages.values()];
}

let lastRequest = 0;

/** One GET, sequential, ≥PAUSE_MS after the previous one; backs off on 429/5xx/maxlag. */
async function politeGet(api, params, stats, log) {
  const url = `${api}?${new URLSearchParams(params)}`;
  let backoff = 5000;
  for (let attempt = 1; ; attempt++) {
    const wait = lastRequest + PAUSE_MS - Date.now();
    if (wait > 0) await sleep(wait);
    stats.requests++;
    let res;
    try {
      res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Api-User-Agent': USER_AGENT } });
    } catch (e) {
      res = null;
      log(`  network error: ${e.message}`);
    }
    lastRequest = Date.now();
    let retryAfter = 0;
    let data;
    if (res?.ok) {
      data = await res.json();
      if (data?.error?.code === 'maxlag') retryAfter = Number(res.headers.get('retry-after')) || 5;
      else if (data?.error) throw new Error(`${api}: ${data.error.code}: ${data.error.info}`);
      else return data;
    } else if (res && res.status !== 429 && res.status < 500) {
      throw new Error(`${api}: HTTP ${res.status}`);
    } else if (res) {
      retryAfter = Number(res.headers.get('retry-after')) || 0;
    }
    if (attempt >= MAX_ATTEMPTS) throw new Error(`${api}: giving up after ${attempt} attempts (the cache keeps what we have)`);
    const ms = Math.max(backoff, retryAfter * 1000);
    stats.retries = (stats.retries ?? 0) + 1;
    log(`  ${res ? `HTTP ${res.status}${data?.error ? ' maxlag' : ''}` : 'no response'} – waiting ${Math.round(ms / 1000)} s`);
    await sleep(ms);
    backoff *= 2;
  }
}
