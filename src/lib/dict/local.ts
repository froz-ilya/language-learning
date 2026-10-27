// Offline dictionary runtime: public/dict/index.json plus pieces loaded on demand (built by
// scripts/dict/build.mjs). A piece is { lemmas: { [id]: RawEntry }, forms: { [formLower]: id[] } };
// ids are the lemma ("Haus") or lemma#pos for the rarer homograph ("sein#other").
import type { Auxiliary, Gender, Pos } from '../types';
import { LEVELS } from '../levels/types';
import type { LexEntry, LocalHit } from './types';

/** Key used to split the dictionary into pieces: lowercase, ä→a ö→o ü→u ß→ss. */
export function normalizeKey(word: string): string {
  return word
    .toLowerCase()
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/ß/g, 'ss');
}

/**
 * Compact entry: [rank, tags, ru, en, a?, b?]. tags = pos letter (n/v/a/o), then noun genders
 * (m/f/n) or verb auxiliary (h/s), then a level digit (1–6 = A1–C2). Noun: a = plural; verb:
 * a = Präteritum, b = Partizip II, each either the full form or "<n><suffix>" relative to the
 * term (drop n letters, append suffix).
 */
type RawEntry = [number, string, string, string, string?, string?];

interface PieceFile {
  lemmas: Record<string, RawEntry>;
  forms: Record<string, string[]>;
}

interface DictIndex {
  version: number;
  sources: string;
  count: number;
  /** Prefix of normalizeKey (2 letters; 3–4 where a prefix was split) → file name. */
  pieces: Record<string, string>;
}

interface Piece {
  lemmas: Map<string, LexEntry>;
  /** Lower-cased term → ids. */
  byLower: Map<string, string[]>;
  forms: Record<string, string[]>;
}

const POS: Record<string, Pos> = { n: 'noun', v: 'verb', a: 'adj', o: 'other' };

/** Same list as SUFFIXES in scripts/dict/lib.mjs (the build relies on it to leave regular forms out). */
export const SUFFIXES = [
  'e', 'n', 's', 't', 'en', 'em', 'er', 'es', 'st', 'et', 'te', 'nd', 'est', 'ten', 'tet', 'ete', 'end', 'ern', 'nen',
  'ere', 'ste', 'test', 'eten', 'etet', 'eren', 'erem', 'erer', 'eres', 'sten', 'stem', 'ster', 'stes', 'este',
  'etest', 'esten', 'estem', 'ester', 'estes',
];

/** Lower-cased lemma candidates of a lower-cased token by ending rules (same as scripts/dict/lib.mjs). */
export function ruleCandidates(token: string): string[] {
  const out: string[] = [];
  for (const s of SUFFIXES) {
    if (!token.endsWith(s) || token.length - s.length < 3) continue;
    const stem = token.slice(0, -s.length);
    for (const c of [stem, `${stem}en`, `${stem}n`]) if (c !== token && !out.includes(c)) out.push(c);
  }
  return out;
}

function expandForm(term: string, s: string | undefined): string {
  if (!s) return '';
  if (!/^\d/.test(s)) return s;
  return term.slice(0, term.length - Number(s[0])) + s.slice(1);
}

function decode(id: string, raw: RawEntry): LexEntry {
  const term = id.split('#')[0];
  const [rank, tags, ru, en, a, b] = raw;
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
    term,
    pos,
    genders,
    plural: pos === 'noun' ? expandForm(term, a) : '',
    praeteritum: pos === 'verb' ? expandForm(term, a) : '',
    partizip2: pos === 'verb' ? expandForm(term, b) : '',
    auxiliary,
    tr: { ru: ru ?? '', en: en ?? '' },
    rank,
  };
  if (level) entry.level = level;
  return entry;
}

const base = () => `${import.meta.env.BASE_URL}dict/`;

let indexPromise: Promise<DictIndex | null> | null = null;
const piecePromises = new Map<string, Promise<Piece | null>>();

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
function loadIndex(): Promise<DictIndex | null> {
  if (!indexPromise) {
    const p = getJson<DictIndex>(`${base()}index.json`).then((index) => {
      if (!index?.pieces) {
        if (indexPromise === p) indexPromise = null;
        return null;
      }
      return index;
    });
    indexPromise = p;
  }
  return indexPromise;
}

function loadFile(file: string): Promise<Piece | null> {
  let p = piecePromises.get(file);
  if (!p) {
    p = getJson<PieceFile>(`${base()}${file}`).then((raw) => {
      if (!raw?.lemmas) {
        piecePromises.delete(file);
        return null;
      }
      const lemmas = new Map<string, LexEntry>();
      const byLower = new Map<string, string[]>();
      for (const [id, e] of Object.entries(raw.lemmas)) {
        const entry = decode(id, e);
        lemmas.set(id, entry);
        const k = entry.term.toLowerCase();
        const list = byLower.get(k);
        if (list) list.push(id);
        else byLower.set(k, [id]);
      }
      return { lemmas, byLower, forms: raw.forms ?? {} };
    });
    piecePromises.set(file, p);
  }
  return p;
}

/** File of the piece holding a word: the longest index key (4…1 letters of normalizeKey) it starts with. */
function fileFor(index: DictIndex, word: string): string | undefined {
  const k = normalizeKey(word);
  for (let n = Math.min(4, k.length); n >= 1; n--) {
    const f = index.pieces[k.slice(0, n)];
    if (f) return f;
  }
  return undefined;
}

async function pieceFor(word: string): Promise<Piece | null> {
  const index = await loadIndex();
  const file = index && word ? fileFor(index, word) : undefined;
  return file ? loadFile(file) : null;
}

/** Entry for an id ("Haus", "sein#other"), from whichever piece holds it. */
async function entryOf(id: string): Promise<LexEntry | null> {
  const piece = await pieceFor(id.split('#')[0]);
  return piece?.lemmas.get(id) ?? null;
}

const ARTICLE = /^(der|die|das|den|dem|des|ein|eine|einen|einem|einer|eines)\s+/i;
const EDGE_PUNCT = /^[^\p{L}]+|[^\p{L}]+$/gu;

/** "„Der Tisch,“" → "Tisch". */
function clean(word: string): string {
  let w = word.normalize('NFC').trim().replace(EDGE_PUNCT, '');
  const m = w.match(ARTICLE);
  if (m && m[0].length < w.length) w = w.slice(m[0].length).replace(EDGE_PUNCT, '');
  return w;
}

/**
 * Look a word up offline. Accepts lemmas and inflected forms ("ging" → gehen, "Häuser" → Haus),
 * any capitalisation, with or without an article ("der Tisch"). Several hits when ambiguous,
 * best first. [] when unknown or the dictionary piece can't be loaded.
 */
export async function lookupLocal(word: string): Promise<LocalHit[]> {
  const w = clean(word);
  if (!w) return [];
  const piece = await pieceFor(w);
  if (!piece) return [];
  const lower = w.toLowerCase();
  const cap = lower[0].toUpperCase() + lower.slice(1);
  // Tier 0: the lemma as typed; tier 1: the lemma in another case, inflected forms.
  const hits: { id: string; hit: LocalHit; tier: number }[] = [];
  const push = (id: string, entry: LexEntry | null | undefined, tier: number, form?: string) => {
    if (!entry || hits.some((h) => h.id === id)) return;
    hits.push({ id, tier, hit: form ? { entry, form } : { entry } });
  };
  for (const id of piece.byLower.get(lower) ?? []) {
    const entry = piece.lemmas.get(id);
    if (entry?.term === w) push(id, entry, 0);
    else if (entry && (entry.term === cap || entry.term === lower)) push(id, entry, 1);
  }
  // A capitalised word may just start a sentence: when the lower-case reading is far more common
  // ("Sie" → sie #3, not the noun "Sie" #10405), rank it with the exact match. Real nouns
  // ("Essen" vs essen) are rarely 10× less frequent, so they keep winning.
  if (w !== lower) {
    const best = Math.min(...hits.filter((h) => h.tier === 0).map((h) => h.hit.entry.rank));
    for (const h of hits) if (h.tier === 1 && h.hit.entry.term === lower && h.hit.entry.rank * 10 < best) h.tier = 0;
  }
  const formIds = piece.forms[lower];
  if (formIds) {
    for (const id of formIds) push(id, await entryOf(id), 1, w);
  } else if (!hits.length) {
    // Regular inflections are not stored: strip endings ("Tische" → Tisch, "schöneren" → schön).
    for (const c of ruleCandidates(lower)) {
      const p = await pieceFor(c);
      for (const id of p?.byLower.get(c) ?? []) push(id, p?.lemmas.get(id), 1, w);
    }
  }
  hits.sort((a, b) => a.tier - b.tier || a.hit.entry.rank - b.hit.entry.rank);
  return hits.map((h) => h.hit);
}

/** Lemma for a token in running text (best guess), or null. */
export async function lemmatize(token: string): Promise<LexEntry | null> {
  return (await lookupLocal(token))[0]?.entry ?? null;
}

/** Up to `limit` lemmas starting with `prefix`, most frequent first. */
export async function prefixLocal(prefix: string, limit = 8): Promise<LexEntry[]> {
  const norm = normalizeKey(clean(prefix));
  if (norm.length < 2) return [];
  const index = await loadIndex();
  if (!index) return [];
  // The piece of the prefix itself plus any split-off pieces under it ("sc" → "sch", "scha", …).
  const files = new Set<string>();
  const own = fileFor(index, norm);
  if (own) files.add(own);
  for (const [k, f] of Object.entries(index.pieces)) if (k.length > norm.length && k.startsWith(norm)) files.add(f);
  const pieces = await Promise.all([...files].map(loadFile));
  const out = new Map<string, LexEntry>();
  for (const p of pieces) {
    if (!p) continue;
    for (const [id, e] of p.lemmas) if (normalizeKey(e.term).startsWith(norm)) out.set(id, e);
  }
  return [...out.values()].sort((a, b) => a.rank - b.rank).slice(0, limit);
}

/** Frequency rank of a lemma (1 = most common), or null if not in the dictionary. */
export async function rankOf(lemma: string): Promise<number | null> {
  const w = clean(lemma);
  if (!w) return null;
  const piece = await pieceFor(w);
  const ids = piece?.byLower.get(w.toLowerCase()) ?? [];
  const entries = ids.map((id) => piece!.lemmas.get(id)!);
  const exact = entries.filter((e) => e.term === w);
  const list = exact.length ? exact : entries;
  return list.length ? Math.min(...list.map((e) => e.rank)) : null;
}
