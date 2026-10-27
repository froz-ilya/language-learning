#!/usr/bin/env node
// @ts-nocheck
// Builds approximate CEFR level presets (public/levels/*.json) from word frequency.
//   node scripts/levels/build.mjs [--stage=dict|rank|words|translate|all] [--offline]
// Downloads and intermediate results are cached in scripts/levels/.cache/ (gitignored),
// so reruns are fast and translation requests are not repeated. Delete .cache/dict.json after
// changing lib/extract.mjs or lib/dict.mjs. Hand-made inputs (committed): topics.json (word|pos →
// topic) and overrides.json (excluded homographs/noise, hand-fixed translations).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDict } from './lib/dict.mjs';
import { candidates, exclusionReason, lemmaCounts, parseFrequency, rankLemmas } from './lib/rank.mjs';
import { Translator } from './lib/google.mjs';
import { buildLevels, topicOf } from './lib/levels.mjs';
import { BANDS, baseWords, levelOf } from './lib/words.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CACHE = path.join(HERE, '.cache');
const ROOT = path.resolve(HERE, '../..');
const OUT = path.join(ROOT, 'public/levels');

const FREQ_URL = 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/de/de_50k.txt';
const DUMP_URL = 'https://kaikki.org/dewiktionary/raw-wiktextract-data.jsonl.gz';
const TOTAL = 8000;
const SOURCES =
  'Word frequency: FrequencyWords (OpenSubtitles 2018, CC BY-SA 4.0) · Dictionary: Wiktionary via kaikki.org (CC BY-SA 4.0) · Example translations: Google Translate';

const args = new Set(process.argv.slice(2));
const STAGE = [...args].find((a) => a.startsWith('--stage='))?.slice(8) ?? 'all';
const OFFLINE = args.has('--offline');

const cachePath = (f) => path.join(CACHE, f);
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v));

async function download(url, file) {
  if (fs.existsSync(file)) return;
  if (OFFLINE) throw new Error(`missing ${file} (offline)`);
  console.log(`Downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const tmp = `${file}.part`;
  await fs.promises.writeFile(tmp, Buffer.from(await res.arrayBuffer()));
  fs.renameSync(tmp, file);
}

async function loadFrequency() {
  const file = cachePath('de_50k.txt');
  await download(FREQ_URL, file);
  return parseFrequency(fs.readFileSync(file, 'utf8'));
}

async function loadDict(freq) {
  const file = cachePath('dict.json');
  if (fs.existsSync(file)) return readJson(file);
  const dump = cachePath('raw-wiktextract-data.jsonl.gz');
  await download(DUMP_URL, dump);
  console.log('Indexing Wiktionary dump (a few minutes)…');
  const dict = await buildDict(dump, new Set(freq.map(([t]) => t)));
  writeJson(file, dict);
  return dict;
}

const overrides = readJson(path.join(HERE, 'overrides.json'));

export async function rank() {
  fs.mkdirSync(CACHE, { recursive: true });
  const freq = await loadFrequency();
  const dict = await loadDict(freq);
  if (STAGE === 'dict') return null;
  const cands = candidates(freq, dict, new Set(overrides.exclude), new Set(overrides.keep));
  const totals = lemmaCounts(freq, cands, dict.lemmas);
  const ranked = rankLemmas(totals, dict.lemmas, TOTAL);
  return { freq, dict, cands, totals, ranked };
}

async function main() {
  const r = await rank();
  if (!r) return;
  const { dict, ranked } = r;
  if (STAGE === 'rank') {
    const lines = ranked.map(({ key, count }, i) => {
      const w = dict.lemmas[key];
      return `${i + 1}\t${key}\t${count}\t${w.genders.join('')}\t${w.plural}\t${w.tr.en.slice(0, 3).join(', ')}\t${w.tr.ru.slice(0, 3).join(', ')}`;
    });
    fs.writeFileSync(cachePath('ranked.tsv'), lines.join('\n'));
    console.log(`ranked.tsv: ${ranked.length}`);
    return;
  }
  const words = baseWords(ranked, dict.lemmas, overrides.tr);
  const miss = (l) => words.filter((w) => !w.tr[l].length).length;
  console.log(`words ${words.length}; missing ru ${miss('ru')}, en ${miss('en')}, examples ${words.filter((w) => !w.example).length}`);
  writeJson(cachePath('words-base.json'), words);
  if (STAGE === 'words') return;

  // Stage 4: Google fills what Wiktionary lacks, cached in .cache/google.json. Priority: missing
  // word translations level by level (ru, then en), then example translations A1 → C2.
  const gt = new Translator(cachePath('google.json'), { offline: OFFLINE });
  const byLevel = (list) => BANDS.map(([code]) => list.filter((w) => levelOf(w.rank) === code));
  for (const lang of ['ru', 'en']) {
    for (const missing of byLevel(words.filter((w) => !w.tr[lang].length))) {
      const got = await gt.lines(missing.map((w) => w.term), lang, 'word');
      missing.forEach((w, i) => {
        // An earlier run stored dictionary alternatives per word+pos; prefer those when present.
        const alt = gt.cache[`${lang}|w|${w.term}|${w.rawPos}`];
        const list = Array.isArray(alt) && alt.length ? alt : got[i] ? [got[i].toLowerCase()] : [];
        w.tr[lang] = list.filter((t) => t && t.toLowerCase() !== w.term.toLowerCase()).slice(0, 3);
      });
    }
  }
  for (const level of byLevel(words.filter((w) => w.example))) {
    for (const lang of ['ru', 'en']) {
      const out = await gt.lines(level.map((w) => w.example), lang, 's');
      level.forEach((w, i) => (w[`example_${lang}`] = out[i]));
    }
  }
  if (STAGE === 'translate') return;

  // Stage 5: topics, grouping, output.
  const topics = readJson(path.join(HERE, 'topics.json'));
  for (const w of words) w.topic = topicOf(w, topics);
  const { files, index } = buildLevels(words, SOURCES);
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of files) fs.writeFileSync(path.join(OUT, `${f.level}.json`), JSON.stringify(f));
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index));
  report(files, index);
}

function report(files, index) {
  console.log('\nLevel  words  size     topics');
  for (const l of index.levels) {
    const size = fs.statSync(path.join(OUT, `${l.code}.json`)).size;
    console.log(`${l.code}     ${String(l.words).padEnd(5)}  ${(size / 1024).toFixed(0).padStart(4)} KB  ${l.topics.length} sets`);
    console.log(`       ${l.topics.map((t) => `${t.name} (${t.count})`).join(' · ')}`);
    if (size > 1_000_000) console.warn(`  ⚠ ${l.code}.json is over 1 MB`);
  }
  const a1 = files[0].words;
  const noRu = files.flatMap((f) => f.words).filter((w) => !w.tr.ru).length;
  const noEx = files.flatMap((f) => f.words).filter((w) => !w.example).length;
  const exNoTr = files.flatMap((f) => f.words).filter((w) => w.example && !w.example.ru).length;
  console.log(`\nWithout ru: ${noRu}; without example: ${noEx}; examples without ru translation: ${exNoTr}`);
  console.log('\n15 random A1 words:');
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const picks = [...a1].sort(() => rnd() - 0.5).slice(0, 15);
  for (const w of picks) {
    const art = w.genders.map((g) => ({ m: 'der', f: 'die', n: 'das' })[g]).join('/');
    const grammar = w.pos === 'noun' ? `${art} ${w.term}, pl. ${w.plural || '–'}` : w.pos === 'verb' ? `${w.term} (${w.praeteritum}, ${w.auxiliary} ${w.partizip2})` : w.term;
    console.log(`  #${w.rank} ${grammar} — ru: ${w.tr.ru} | en: ${w.tr.en} [${w.topic}]`);
  }
  const must = ['Haus', 'gehen', 'gut', 'Wasser'];
  const missing = must.filter((t) => !a1.some((w) => w.term === t));
  if (missing.length) throw new Error(`A1 is missing ${missing.join(', ')}`);
  console.log(`\nA1 contains ${must.join(', ')} ✓`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

export { exclusionReason, OUT };
