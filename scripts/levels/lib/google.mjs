// @ts-nocheck
// Free Google Translate endpoint (client=gtx) with a persistent JSON cache, batching and back-off.
// Requests are slow on purpose (one every few seconds); every successful batch is written to
// .cache/google.json at once, so reruns resume where the last run stopped. If Google keeps refusing,
// the stage stops and the build continues with what is cached (the app falls back to English).
import fs from 'node:fs';

const ENDPOINT = 'https://translate.googleapis.com/translate_a/single';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class BlockedError extends Error {}

/** Split a translated multi-line response back into lines; null when the count differs. */
export function splitLines(data, count) {
  const text = (data?.[0] ?? []).map((seg) => seg?.[0] ?? '').join('');
  const out = text.split('\n').map((s) => s.trim());
  while (out.length > count && out.at(-1) === '') out.pop();
  return out.length === count ? out : null;
}

export class Translator {
  /** @param {string} cacheFile JSON file: { "<tl>|<kind>|<text>": result } */
  constructor(cacheFile, { pauseMs = 3000, maxRefusals = 10, offline = false, log = console.log } = {}) {
    this.cacheFile = cacheFile;
    this.cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};
    this.pauseMs = pauseMs;
    this.offline = offline;
    this.blocked = false;
    this.maxRefusals = maxRefusals;
    this.refusals = 0;
    this.log = log;
    this.requests = 0;
  }

  save() {
    fs.writeFileSync(this.cacheFile, JSON.stringify(this.cache));
  }

  /**
   * One POST. Refusals (429, 5xx, or the 302 redirect to Google's "unusual traffic" page) back
   * off 15 s, 30 s, 60 s, then 120 s (cap) and retry; after `maxRefusals` consecutive refusals
   * the translator stops for this run (`blocked`) and the caller keeps what is cached.
   */
  async request(tl, q) {
    if (this.offline || this.blocked) return null;
    const params = new URLSearchParams({ client: 'gtx', sl: 'de', tl, dt: 't' });
    for (;;) {
      if (this.requests++) await sleep(this.pauseMs);
      let res;
      try {
        res = await fetch(`${ENDPOINT}?${params}`, {
          method: 'POST',
          redirect: 'manual',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          body: new URLSearchParams({ q }).toString(),
        });
      } catch {
        res = null;
      }
      const ok = res?.ok && (res.headers.get('content-type') ?? '').includes('json');
      if (ok) {
        this.refusals = 0;
        return await res.json();
      }
      this.refusals = (this.refusals ?? 0) + 1;
      if (this.refusals >= this.maxRefusals) {
        this.blocked = true;
        this.log(`  Google refused ${this.refusals}× in a row (${res?.status ?? 'network'}); stopping, rerun later`);
        return null;
      }
      const wait = Math.min(120000, 15000 * 2 ** (this.refusals - 1));
      this.log(`  Google ${res?.status ?? 'network error'}, waiting ${wait / 1000}s (${this.refusals}/${this.maxRefusals})`);
      await sleep(wait);
    }
  }

  /**
   * Translate lines (sentences or single words), `batch` lines per request. Returns
   * translations aligned with `lines` ('' when unknown or a batch's line count differed).
   */
  async lines(lines, tl, kind, batch = 60) {
    const key = (l) => `${tl}|${kind}|${l}`;
    const todo = [...new Set(lines.filter((l) => l && !(key(l) in this.cache)))];
    if (todo.length) this.log(`  ${todo.length} ${kind} lines → ${tl} (${Math.ceil(todo.length / batch)} requests)`);
    for (let i = 0; i < todo.length; i += batch) {
      const chunk = todo.slice(i, i + batch);
      const data = await this.request(tl, chunk.join('\n'));
      if (!data) break;
      const out = splitLines(data, chunk.length);
      if (out) chunk.forEach((l, j) => (this.cache[key(l)] = out[j]));
      else {
        this.log(`  line count mismatch in a batch of ${chunk.length}; left empty`);
        chunk.forEach((l) => (this.cache[key(l)] = ''));
      }
      this.save();
    }
    return lines.map((l) => this.cache[key(l)] ?? '');
  }
}
