// @ts-nocheck
// Levels of the words outside the Goethe lists. No official list exists above B1, so these are
// estimates (pure functions): an obvious compound of listed words is B2; else DAFlex (CEFRLex),
// which counts words in graded learner materials, gives the first level a word is really used at;
// else its frequency band. On the Goethe lists DAFlex lands within one level 84 % of the time, film
// subtitles 57 %, so it goes first. A word nothing lists is never below B2: A1–B1 stay Goethe's.
import { frequencyLevel } from './words.mjs';

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
/** A level counts once this many documents of it use the word; 2 when no level reaches it. */
const MIN_DOCS = 3;
const MIN_DOCS_LAST = 2;

const kindOfTag = (tag) => (tag === 'NN' || tag === 'NE' ? 'noun' : tag === 'V' ? 'verb' : 'other');
const kindOfPos = (pos) => (pos === 'noun' || pos === 'verb' ? pos : 'other');

/** DAFlex TSV → Map "word|kind" → documents using it per level [A1 … C2]. */
export function parseDaflex(text) {
  const docs = new Map();
  const unquote = (s) => s.replace(/^"|"$/g, '');
  for (const line of text.trim().split('\n').slice(1)) {
    const cells = line.split('\t').map(unquote);
    const key = `${cells[0].normalize('NFC').toLowerCase()}|${kindOfTag(cells[1])}`;
    const counts = cells.slice(9, 15).map(Number);
    const seen = docs.get(key);
    docs.set(key, seen ? seen.map((n, i) => n + counts[i]) : counts);
  }
  return docs;
}

/** First level in which enough documents use a word, or null on too little evidence. */
export function firstLevel(counts) {
  if (!counts) return null;
  for (const min of [MIN_DOCS, MIN_DOCS_LAST]) {
    const i = counts.findIndex((n) => n >= min);
    if (i >= 0) return LEVELS[i];
  }
  return null;
}

/** Joints between the parts of a compound: Arbeit-s-zeit, Kind-er-zimmer, Tag-es-licht. */
const JOINTS = ['', 's', 'n', 'en', 'e', 'es', 'er'];

/**
 * The parts of a noun made of two listed words, longest head first: "Arbeitszeit" → ["arbeit",
 * "zeit"], or null. `modifiers` may be nouns, verb stems or adjectives (lower case); `heads` nouns.
 */
export function splitCompound(term, modifiers, heads) {
  const word = term.toLowerCase();
  for (let i = 3; i <= word.length - 3; i++) {
    const head = word.slice(i);
    if (!heads.has(head)) continue;
    for (const joint of JOINTS) {
      if (!word.slice(0, i).endsWith(joint)) continue;
      const first = word.slice(0, i - joint.length);
      if (first.length >= 3 && [first, `${first}e`, `${first}en`].some((m) => modifiers.has(m))) return [first, head];
    }
  }
  return null;
}

/** Lower-case A1–B1 vocabulary for splitCompound: { modifiers, heads }. */
export function compoundParts(words) {
  const modifiers = new Set();
  const heads = new Set();
  for (const w of words) {
    if (!w.level || LEVELS.indexOf(w.level) > 2 || w.term.length < 3) continue;
    const term = w.term.toLowerCase();
    if (w.pos === 'noun') heads.add(term);
    if (w.pos === 'noun' || w.pos === 'adj') modifiers.add(term);
    if (w.pos === 'verb') modifiers.add(term.replace(/e?n$/, ''));
  }
  return { modifiers, heads };
}

/**
 * Give every word without a Goethe level its `level` and `levelBy` ("compound", "daflex",
 * "frequency"). `notCompound` (goethe.json) holds nouns that only look like compounds ("Legende")
 * or whose meaning isn't that of their parts, Goethe's own exception ("Handschuh").
 */
export function gradeRest(words, daflex, notCompound = []) {
  const { modifiers, heads } = compoundParts(words);
  const no = new Set(notCompound);
  for (const w of words) {
    if (w.level) continue;
    if (w.pos === 'noun' && !no.has(w.term) && splitCompound(w.term, modifiers, heads)) {
      w.level = 'B2';
      w.levelBy = 'compound';
      continue;
    }
    const counts = daflex.get(`${w.term.toLowerCase()}|${kindOfPos(w.pos)}`);
    const first = firstLevel(counts);
    w.level = first ? LEVELS[Math.max(LEVELS.indexOf(first), 3)] : frequencyLevel(w.rank);
    w.levelBy = first ? 'daflex' : 'frequency';
  }
}
