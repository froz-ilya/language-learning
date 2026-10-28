// Reverse dictionary runtime (Russian / English → German), built by scripts/dict/reverse.mjs
// into public/dict/rev/ (format: scripts/dict/reverse-lib.mjs). Results are always German
// dictionary entries.
//
// Matching and ranking. The query and the translations are normalised the same way (revNormalize:
// lower case, ё→е, stress marks removed) and split into words; stop words ("to", "the", "кого",
// "что", …) are ignored on both sides, so "to walk" finds "walk". Every synonym of a meaning is
// compared on its own, and so is each "/" variant of it ("cell phone / cellphone"). A German entry
// matches in its best tier:
//   0  a synonym is exactly the query ("налог" → die Steuer; "мобильный телефон" → das Handy)
//   1  every query word is a word of one synonym ("телефон" → das Handy, "мобильный телефон")
//   2  as 1, but the last query word (3+ letters) only begins a word — the user is still typing
//      ("нал" → налог, наличные…)
// Hits are sorted by tier, then by meaning (a German word whose first meaning matches beats one
// whose second does: "скамейка" → Bank, whose meanings are "скамейка; банк"), then by frequency
// rank, and are deduplicated by id. Nouns whose articles differ in meaning are separate entries
// ("See" der See / "See#f" die See) and so separate hits, each with its own article.
//
// Loading: index.json once (kept in memory), then the shard file of each query word — 1 file for a
// one-word query, typically 1–2 otherwise. A failed fetch is forgotten so a later call retries;
// offline before the files were cached, searches return [].
import type { Auxiliary, Gender, Lang, Pos } from '../types';
import { LEVELS } from '../levels/types';
import type { LexEntry } from './types';

/** A German word found by one of its translations. */
export interface ReverseHit {
  /** Dictionary id ("Steuer#f"); open it with lookupLocal(entry.term) / articleVariants. */
  id: string;
  /**
   * The German entry: term, pos, genders, auxiliary, rank, level. Its tr holds only the matched
   * translation, in the searched language (the reverse index doesn't repeat whole translations);
   * lookupLocal(entry.term) gives every meaning, plural and verb forms.
   */
  entry: LexEntry;
  /** The translation that matched, in the searched language, as written ("налог", "мобильный телефон"). */
  translation: string;
}

/** Language a typed query is in: Cyrillic → 'ru'; Latin → German or English ('latin'). */
export function queryScript(query: string): 'ru' | 'latin' | 'none' {
  if (/\p{Script=Cyrillic}/u.test(query)) return 'ru';
  if (/\p{Script=Latin}/u.test(query)) return 'latin';
  return 'none';
}

// ---- Shared with scripts/dict/reverse-lib.mjs (keep identical; reverse.test.ts checks) ----

/** Digits of the base-64 fields. */
export const B64 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_';

/** Combining breve: NFD splits й into и + this mark, which must survive. */
const BREVE = String.fromCharCode(0x306);

/** Lower-case, ё→е, stress marks and other accents removed (й stays й). */
export function revNormalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, (m) => (m === BREVE ? m : ''))
    .normalize('NFC');
}

/** Words of a translation ("мобильный телефон, сотовый" → мобильный, телефон, сотовый). */
export function revTokens(text: string): string[] {
  return revNormalize(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** Shard key of a token: its first two letters (longer prefixes where a key is split). */
export const revKey = (token: string): string => token.slice(0, 2);

/** Words that don't identify a meaning ("to go", "something", "кого-либо"); never indexed. */
export const STOP = new Set([
  'to', 'a', 'an', 'the', 'of', 'or', 'and', 'be', 'one', "one's", 'oneself', 'someone', 'somebody',
  'something', 'sb', 'sth', 'smb', 'smth', 'with', 'for', 'in', 'on', 'at', 'by', 's',
  'и', 'или', 'кого', 'кому', 'чего', 'чему', 'что', 'то', 'либо', 'нибудь', 'себя', 'себе', 'в', 'на', 'с', 'к', 'о', 'по', 'за', 'для',
]);

/** Words of a text that identify it: revTokens without stop words. */
export const revWords = (text: string): string[] => revTokens(text).filter((t) => !STOP.has(t));

// ---- Format ----

interface RevIndex {
  version: number;
  /** Compact entry tags ("nf4"), referenced by index from postings. */
  tags: string[];
  /** Per language: shard file names, and key → index into files. */
  langs: Partial<Record<Lang, RevLang>>;
}

interface RevLang {
  files: string[];
  keys: Record<string, number>;
}

/** Shard file: key → block of front-coded tokens with their postings. */
type RevFile = Record<string, string>;

/** One German entry under a token, as stored. */
export interface RevPosting {
  id: string;
  rank: number;
  tags: string;
  /** Meaning of the matched synonym (0-based, 3 = fourth or later). */
  meaning: number;
  /** 0: a synonym is just the token; 1: the token is one word of a longer synonym. */
  kind: number;
  /** The matched synonym as written. */
  text: string;
}

/** A block → token → postings (still encoded). */
export function decodeBlock(key: string, block: string): Map<string, string> {
  const out = new Map<string, string>();
  let prev = '';
  for (const rec of block.split('<')) {
    const gt = rec.indexOf('>');
    const shared = B64.indexOf(rec[0]);
    if (gt < 1 || shared < 0) continue;
    prev = prev.slice(0, shared) + rec.slice(1, gt);
    out.set(key + prev, rec.slice(gt + 1));
  }
  return out;
}

/** A token's encoded postings → postings. Malformed ones are skipped. */
export function decodePostings(token: string, postings: string, tags: readonly string[]): RevPosting[] {
  const out: RevPosting[] = [];
  for (const p of postings.split('|')) {
    if (p.length < 5) continue;
    let v = 0;
    for (let i = 0; i < 4; i++) v = v * 64 + B64.indexOf(p[i]);
    if (!(v >= 0)) continue;
    const rest = p.slice(4);
    const tilde = rest.indexOf('~');
    const id = tilde < 0 ? rest : rest.slice(0, tilde);
    if (!id) continue;
    out.push({
      id,
      rank: Math.floor(v / 512),
      tags: tags[Math.floor(v / 8) % 64] ?? '',
      meaning: (v % 8) >> 1,
      kind: v % 2,
      text: tilde < 0 ? token : rest.slice(tilde + 1).replace(/\^/g, token),
    });
  }
  return out;
}

const POS: Record<string, Pos> = { n: 'noun', v: 'verb', a: 'adj', o: 'other' };

/** Entry from compact tags (same tags as the dictionary pieces, see local.ts). */
function entryOf(id: string, tags: string, rank: number, lang: Lang, translation: string): LexEntry {
  const pos = POS[tags[0]] ?? 'other';
  const genders: Gender[] = [];
  let auxiliary: Auxiliary = '';
  let level: LexEntry['level'];
  for (const c of tags.slice(1)) {
    if (/\d/.test(c)) level = LEVELS[Number(c) - 1];
    else if (pos === 'noun' && (c === 'm' || c === 'f' || c === 'n')) genders.push(c);
    else if (pos === 'verb' && c === 'h') auxiliary = 'haben';
    else if (pos === 'verb' && c === 's') auxiliary = 'sein';
  }
  const entry: LexEntry = {
    term: id.split('#')[0],
    pos,
    genders,
    plural: '',
    praeteritum: '',
    partizip2: '',
    auxiliary,
    tr: { ru: '', en: '', [lang]: translation },
    rank,
  };
  if (level) entry.level = level;
  return entry;
}

// ---- Loading ----

const base = () => `${import.meta.env.BASE_URL}dict/rev/`;

let indexPromise: Promise<RevIndex | null> | null = null;
const filePromises = new Map<string, Promise<RevFile | null>>();
/** Decoded blocks by "<file>/<key>". */
const blocks = new Map<string, Map<string, string>>();

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** The index, fetched once. A failed fetch is forgotten so a later call can retry. */
function loadIndex(): Promise<RevIndex | null> {
  if (!indexPromise) {
    const p = getJson<RevIndex>(`${base()}index.json`).then((index) => {
      if (index?.version !== 2 || !Array.isArray(index.tags) || !index.langs) {
        if (indexPromise === p) indexPromise = null;
        return null;
      }
      return index;
    });
    indexPromise = p;
  }
  return indexPromise;
}

function loadFile(name: string): Promise<RevFile | null> {
  let p = filePromises.get(name);
  if (!p) {
    p = getJson<RevFile>(`${base()}${name}`).then((file) => {
      if (!file || typeof file !== 'object') {
        filePromises.delete(name);
        return null;
      }
      return file;
    });
    filePromises.set(name, p);
  }
  return p;
}

/** The longest key a token starts with, or undefined. */
function keyOf(keys: Record<string, number>, token: string): string | undefined {
  for (let n = Math.min(token.length, 8); n >= 1; n--) if (Object.hasOwn(keys, token.slice(0, n))) return token.slice(0, n);
  return undefined;
}

/** Token → encoded postings of the given keys (loading their files). */
async function loadBlocks(rev: RevLang, wanted: Iterable<string>): Promise<Map<string, string>[]> {
  const list = [...new Set(wanted)];
  return Promise.all(
    list.map(async (key) => {
      const name = rev.files[rev.keys[key]];
      if (typeof name !== 'string') return new Map<string, string>();
      const cacheKey = `${name}/${key}`;
      const cached = blocks.get(cacheKey);
      if (cached) return cached;
      const file = await loadFile(name);
      const raw = file && Object.hasOwn(file, key) ? file[key] : null;
      if (typeof raw !== 'string') return new Map<string, string>();
      const block = decodeBlock(key, raw);
      blocks.set(cacheKey, block);
      return block;
    }),
  );
}

// ---- Search ----

/** Shortest last word that is also matched as the beginning of a word. */
const MIN_PREFIX = 3;

/**
 * Best tier (0–2, see the top of this file) at which `text` (a synonym, maybe with "/"
 * variants) matches the query words, or -1.
 */
export function matchTier(text: string, words: readonly string[], prefix: boolean): number {
  let best = -1;
  for (const variant of text.split('/')) {
    const p = revWords(variant);
    if (!p.length) continue;
    const head = words.slice(0, -1);
    const last = words[words.length - 1];
    if (!head.every((w) => p.includes(w))) continue;
    let tier = -1;
    if (p.includes(last)) tier = p.length === words.length && p.every((w, i) => w === words[i]) ? 0 : 1;
    else if (prefix && p.some((w) => w.startsWith(last))) tier = 2;
    if (tier >= 0 && (best < 0 || tier < best)) best = tier;
  }
  return best;
}

/**
 * German words whose `lang` translation matches `query` (whole translation first, then a word of
 * it, then words starting with the query), more common words first. [] when nothing matches or
 * the index can't be loaded (offline before first use). Never throws.
 */
export async function reverseSearch(query: string, lang: Lang, limit = 12): Promise<ReverseHit[]> {
  try {
    return await search(query, lang, limit);
  } catch {
    return [];
  }
}

async function search(query: string, lang: Lang, limit: number): Promise<ReverseHit[]> {
  if (!(limit > 0)) return [];
  // English queries only search English translations, Cyrillic ones only Russian.
  const script = queryScript(query);
  if (script === 'none' || (script === 'ru' ? 'ru' : 'en') !== lang) return [];
  const words = revWords(query);
  if (!words.length) return [];
  const last = words[words.length - 1];
  // The last word may still be being typed (not when it was a stop word, e.g. "go to").
  const prefix = last.length >= MIN_PREFIX && revTokens(query).at(-1) === last;

  const index = await loadIndex();
  const rev = index?.langs[lang];
  const keys = rev?.keys;
  if (!index || !rev || !keys || !Array.isArray(rev.files)) return [];
  const wanted: string[] = [];
  for (const w of words) {
    const k = keyOf(keys, w);
    if (k) wanted.push(k);
  }
  if (prefix) for (const k of Object.keys(keys)) if (k.length > last.length && k.startsWith(last)) wanted.push(k);
  const loaded = await loadBlocks(rev, wanted);

  // Candidate postings: those of every query word, plus of every token the last word begins.
  const candidates: [string, string][] = [];
  const seen = new Set<string>();
  const add = (token: string, postings: string | undefined) => {
    if (postings === undefined || seen.has(token)) return;
    seen.add(token);
    candidates.push([token, postings]);
  };
  for (const block of loaded) {
    for (const w of words) add(w, block.get(w));
    if (prefix) for (const [t, postings] of block) if (t.startsWith(last)) add(t, postings);
  }

  const best = new Map<string, { p: RevPosting; tier: number }>();
  for (const [token, encoded] of candidates) {
    for (const p of decodePostings(token, encoded, index.tags)) {
      const tier = matchTier(p.text, words, prefix);
      if (tier < 0) continue;
      const cur = best.get(p.id);
      if (!cur || tier < cur.tier || (tier === cur.tier && p.meaning < cur.p.meaning)) best.set(p.id, { p, tier });
    }
  }
  return [...best.values()]
    .sort((a, b) => a.tier - b.tier || a.p.meaning - b.p.meaning || a.p.rank - b.p.rank || (a.p.id < b.p.id ? -1 : a.p.id > b.p.id ? 1 : 0))
    .slice(0, limit)
    .map(({ p }) => ({ id: p.id, entry: entryOf(p.id, p.tags, p.rank, lang, p.text), translation: p.text }));
}
