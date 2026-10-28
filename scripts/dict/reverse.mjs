#!/usr/bin/env node
// @ts-check
// Builds the reverse dictionary (public/dict/rev/) from the offline dictionary in public/dict:
// for each translation language, Russian / English words → the German entries they translate.
//   node scripts/dict/reverse.mjs        (run by `npm run data:dict` after build.mjs)
// Format and matching rules: reverse-lib.mjs; runtime: src/lib/dict/reverse.ts.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { buildReverse } from './reverse-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DICT = path.join(ROOT, 'public/dict');
const OUT = path.join(DICT, 'rev');

const pieces = fs.readdirSync(DICT).filter((f) => f.endsWith('.json') && f !== 'index.json').sort();
/** @type {Record<string, { id: string, rank: number, tags: string, tr: string }[]>} */
const entries = { ru: [], en: [] };
for (const f of pieces) {
  const { lemmas } = JSON.parse(fs.readFileSync(path.join(DICT, f), 'utf8'));
  for (const [id, [rank, tags, ru, en]] of Object.entries(lemmas)) {
    if (ru) entries.ru.push({ id, rank, tags, tr: ru });
    if (en) entries.en.push({ id, rank, tags, tr: en });
  }
}

const { index, files } = buildReverse(entries);
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
let raw = 0;
let gz = 0;
let largest = ['', 0];
const write = (name, text) => {
  const size = Buffer.byteLength(text);
  fs.writeFileSync(path.join(OUT, name), text);
  raw += size;
  gz += zlib.gzipSync(text).length;
  if (size > largest[1]) largest = [name, size];
};
for (const [name, text] of files) write(name, text);
write('index.json', JSON.stringify(index));
for (const lang of Object.keys(entries)) {
  const { files: names, keys } = index.langs[lang];
  console.log(`${lang}: ${entries[lang].length} entries, ${Object.keys(keys).length} keys → ${names.length} files`);
}
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(`public/dict/rev: ${files.size + 1} files, ${kb(raw)} raw, ${kb(gz)} gzip; largest ${largest[0]} ${kb(largest[1])}`);
