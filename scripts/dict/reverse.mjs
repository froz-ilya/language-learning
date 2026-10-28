#!/usr/bin/env node
// @ts-check
// Builds the reverse dictionary (public/dict/rev/) from the offline dictionary in public/dict:
// for each translation language, Russian / English words → the German entries they translate.
//   node scripts/dict/reverse.mjs        (run by `npm run data:dict` after build.mjs)
// Output: rev/index.json { version, langs: { ru: { [key]: file }, en: … } } plus shards
//   { w: { [word]: id[] }, e: { [id]: [rank, tags, translation] } }
// keyed by the word's first two letters (see reverse-lib.mjs); small shards share a file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildShards } from './reverse-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DICT = path.join(ROOT, 'public/dict');
const OUT = path.join(DICT, 'rev');
/** Shards are packed into files of at least this many bytes. */
const MIN_FILE = 6000;

const pieces = fs.readdirSync(DICT).filter((f) => f.endsWith('.json') && f !== 'index.json');
const entries = { ru: [], en: [] };
for (const f of pieces) {
  const { lemmas } = JSON.parse(fs.readFileSync(path.join(DICT, f), 'utf8'));
  for (const [id, [rank, tags, ru, en]] of Object.entries(lemmas)) {
    entries.ru.push({ id, rank, tags, tr: ru });
    entries.en.push({ id, rank, tags, tr: en });
  }
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const index = { version: 1, langs: {} };
let total = 0;
for (const lang of /** @type {const} */ (['ru', 'en'])) {
  const shards = buildShards(entries[lang]);
  const keys = [...shards.keys()].sort();
  const files = [];
  let cur = null;
  for (const k of keys) {
    const size = JSON.stringify(shards.get(k)).length;
    if (!cur || cur.size >= MIN_FILE) files.push((cur = { keys: [], size: 0 }));
    cur.keys.push(k);
    cur.size += size;
  }
  index.langs[lang] = {};
  files.forEach((file, i) => {
    const name = `${lang}-${i}.json`;
    const merged = { w: {}, e: {} };
    for (const k of file.keys) {
      Object.assign(merged.w, shards.get(k).w);
      Object.assign(merged.e, shards.get(k).e);
      index.langs[lang][k] = name;
    }
    const text = JSON.stringify(merged);
    total += Buffer.byteLength(text);
    fs.writeFileSync(path.join(OUT, name), text);
  });
  console.log(`${lang}: ${entries[lang].filter((e) => e.tr).length} entries, ${keys.length} keys → ${files.length} files`);
}
const indexText = JSON.stringify(index);
fs.writeFileSync(path.join(OUT, 'index.json'), indexText);
total += Buffer.byteLength(indexText);
console.log(`public/dict/rev: ${(total / 1024).toFixed(0)} KB`);
