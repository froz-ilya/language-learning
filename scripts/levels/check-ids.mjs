#!/usr/bin/env node
// @ts-nocheck
// Checks that rebuilt level presets keep every word id of a committed version (user progress is
// tied to them) and lists what changed for the kept ids.
//   node scripts/levels/check-ids.mjs [git-ref=HEAD]
// Exits with code 1 when an id of the old version is missing.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REF = process.argv[2] ?? 'HEAD';
const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

const oldFile = (code) =>
  JSON.parse(execFileSync('git', ['show', `${REF}:public/levels/${code}.json`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 }));
const newFile = (code) => JSON.parse(fs.readFileSync(path.join(ROOT, 'public/levels', `${code}.json`), 'utf8'));

const before = new Map();
const after = new Map();
for (const code of LEVELS) {
  for (const w of oldFile(code).words) before.set(w.id, w);
  for (const w of newFile(code).words) after.set(w.id, w);
}
const missing = [...before.keys()].filter((id) => !after.has(id));
const added = [...after.keys()].filter((id) => !before.has(id));
const fields = ['term', 'pos', 'genders', 'plural', 'tr', 'example', 'topic', 'rank'];
const changed = [];
for (const [id, w] of before) {
  const n = after.get(id);
  if (!n) continue;
  const diff = fields.filter((f) => JSON.stringify(w[f]) !== JSON.stringify(n[f]));
  if (diff.length) changed.push({ id, diff, w, n });
}
console.log(`ids before ${before.size}, after ${after.size}; missing ${missing.length}, added ${added.length}`);
if (added.length) console.log(`added: ${added.join(', ')}`);
for (const c of changed) {
  console.log(`changed ${c.id}: ${c.diff.map((f) => `${f} ${JSON.stringify(c.w[f])} → ${JSON.stringify(c.n[f])}`).join(' | ')}`);
}
if (missing.length) {
  console.error(`MISSING ids: ${missing.join(', ')}`);
  process.exit(1);
}
console.log('every old id is still there ✓');
