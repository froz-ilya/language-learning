// @ts-check
// Reverse dictionary (Russian / English → German), shared by scripts/dict/reverse.mjs and its
// test. The runtime twin is src/lib/dict/reverse.ts: B64, revNormalize, revTokens, revKey, STOP
// and the decoding of the format below must stay identical (src/lib/dict/reverse.test.ts checks
// this by decoding what this file encodes).
//
// Format (version 2) — public/dict/rev/, built from the committed dictionary pieces:
//   index.json          { version, tags: string[], langs: { ru: { files: string[], keys: { [key]: n } }, en: … } }
//   <lang>-<hash>.json  { [key]: block } — files[n]; the name changes with the content, so a
//                       cached old file is never paired with a new index
// A token is a normalised word of a translation (revTokens, stop words left out). A key is the
// first two letters of a token (revKey) or, where that would make a file too big, a longer
// prefix; a token lives under the longest key it starts with, and index.langs[lang].keys maps
// every key to its file. A block holds the tokens of one key, sorted, as "<"-separated records:
//   S rest ">" postings
//   S       base-64 digit: letters the token's suffix (token minus key) shares with the previous
//           record's suffix ("front coding"); rest = the remaining letters
//   postings  "|"-separated, best first, at most CAP per token; one per German entry:
//     VVVV id [~text]
//     VVVV  base-64 number ((rank × 64 + tag) × 8 + flags), most significant digit first:
//           rank = frequency rank (1 = most common, capped at MAX_RANK), tag = index into
//           `tags` (the entry's compact tags: pos, genders/auxiliary, level), flags = meaning
//           index × 2 + kind (kind 0: a synonym is just this word; 1: the word is part of a
//           longer synonym, "телефон" in "мобильный телефон")
//     id    dictionary id ("Steuer#f")
//     text  the matched synonym as written when it isn't exactly the token, with the token
//           itself written "^" ("мобильный ^", "ёлка", "^ / выполнять")
// Full translations are not repeated here (that would multiply the size): the German entry with
// all its meanings is one lookupLocal() away.
import { createHash } from 'node:crypto';

/** Digits of the base-64 fields. */
export const B64 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_';
/** Highest rank a posting holds; rarer words are stored with this rank. */
export const MAX_RANK = 2 ** 15 - 1;
/** Meanings after the 4th count as the 4th (flags hold 0–3). */
export const MAX_MEANING = 3;
/** Most postings kept per token: the best ones (ranking only ever shows the top few). */
export const CAP = 50;
/** Synonyms of more words than this are descriptions, not translations: not indexed. */
export const MAX_WORDS = 3;
/** Largest shard file in bytes. */
export const MAX_FILE = 28000;

/** Combining breve: NFD splits й into и + this mark, which must survive. */
const BREVE = String.fromCharCode(0x306);

/** Lower-case, ё→е, stress marks and other accents removed (й stays й). @param {string} text */
export function revNormalize(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, (/** @type {string} */ m) => (m === BREVE ? m : ''))
    .normalize('NFC');
}

/** Words of a translation ("мобильный телефон, сотовый" → мобильный, телефон, сотовый). @param {string} text */
export function revTokens(text) {
  return revNormalize(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** Shard key of a token: its first two letters (longer prefixes where a key is split). */
export const revKey = (/** @type {string} */ token) => token.slice(0, 2);

/** Words that don't identify a meaning ("to go", "something", "кого-либо"); never indexed. */
export const STOP = new Set([
  'to', 'a', 'an', 'the', 'of', 'or', 'and', 'be', 'one', "one's", 'oneself', 'someone', 'somebody',
  'something', 'sb', 'sth', 'smb', 'smth', 'with', 'for', 'in', 'on', 'at', 'by', 's',
  'и', 'или', 'кого', 'кому', 'чего', 'чему', 'что', 'то', 'либо', 'нибудь', 'себя', 'себе', 'в', 'на', 'с', 'к', 'о', 'по', 'за', 'для',
]);

/** Words of a text that identify it: revTokens without stop words. */
export const revWords = (/** @type {string} */ text) => revTokens(text).filter((t) => !STOP.has(t));

/**
 * A synonym as it should be shown and matched: Wiktionary leftovers removed — parenthesised
 * notes, an unclosed "(" and everything after it, stray ")" and footnote marks
 * ("справляться / справиться (&lsqb" → "справляться / справиться", "ворона ¹)" → "ворона").
 * @param {string} text
 */
export function cleanSynonym(text) {
  return text
    .replace(/\([^()]*\)/g, ' ')
    .replace(/\(.*$/, ' ')
    .replace(/[^\p{L}\p{M}\p{N}\s'’\-/.]/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s/.-]+|[\s/-]+$/g, '')
    .trim();
}

/** "a, b; c" → [[a, b], [c]] with cleaned synonyms (empty ones dropped). @param {string} translation */
export function meaningsOf(translation) {
  return translation
    .split(';')
    .map((m) => m.split(',').map(cleanSynonym).filter(Boolean))
    .filter((m) => m.length);
}

/** Variants of a synonym ("cell phone / cellphone" → both), each as its words. */
export const variantsOf = (/** @type {string} */ synonym) => synonym.split('/').map(revWords).filter((w) => w.length);

/** Splits text into words and the separators between them (odd indexes are separators). */
const WORD_PARTS = /([^\p{L}\p{M}\p{N}]+)/u;

/**
 * "мобильный телефон" with token "телефон" → "мобильный ^" (only words written exactly so).
 * @param {string} text
 * @param {string} token
 */
export function markToken(text, token) {
  return text
    .split(WORD_PARTS)
    .map((part, i) => (i % 2 === 0 && part === token ? '^' : part))
    .join('');
}

/**
 * @typedef {{ id: string, rank: number, tags: string, tr: string }} RevSource an entry with its
 *   translation in one language
 * @typedef {{ id: string, rank: number, tags: string, kind: number, meaning: number, len: number, text: string }} Posting
 * @typedef {{ version: number, tags: string[], langs: Record<string, { files: string[], keys: Record<string, number> }> }} RevIndex
 */

/**
 * The postings of one language, best first per token: Map token → postings.
 * Per (token, entry) the best synonym counts: one that is just the word (kind 0), then the
 * earliest meaning, then the fewest words. A token's postings are sorted by kind, meaning, rank.
 * @param {RevSource[]} entries
 * @param {{ cap?: number, maxWords?: number }} [opts]
 */
export function buildPostings(entries, { cap = CAP, maxWords = MAX_WORDS } = {}) {
  /** @type {Map<string, Posting[]>} */
  const byToken = new Map();
  for (const e of entries) {
    if (!e.tr) continue;
    /** @type {Map<string, { kind: number, meaning: number, len: number, text: string }>} */
    const best = new Map();
    meaningsOf(e.tr).forEach((syns, mi) => {
      const meaning = Math.min(mi, MAX_MEANING);
      for (const syn of syns) {
        for (const words of variantsOf(syn)) {
          if (words.length > maxWords) continue;
          for (const t of new Set(words)) {
            const cand = { kind: words.length === 1 ? 0 : 1, meaning, len: words.length, text: syn };
            const cur = best.get(t);
            if (!cur || (cand.kind - cur.kind || cand.meaning - cur.meaning || cand.len - cur.len) < 0) best.set(t, cand);
          }
        }
      }
    });
    for (const [t, b] of best) {
      if (t.length < 2) continue;
      let list = byToken.get(t);
      if (!list) byToken.set(t, (list = []));
      list.push({ id: e.id, rank: e.rank, tags: e.tags, ...b });
    }
  }
  for (const [t, list] of byToken) {
    list.sort((a, b) => a.kind - b.kind || a.meaning - b.meaning || a.rank - b.rank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    byToken.set(t, list.slice(0, cap));
  }
  return byToken;
}

/**
 * Non-negative integer → `digits` base-64 digits, most significant first.
 * @param {number} n
 * @param {number} digits
 */
export function toB64(n, digits) {
  let s = '';
  for (let i = 0; i < digits; i++, n = Math.floor(n / 64)) s = B64[n % 64] + s;
  return s;
}

/**
 * Encodes one posting (see the format above).
 * @param {Posting} p
 * @param {string} token
 * @param {Map<string, number>} tagIndex
 */
export function encodePosting(p, token, tagIndex) {
  const tag = tagIndex.get(p.tags);
  if (tag === undefined || tag >= 64) throw new Error(`tags "${p.tags}" not in the tag table`);
  const rank = Math.min(Math.max(Math.round(p.rank), 0), MAX_RANK);
  const text = p.text === token ? '' : `~${markToken(p.text, token)}`;
  return toB64((rank * 64 + tag) * 8 + p.meaning * 2 + p.kind, 4) + p.id + text;
}

/**
 * A key's block: its tokens (sorted) front-coded, each with its postings.
 * @param {string} key
 * @param {[string, string][]} tokens [token, postings] sorted by token
 */
export function encodeBlock(key, tokens) {
  let prev = '';
  return tokens
    .map(([t, postings]) => {
      const suffix = t.slice(key.length);
      let shared = 0;
      while (shared < 63 && shared < prev.length && shared < suffix.length && prev[shared] === suffix[shared]) shared++;
      prev = suffix;
      return `${B64[shared]}${suffix.slice(shared)}>${postings}`;
    })
    .join('<');
}

/**
 * Shard files for one language: tokens grouped by key (revKey, split into longer prefixes while
 * a key is too big for one file), keys packed in order into files of at most maxFile bytes.
 * @param {Map<string, string>} encoded token → postings
 * @returns {{ keys: Record<string, number>, files: Record<string, string>[] }}
 */
export function packShards(encoded, maxFile = MAX_FILE) {
  const bytes = (/** @type {string} */ s) => Buffer.byteLength(s);
  const sizeOf = (/** @type {string[]} */ tokens) => tokens.reduce((n, t) => n + bytes(t) + bytes(/** @type {string} */ (encoded.get(t))) + 2, 8);
  /** @type {Map<string, string[]>} */
  const groups = new Map();
  for (const t of [...encoded.keys()].sort()) {
    const k = revKey(t);
    let g = groups.get(k);
    if (!g) groups.set(k, (g = []));
    g.push(t);
  }
  /** @type {[string, string[]][]} keys with their tokens */
  const leaves = [];
  const split = (/** @type {string} */ key, /** @type {string[]} */ tokens) => {
    if (sizeOf(tokens) <= maxFile || key.length >= 8) {
      leaves.push([key, tokens]);
      return;
    }
    // Split off the biggest next-letter groups until the rest fits.
    /** @type {Map<string, string[]>} */
    const children = new Map();
    for (const t of tokens) {
      if (t.length <= key.length) continue;
      const ck = t.slice(0, key.length + 1);
      let c = children.get(ck);
      if (!c) children.set(ck, (c = []));
      c.push(t);
    }
    let rest = tokens;
    for (const [ck, c] of [...children].sort((a, b) => sizeOf(b[1]) - sizeOf(a[1]))) {
      if (sizeOf(rest) <= maxFile) break;
      rest = rest.filter((t) => !t.startsWith(ck));
      split(ck, c);
    }
    leaves.push([key, rest]);
  };
  for (const [k, tokens] of groups) split(k, tokens);
  leaves.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  /** @type {Record<string, number>} */
  const keys = {};
  /** @type {Record<string, string>[]} */
  const files = [];
  /** @type {Record<string, string> | null} */
  let cur = null;
  let curSize = 0;
  for (const [key, tokens] of leaves) {
    if (!tokens.length) continue;
    const block = encodeBlock(key, tokens.map((t) => [t, /** @type {string} */ (encoded.get(t))]));
    const size = bytes(JSON.stringify(block)) + bytes(JSON.stringify(key)) + 2;
    if (!cur || curSize + size > maxFile) {
      files.push((cur = {}));
      curSize = 2;
    }
    cur[key] = block;
    curSize += size;
    keys[key] = files.length - 1;
  }
  return { keys, files };
}

/**
 * The whole reverse dictionary from the entries of each language.
 * @param {Record<string, RevSource[]>} entriesByLang
 * @param {{ cap?: number, maxWords?: number, maxFile?: number }} [opts]
 * @returns {{ index: RevIndex, files: Map<string, string> }}
 */
export function buildReverse(entriesByLang, { cap = CAP, maxWords = MAX_WORDS, maxFile = MAX_FILE } = {}) {
  /** @type {Map<string, number>} */
  const tagCount = new Map();
  for (const list of Object.values(entriesByLang)) for (const e of list) tagCount.set(e.tags, (tagCount.get(e.tags) ?? 0) + 1);
  const tags = [...tagCount.keys()].sort((a, b) => (tagCount.get(b) ?? 0) - (tagCount.get(a) ?? 0) || (a < b ? -1 : 1));
  if (tags.length > 64) throw new Error(`${tags.length} distinct tags; the format holds 64`);
  const tagIndex = new Map(tags.map((t, i) => [t, i]));
  /** @type {RevIndex} */
  const index = { version: 2, tags, langs: {} };
  /** @type {Map<string, string>} */
  const files = new Map();
  for (const [lang, entries] of Object.entries(entriesByLang)) {
    /** @type {Map<string, string>} */
    const encoded = new Map();
    for (const [t, list] of buildPostings(entries, { cap, maxWords })) encoded.set(t, list.map((p) => encodePosting(p, t, tagIndex)).join('|'));
    const packed = packShards(encoded, maxFile);
    const names = packed.files.map((f) => {
      const text = JSON.stringify(f);
      const name = `${lang}-${createHash('sha1').update(text).digest('hex').slice(0, 8)}.json`;
      files.set(name, text);
      return name;
    });
    index.langs[lang] = { files: names, keys: packed.keys };
  }
  return { index, files };
}
