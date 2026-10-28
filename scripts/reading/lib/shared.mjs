// @ts-nocheck
// Loads the app's own TypeScript modules into Node (through Vite's module runner), so the
// catalog build rates articles with exactly the code the app uses: src/lib/reading/rate.ts
// (estimateLevel + lemma lookup in the offline dictionary) and src/lib/reading/wikitext.ts.
// The dictionary is read from public/dict on disk instead of being fetched.
import fs from 'node:fs';
import path from 'node:path';
import { runnerImport } from 'vite';

const BASE = '/language-learning/';

/** fetch() for the app's own data files (BASE + "dict/…"): served from public/. */
function localFetch(root, realFetch) {
  return async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith(BASE)) {
      const file = path.join(root, 'public', url.slice(BASE.length));
      if (!fs.existsSync(file)) return new Response('not found', { status: 404 });
      return new Response(fs.readFileSync(file), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return realFetch(input, init);
  };
}

export async function loadShared(root) {
  globalThis.fetch = localFetch(root, globalThis.fetch);
  const config = { configFile: false, root, base: BASE, logLevel: 'error' };
  const [rate, wikitext, text] = await Promise.all(
    ['rate.ts', 'wikitext.ts', 'text.ts'].map(async (f) => (await runnerImport(path.join(root, 'src/lib/reading', f), config)).module),
  );
  return { ...rate, ...wikitext, ...text };
}
