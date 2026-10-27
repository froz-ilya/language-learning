#!/usr/bin/env node
// @ts-nocheck
// Builds the offline German dictionary (public/dict/*.json) from the level pipeline's caches.
//   node scripts/dict/build.mjs [--lemmas=30000] [--max-kb=1560]
// Inputs (see scripts/levels/build.mjs, which downloads them): scripts/levels/.cache/de_50k.txt,
// dict.json and raw-wiktextract-data.jsonl.gz; scripts/levels/overrides.json; public/levels/*.json
// (levels and, for preset words, translations Wiktionary lacks; no translation requests are made).
// Output: public/dict/index.json + one piece per group of 2-letter prefixes. A piece is
//   { lemmas: { [id]: [rank, tags, ru, en, a?, b?] }, forms: { [formLower]: id[] } }
// (compact entries, decoded to LexEntry by src/lib/dict/local.ts; see encodeEntry in lib.mjs).
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { formatMeanings, parseKaikkiEntry } from '../levels/lib/extract.mjs';
import {
  candidates,
  exclusionReason,
  groupId,
  keysByWord,
  lemmaCounts,
  parseFrequency,
  rankLemmas,
  resolveTarget,
} from '../levels/lib/rank.mjs';
import { baseWords } from '../levels/lib/words.mjs';
import {
  encodeEntry,
  expandForm,
  formsOfEntry,
  groupPieces,
  normalizeKey,
  pieceFile,
  plausibleToken,
  prefixOf,
  ruleCandidates,
} from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const CACHE = path.join(ROOT, 'scripts/levels/.cache');
const OUT = path.join(ROOT, 'public/dict');
const LEVELS = path.join(ROOT, 'public/levels');
const SOURCES =
  'Word frequency: FrequencyWords (OpenSubtitles 2018, CC BY-SA 4.0) · Dictionary: Wiktionary via kaikki.org (CC BY-SA 4.0) · Missing translations of preset words: public/levels (partly Google Translate)';

const arg = (name, def) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? Number(a.slice(name.length + 3)) : def;
};
const MAX_LEMMAS = arg('lemmas', 30000);
// 1560 KB ≈ 1.6 MB: grouped meanings ("a, b; c") made entries a little longer than the old 1536.
const MAX_BYTES = arg('max-kb', 1560) * 1024;
const FILL_POS = new Set(['noun', 'verb', 'adj']);
const MAX_SEPARABLE = 3;
const MIN_PIECE = 3000;
/** Preposition + article contractions and article forms → lemma. */
const HAND_FORMS = {
  im: 'in', ins: 'in', am: 'an', ans: 'an', zum: 'zu', zur: 'zu', vom: 'von', beim: 'bei', aufs: 'auf',
  durchs: 'durch', fürs: 'für', ums: 'um', übers: 'über', überm: 'über', unters: 'unter', unterm: 'unter',
  vors: 'vor', vorm: 'vor', hinters: 'hinter', hinterm: 'hinter', den: 'der', dem: 'der', des: 'der',
};
/** A 2-letter prefix bigger than this is split by 3 letters ("sch", "sci", …). */
const MAX_PIECE = 30000;
/** Bytes outside the lemma/form pairs: index.json and each piece's braces. */
const OVERHEAD = 12 * 1024;

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const need = (f) => {
  if (!fs.existsSync(f)) throw new Error(`missing ${f}: run node scripts/levels/build.mjs --stage=dict first`);
  return f;
};

/** term|pos → level code from the committed presets. */
function presetLevels() {
  const out = new Map();
  for (const f of fs.readdirSync(LEVELS)) {
    if (!/^[ABC][12]\.json$/.test(f)) continue;
    const file = readJson(path.join(LEVELS, f));
    for (const w of file.words) if (!out.has(`${w.term}|${w.pos}`)) out.set(`${w.term}|${w.pos}`, file.level);
  }
  return out;
}

/** term|pos → the preset word's tr ({ru, en} strings), to fill what Wiktionary lacks. */
function presetTranslations() {
  const out = new Map();
  for (const f of fs.readdirSync(LEVELS)) {
    if (!/^[ABC][12]\.json$/.test(f)) continue;
    for (const w of readJson(path.join(LEVELS, f)).words) if (!out.has(`${w.term}|${w.pos}`)) out.set(`${w.term}|${w.pos}`, w.tr ?? {});
  }
  return out;
}

/** Step 1: ranked lemma groups (as the level pipeline), then rich Wiktionary entries as fill. */
function selectLemmas(freq, dict, overrides, levels) {
  const cands = candidates(freq, dict, new Set(overrides.exclude), new Set(overrides.keep));
  const totals = lemmaCounts(freq, cands, dict.lemmas);
  const ranked = rankLemmas(totals, dict.lemmas);
  const words = baseWords(ranked, dict.lemmas, overrides.tr);
  const groups = ranked.map((g, i) => ({ id: groupId(dict.lemmas[g.key]), members: g.members, word: words[i] }));
  const ids = new Set(groups.map((g) => g.id));
  console.log(`ranked by frequency: ${groups.length}`);

  // Rescue: words that are frequent tokens themselves but lost the whole count to another
  // reading ("ihr" to sie, "super" to Super), and the articles the presets leave out, by token count.
  const tokenCount = new Map(freq);
  const exclude = new Set(overrides.exclude);
  const rescued = new Map();
  for (const [key, rec] of Object.entries(dict.lemmas)) {
    const why = exclusionReason(rec);
    const ok = !why || why === 'article' || (why === 'noise' && rec.rawPos === 'pron');
    const count = tokenCount.get(rec.word.toLowerCase());
    if (!ok || !count || exclude.has(key) || ids.has(groupId(rec))) continue;
    if (why && !rec.tr.en.length && !rec.tr.ru.length) continue;
    const id = groupId(rec);
    if (!rescued.has(id)) rescued.set(id, { id, count, members: [] });
    rescued.get(id).members.push(key);
  }
  for (const g of [...rescued.values()].sort((a, b) => b.count - a.count || (a.id < b.id ? -1 : 1))) {
    ids.add(g.id);
    groups.push({
      id: g.id,
      members: g.members,
      word: baseWords([{ key: g.members[0], members: g.members }], dict.lemmas, overrides.tr)[0],
      tokenCount: g.count,
    });
  }
  console.log(`rescued frequent tokens: ${rescued.size}`);

  // Fill: nouns/verbs/adjectives with translations that the 50k list never saw, richest first.
  // Words that are themselves frequent tokens lost to another reading ("Habe" next to haben).
  const tokens = new Set(freq.map(([t]) => t));
  const fill = [];
  for (const [key, rec] of Object.entries(dict.lemmas)) {
    if (!FILL_POS.has(rec.rawPos) || exclusionReason(rec)) continue;
    if (ids.has(groupId(rec)) || tokens.has(rec.word.toLowerCase())) continue;
    fill.push({ key, rec, score: (rec.trCount ?? 0) * 2 + (rec.senses ?? 0) + (rec.tr.ru.length && rec.tr.en.length ? 4 : 0) });
  }
  fill.sort((a, b) => b.score - a.score || a.rec.word.localeCompare(b.rec.word));
  const seen = new Set();
  for (const { key, rec } of fill) {
    const id = groupId(rec);
    if (seen.has(id)) continue;
    seen.add(id);
    groups.push({ id, members: [key], word: baseWords([{ key, members: [key] }], dict.lemmas, overrides.tr)[0] });
  }

  // Preset words always stay in, whatever their position.
  const selected = groups.filter((g, i) => i < MAX_LEMMAS || levels.has(g.id));
  const inPresets = new Set(selected.map((g) => g.id));
  const missing = [...levels.keys()].filter((k) => !inPresets.has(k));
  if (missing.length) console.warn(`  ⚠ ${missing.length} preset words not in the dictionary: ${missing.slice(0, 10).join(', ')}`);
  selected.forEach((g, i) => (g.rank = i + 1));
  // Rescued words ("die", "ihr", "man") sit after the ranking in the list, but their rank should
  // reflect their own frequency: the rank they'd have among the ranked words (ties allowed, so
  // the ranks of the ranked words — shared with public/levels — don't move).
  const counts = ranked.map((r) => r.count);
  for (const g of selected) {
    if (g.tokenCount === undefined) continue;
    let lo = 0;
    let hi = counts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (counts[mid] > g.tokenCount) lo = mid + 1;
      else hi = mid;
    }
    g.rank = Math.min(g.rank, lo + 1);
  }
  console.log(`selected: ${selected.length} (fill ${Math.max(0, selected.length - ranked.length)})`);
  return selected;
}

/** LexEntry for a group, with the short id (term, or term#pos for the rarer homograph). */
function toEntries(groups, levels, presetTr) {
  const used = new Set();
  let filled = 0;
  for (const g of groups) {
    const w = g.word;
    g.entry = {
      term: w.term,
      pos: w.pos,
      genders: w.genders,
      plural: w.plural,
      praeteritum: w.praeteritum,
      partizip2: w.partizip2,
      auxiliary: w.auxiliary,
      // Meanings by "; ", synonyms by ", " (as in public/levels).
      tr: { ru: formatMeanings(w.tr.ru), en: formatMeanings(w.tr.en) },
      rank: g.rank,
    };
    const level = levels.get(g.id);
    if (level) g.entry.level = level;
    // Preset words: an empty language comes from the committed level files (no new requests).
    const preset = presetTr.get(g.id);
    for (const lang of ['ru', 'en']) {
      if (!g.entry.tr[lang] && preset?.[lang]) {
        g.entry.tr[lang] = preset[lang];
        filled++;
      }
    }
    g.lid = used.has(w.term) ? `${w.term}#${w.pos}` : w.term;
    used.add(w.term);
  }
  console.log(`translations filled from public/levels: ${filled}`);
}

/** Step 3: stream the dump once for forms tables and form-of entries of the selected lemmas. */
async function collectForms(groups, dict) {
  const idOfKey = new Map();
  for (const g of groups) for (const k of g.members) idOfKey.set(k, g.lid);
  const byWord = keysByWord(dict.lemmas);
  const forms = new Map(); // form → Set(id)
  const imperative = new Map();
  const separable = new Map(); // "rief" → anrufen, … (from "rief an")
  const add = (map, form, id) => {
    if (!plausibleToken(form)) return;
    let s = map.get(form);
    if (!s) map.set(form, (s = new Set()));
    s.add(id);
  };
  const input = fs.createReadStream(need(path.join(CACHE, 'raw-wiktextract-data.jsonl.gz'))).pipe(zlib.createGunzip());
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  let n = 0;
  for await (const line of rl) {
    if (++n % 500000 === 0) console.log(`  …${n} lines`);
    if (!line.includes('"lang_code": "de"')) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.lang_code !== 'de' || !entry.word) continue;
    const rec = parseKaikkiEntry(entry);
    if (!rec) continue;
    if (rec.kind === 'form') {
      const form = rec.word.toLowerCase();
      for (const l of rec.lemmas) {
        for (const k of resolveTarget(`${l}|?${rec.rawPos}`, dict.lemmas, byWord)) {
          const id = idOfKey.get(k);
          if (id) add(rec.imperative ? imperative : forms, form, id);
        }
      }
      continue;
    }
    const id = idOfKey.get(`${rec.word}|${rec.rawPos}`);
    // Pronoun/article paradigms list other words ("ich" lists "wir"): only content words map forms.
    if (!id || ['pron', 'det', 'article', 'num'].includes(rec.rawPos)) continue;
    const fs_ = formsOfEntry(entry);
    for (const f of fs_.forms) add(forms, f, id);
    for (const f of fs_.separable) add(separable, f, id);
  }
  // Contractions and article forms are not in Wiktionary's tables: map them by hand.
  for (const [form, term] of Object.entries(HAND_FORMS)) {
    const g = groups.find((x) => x.entry.term === term);
    if (g) forms.set(form, new Set([...(forms.get(form) ?? []), g.lid]));
  }
  // Imperative-only readings ("schon!" of schonen) only when the token has no other reading.
  for (const [f, s] of imperative) if (!forms.has(f)) forms.set(f, s);
  // "ging" is the past of gehen and of ~40 particle verbs ("ging aus", "ging weg"): keep the
  // MAX_SEPARABLE most frequent particle verbs next to the direct readings.
  const rank = new Map(groups.map((g) => [g.lid, g.rank]));
  const pos = new Map(groups.map((g) => [g.lid, g.entry.pos]));
  for (const [f, s] of separable) {
    const own = forms.get(f) ?? new Set();
    // Only next to a verb reading ("rief" of rufen), not for "tische" (Tisch, "tische auf").
    if (own.size && ![...own].some((id) => pos.get(id) === 'verb')) continue;
    const extra = [...s].filter((id) => !own.has(id)).sort((a, b) => rank.get(a) - rank.get(b)).slice(0, MAX_SEPARABLE);
    if (extra.length) forms.set(f, new Set([...own, ...extra]));
  }
  console.log(`  ${n} lines, ${forms.size} forms`);
  return forms;
}

const sizeOf = (v) => Buffer.byteLength(JSON.stringify(v));
const kb = (b) => `${(b / 1024).toFixed(1)} KB`;

/**
 * Lemmas ranked 1..n (plus every preset word) and the forms the map has to store for them.
 * Not stored: a form that is the lemma itself (lemma lookup finds "tisch"), and a form the
 * runtime's ending rules resolve to exactly its lemmas ("tische" → Tisch). Sizes are the
 * serialised bytes of each `"key":value,` pair.
 */
function layout(groups, rawForms, count, n) {
  const kept = groups.filter((g) => g.rank <= n || g.entry.level);
  const rank = new Map(kept.map((g) => [g.lid, g.rank]));
  const byLower = new Map();
  for (const g of kept) {
    const k = g.entry.term.toLowerCase();
    if (!byLower.has(k)) byLower.set(k, []);
    byLower.get(k).push(g.lid);
  }
  const forms = [];
  for (const [form, set] of rawForms) {
    const same = byLower.get(form) ?? [];
    // A form that is also a lemma keeps only its other readings ("war" → sein).
    const ids = [...set].filter((id) => rank.has(id) && !same.includes(id)).sort((a, b) => rank.get(a) - rank.get(b));
    if (!ids.length) continue;
    if (!same.length) {
      const hits = new Set();
      for (const c of ruleCandidates(form)) for (const id of byLower.get(c) ?? []) hits.add(id);
      if (hits.size === ids.length && ids.every((id) => hits.has(id))) continue;
    }
    forms.push({ form, ids, count: count.get(form) ?? 0, best: rank.get(ids[0]) });
  }
  // Most valuable first: corpus frequency, then the rank of the lemma.
  forms.sort((a, b) => b.count - a.count || a.best - b.best || (a.form < b.form ? -1 : 1));
  for (const f of forms) f.bytes = sizeOf(f.form) + sizeOf(f.ids) + 2;
  const lemmaBytes = kept.reduce((s, g) => s + sizeOf(g.lid) + sizeOf(encodeEntry(g.entry)) + 2, 0);
  return {
    kept,
    forms,
    lemmaBytes,
    size() {
      return this.lemmaBytes + this.forms.reduce((s, f) => s + f.bytes, 0);
    },
  };
}

/** Step 5: fit the budget. Forms outside the frequency list go first, then the lemma tail. */
function fit(groups, rawForms, count) {
  let L = layout(groups, rawForms, count, groups.length);
  console.log(`untrimmed: ${L.kept.length} lemmas, ${L.forms.length} forms, ~${kb(L.size())}`);
  const max = MAX_BYTES - OVERHEAD;
  if (L.size() <= max) return L;
  let size = L.size();
  while (L.forms.length && !L.forms.at(-1).count && size > max) size -= L.forms.pop().bytes;
  if (size <= max) return L;
  const frequent = (l) => ((l.forms = l.forms.filter((f) => f.count)), l);
  console.log(`with frequent forms only: ~${kb(frequent(L).size())}; trimming the lemma tail…`);
  let lo = 1;
  let hi = groups.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (frequent(layout(groups, rawForms, count, mid)).size() <= max) lo = mid;
    else hi = mid - 1;
  }
  return frequent(layout(groups, rawForms, count, lo));
}

async function main() {
  const freq = parseFrequency(fs.readFileSync(need(path.join(CACHE, 'de_50k.txt')), 'utf8'));
  const dict = readJson(need(path.join(CACHE, 'dict.json')));
  const overrides = readJson(path.join(ROOT, 'scripts/levels/overrides.json'));
  const levels = presetLevels();

  const groups = selectLemmas(freq, dict, overrides, levels);
  toEntries(groups, levels, presetTranslations());

  console.log('Reading forms from the Wiktionary dump…');
  const rawForms = await collectForms(groups, dict);
  const { kept, forms } = fit(groups, rawForms, new Map(freq));

  // Step 4: pieces by the first two letters of normalizeKey; small neighbours share a file.
  const pieces = new Map(); // prefix → {lemmas, forms}
  const piece = (p) => {
    if (!pieces.has(p)) pieces.set(p, { lemmas: {}, forms: {} });
    return pieces.get(p);
  };
  for (const g of kept) piece(prefixOf(g.entry.term)).lemmas[g.lid] = encodeEntry(g.entry);
  for (const f of [...forms].sort((a, b) => (a.form < b.form ? -1 : 1))) piece(prefixOf(f.form)).forms[f.form] = f.ids;
  // Big prefixes ("sc", "ge", "ve") are split by their next letter ("sch", then "scha", …), at
  // most to 4 letters; the shorter key keeps the shorter words. The runtime takes the longest
  // key in the index that the word starts with (pieceFile in lib.mjs).
  for (let len = 3; len <= 4; len++) {
    for (const [p, x] of [...pieces]) {
      if (p.length !== len - 1 || sizeOf(x) <= MAX_PIECE) continue;
      const rest = { lemmas: {}, forms: {} };
      pieces.set(p, rest);
      const sub = (w) => {
        const k = normalizeKey(w).slice(0, len);
        if (k.length < len) return rest;
        if (!pieces.has(k)) pieces.set(k, { lemmas: {}, forms: {} });
        return pieces.get(k);
      };
      for (const [id, e] of Object.entries(x.lemmas)) sub(id.split('#')[0]).lemmas[id] = e;
      for (const [f, ids] of Object.entries(x.forms)) sub(f).forms[f] = ids;
    }
  }
  const files = groupPieces(new Map([...pieces].map(([p, x]) => [p, sizeOf(x)])), { min: MIN_PIECE });

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const index = { version: 1, sources: SOURCES, count: kept.length, pieces: {} };
  let bytes = 0;
  const fileSizes = [];
  for (const f of files) {
    const out = { lemmas: {}, forms: {} };
    for (const p of f.prefixes) {
      Object.assign(out.lemmas, pieces.get(p).lemmas);
      Object.assign(out.forms, pieces.get(p).forms);
      index.pieces[p] = `${f.name}.json`;
    }
    const text = JSON.stringify(out);
    fs.writeFileSync(path.join(OUT, `${f.name}.json`), text);
    bytes += Buffer.byteLength(text);
    fileSizes.push([f.name, Buffer.byteLength(text)]);
  }
  const indexText = JSON.stringify(index);
  fs.writeFileSync(path.join(OUT, 'index.json'), indexText);
  bytes += Buffer.byteLength(indexText);

  // Step 6: sanity report.
  fileSizes.sort((a, b) => a[1] - b[1]);
  const miss = (l) => kept.filter((g) => !g.entry.tr[l]).length;
  console.log(`\nLemmas ${kept.length} (${kept.filter((g) => g.entry.level).length} with a level), last #${kept.at(-1).rank} ${kept.at(-1).entry.term}`);
  console.log(`Forms ${forms.length} stored (${forms.filter((f) => f.count).length} in the frequency list); regular forms are left to the ending rules`);
  console.log(`Without ru ${miss('ru')}, without en ${miss('en')}`);
  const top = kept.filter((g) => g.rank <= 8000);
  const pctRu = (list) => ((100 * list.filter((g) => g.entry.tr.ru).length) / list.length).toFixed(1);
  console.log(`RU coverage: ${pctRu(kept)}% overall, ${pctRu(top)}% of the top 8000`);
  console.log(`Files ${files.length} pieces + index.json (${kb(Buffer.byteLength(indexText))}), total ${kb(bytes)} (budget ${kb(MAX_BYTES)})`);
  const pct = (q) => fileSizes[Math.min(fileSizes.length - 1, Math.floor(q * fileSizes.length))];
  console.log(`Piece sizes: min ${pct(0)[0]} ${kb(pct(0)[1])}, median ${kb(pct(0.5)[1])}, 90% ${kb(pct(0.9)[1])}, max ${pct(1)[0]} ${kb(pct(1)[1])}`);
  console.log('\nLookups (lemma, else forms map, else ending rules):');
  const load = (w) => {
    const file = pieceFile(index.pieces, w);
    return file ? readJson(path.join(OUT, file)) : { lemmas: {}, forms: {} };
  };
  const show = (id) => {
    const term = id.split('#')[0];
    const e = load(term).lemmas[id];
    if (!e) return `${id} (?)`;
    const gram = e.slice(4).map((s) => expandForm(term, s));
    return `${id} #${e[0]} [${e[1]}] ru: ${e[2] || '–'} | en: ${e[3] || '–'}${gram.length ? ` | ${gram.join(', ')}` : ''}`;
  };
  for (const w of ['ging', 'Häuser', 'rief', 'schöneren', 'war', 'Hausschlüssel', 'Tisch', 'Tische', 'Ging']) {
    const p = load(w);
    const lower = w.toLowerCase();
    const cap = lower[0].toUpperCase() + lower.slice(1);
    const lemmaIds = Object.keys(p.lemmas).filter((id) => [w, cap, lower].includes(id.split('#')[0]));
    let how = 'lemma';
    let ids = [...lemmaIds, ...(p.forms[lower] ?? [])];
    if (!lemmaIds.length && !p.forms[lower]) {
      how = 'rule';
      const cands = new Set(ruleCandidates(lower));
      ids = Object.keys(p.lemmas).filter((id) => cands.has(id.split('#')[0].toLowerCase()));
    } else if (!lemmaIds.length) how = 'form';
    console.log(`  ${w} (${ids.length ? how : '—'})${ids.map((id) => `\n      ${show(id)}`).join('')}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
