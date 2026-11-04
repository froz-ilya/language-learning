import type { Lang } from '../types';
import { DEFAULT_TIMEOUT_MS, isCooling, runChainDetailed, type Provider, type ProviderId } from '../sources/chain';
import { googleDictText, googleText, type TextQuery } from '../sources/providers/google';
import { googleSentences } from '../sources/providers/googlesentences';
import { MYMEMORY_MAX_BYTES, myMemoryText } from '../sources/providers/mymemory';
import type { Definition, DictEntry } from '../lookup/google';

/**
 * The in-app translator: free text DE ↔ RU/EN through several public, key-less services.
 *
 * Main translation: Google "gtx" → the same endpoint as Google's extension client (its own rate
 * limit) → Google's extension endpoint (clients5) → MyMemory, through
 * the fallback chain (cooldowns, offline). Then the other engines are asked in parallel for
 * alternative versions (Google's endpoints are one engine; MyMemory only for short text, to
 * save its ~5,000 characters/day). Microsoft's key-less Edge token (edge.microsoft.com/translate/auth)
 * answered 404 when checked (2026-11), and the public Lingva instances were down, so neither is used.
 */
export type TranslateLang = 'de' | Lang;

/** Longest text the translator accepts (characters). */
export const MAX_TRANSLATE_CHARS = 5000;

/** MyMemory is the main translation's last resort only up to this many bytes (it splits into ≤500-byte requests). */
export const MYMEMORY_MAIN_MAX_BYTES = 2000;

export interface TranslationVersion {
  text: string;
  via: ProviderId;
}

export interface TranslateOutcome {
  /** The main translation (first service of the chain that answered), null when none did. */
  main: TranslationVersion | null;
  /** Other services' versions that differ from the main one (filled in as they arrive). */
  alternatives: TranslationVersion[];
  /** Dictionary alternatives for a single word (from Google), [] for longer text. */
  dict: DictEntry[];
  /** A German word explained in German, with examples (Google), [] otherwise. Optional: see copy(). */
  definitions?: Definition[];
  /** Usage examples of a German word (Google), [] otherwise. */
  examples?: string[];
  /** True when no service could be asked or every one failed (offline, rate-limited…). */
  unavailable: boolean;
  /** False while alternatives are still being fetched. */
  done: boolean;
}

export interface TranslateOptions {
  signal?: AbortSignal;
  /** Called with the outcome so far: once the main translation is there, then per alternative. */
  onUpdate?: (outcome: TranslateOutcome) => void;
}

// ---------- Providers ----------

interface Answer {
  text: string;
  dict: DictEntry[];
  definitions?: Definition[];
  examples?: string[];
}

const bytes = (s: string) => new TextEncoder().encode(s).length;
const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** Definitions and examples are asked for up to this many words (Google has them for single words). */
const EXTRAS_MAX_WORDS = 3;

/** Timeout that grows with the text (long texts take Google longer). */
const timeoutFor = (text: string) => DEFAULT_TIMEOUT_MS + Math.min(8000, Math.floor(text.length * 1.5));

/**
 * Split text into pieces of at most `max` UTF-8 bytes, at sentence ends or line breaks where
 * possible, else between words. Joining the pieces gives the text back. Null when one word alone
 * is longer than `max`.
 */
export function splitForBytes(text: string, max: number): string[] | null {
  const segments = text.match(/[^.!?…\n]+[.!?…]*[ \t]*\n*|[.!?…]+[ \t]*\n*|\n+/g) ?? [];
  const pieces: string[] = [];
  let cur = '';
  const push = (seg: string) => {
    if (bytes(cur + seg) <= max) {
      cur += seg;
      return true;
    }
    if (cur) pieces.push(cur);
    cur = '';
    if (bytes(seg) <= max) {
      cur = seg;
      return true;
    }
    return false;
  };
  for (const seg of segments) {
    if (push(seg)) continue;
    for (const word of seg.match(/\S+\s*|\s+/g) ?? []) if (!push(word)) return null;
  }
  if (cur) pieces.push(cur);
  return pieces;
}

/** Translate one piece with MyMemory, keeping the whitespace around it; null when it echoes it back. */
async function myMemoryPiece(piece: string, from: TranslateLang, to: TranslateLang, signal: AbortSignal): Promise<string | null> {
  const core = piece.trim();
  if (!core) return null;
  const out = await myMemoryText.run({ text: core, from, to }, signal);
  if (out === null) return null;
  const lead = piece.match(/^\s*/)![0];
  const trail = piece.match(/\s*$/)![0];
  return lead + out + trail;
}

/**
 * MyMemory for text up to `maxBytes`, in ≤500-byte requests. `echo`: a piece it can't translate
 * stays as it is (otherwise a text it doesn't translate at all is no answer).
 */
function myMemoryProvider(maxBytes: number, echo: boolean): Provider<TextQuery, Answer> {
  return {
    id: 'mymemory',
    timeoutMs: DEFAULT_TIMEOUT_MS * Math.max(1, Math.ceil(maxBytes / MYMEMORY_MAX_BYTES)),
    async run({ text, from, to }, signal) {
      if (bytes(text) > maxBytes) return null;
      const pieces = splitForBytes(text, MYMEMORY_MAX_BYTES);
      if (!pieces?.length) return null;
      let any = false;
      let out = '';
      for (const piece of pieces) {
        const tr = await myMemoryPiece(piece, from, to, signal);
        if (tr !== null) any = true;
        out += tr ?? piece;
      }
      if (!any) return echo ? { text, dict: [] } : null;
      return { text: out.trim(), dict: [] };
    },
  };
}

/** Google gtx, or the same endpoint as the browser extension's client (its own rate limit). */
function googleProvider(text: string, client: 'gtx' | 'dict' = 'gtx'): Provider<TextQuery, Answer> {
  const provider = client === 'gtx' ? googleText : googleDictText;
  return {
    id: provider.id,
    timeoutMs: timeoutFor(text),
    async run(q, signal) {
      const r = await provider.run(q, signal);
      if (!r || !r.text.trim()) return null;
      return { text: r.text.trim(), dict: r.dict, definitions: r.definitions ?? [], examples: r.examples ?? [] };
    },
  };
}

/** Every Google endpoint, in order: one engine for alternatives. */
const googleChain = (text: string, echo: boolean) => [googleProvider(text), googleProvider(text, 'dict'), googleExtProvider(text, echo)];

/** Google's extension endpoint with the whole text as one query. `echo`: see myMemoryProvider. */
function googleExtProvider(text: string, echo: boolean): Provider<TextQuery, Answer> {
  return {
    id: 'google.ext',
    timeoutMs: timeoutFor(text),
    async run({ text, from, to }, signal) {
      const r = await googleSentences.run({ sentences: [text], from, to }, signal);
      if (r === null) return echo ? { text, dict: [] } : null;
      return r[0]?.trim() ? { text: r[0].trim(), dict: [] } : null;
    },
  };
}

type Engine = 'google' | 'mymemory';
const engineOf = (id: ProviderId): Engine => (id === 'mymemory' ? 'mymemory' : 'google');

// ---------- Cache ----------

const CACHE_MAX = 50;
const cache = new Map<string, TranslateOutcome>();

const copy = (o: TranslateOutcome): TranslateOutcome => ({
  main: o.main ? { ...o.main } : null,
  alternatives: o.alternatives.map((a) => ({ ...a })),
  dict: o.dict.map((d) => ({ pos: d.pos, terms: [...d.terms] })),
  definitions: (o.definitions ?? []).map((d) => ({ ...d })),
  examples: [...(o.examples ?? [])],
  unavailable: o.unavailable,
  done: o.done,
});

/** Forget every cached translation (tests). */
export function clearTranslateCache(): void {
  cache.clear();
}

// ---------- Translating ----------

/** A version compared to others: trimmed, one space, lower case, no punctuation at the end. */
export function normalizeVersion(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/[\s.!?…,;:。]+$/u, '');
}

function isAbortError(e: unknown): boolean {
  return (e as { name?: string } | null)?.name === 'AbortError';
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

function isOffline(): boolean {
  try {
    return typeof navigator !== 'undefined' && navigator.onLine === false;
  } catch {
    return false;
  }
}

/**
 * Translate `text` (cut to MAX_TRANSLATE_CHARS). Resolves when every service has answered; an
 * abort through `signal` rejects with an AbortError, stops all requests and calls onUpdate no
 * more. Repeating a translation (e.g. swapping back) comes from an in-memory cache.
 */
export async function translate(text: string, from: TranslateLang, to: TranslateLang, opts: TranslateOptions = {}): Promise<TranslateOutcome> {
  const { signal, onUpdate } = opts;
  if (signal?.aborted) throw abortError();
  const input = text.slice(0, MAX_TRANSLATE_CHARS).trim();
  if (!input) return { main: null, alternatives: [], dict: [], unavailable: false, done: true };

  const key = `${from}|${to}|${input}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    onUpdate?.(copy(hit));
    return copy(hit);
  }

  // A German word or short phrase: also its German definitions and examples.
  const query: TextQuery = { text: input, from, to, ...(from === 'de' && wordCount(input) <= EXTRAS_MAX_WORDS ? { extras: true } : {}) };
  const outcome: TranslateOutcome = { main: null, alternatives: [], dict: [], unavailable: false, done: false };
  const update = () => {
    if (!signal?.aborted) onUpdate?.(copy(outcome));
  };

  const main = await runChainDetailed(
    'translate',
    [...googleChain(input, true), myMemoryProvider(MYMEMORY_MAIN_MAX_BYTES, true)],
    query,
    signal,
  );
  if (main.result) {
    outcome.main = { text: main.result.value.text, via: main.result.via };
    outcome.dict = main.result.value.dict;
    outcome.definitions = main.result.value.definitions ?? [];
    outcome.examples = main.result.value.examples ?? [];
  } else if (main.failed.length || main.skipped.length) {
    outcome.unavailable = true;
    outcome.done = true;
    update();
    return copy(outcome);
  } else {
    // Nobody had an answer and nobody failed: the text needs no translation.
    outcome.main = { text: input, via: 'google' };
  }
  update();

  // Alternatives: every other engine, in parallel, each as its own chain (for cooldowns).
  if (!isOffline()) {
    const mainEngine = engineOf(outcome.main.via);
    const seen = [normalizeVersion(outcome.main.text), normalizeVersion(input)];
    const engines: Provider<TextQuery, Answer>[][] = [];
    if (mainEngine !== 'google') engines.push(googleChain(input, false));
    if (mainEngine !== 'mymemory' && bytes(input) <= MYMEMORY_MAX_BYTES) engines.push([myMemoryProvider(MYMEMORY_MAX_BYTES, false)]);

    const asks = engines
      .map((providers) => providers.filter((p) => !isCooling(p.id)))
      .filter((providers) => providers.length)
      .map(async (providers) => {
        try {
          const r = await runChainDetailed('translate-alt', providers, query, signal);
          if (!r.result || signal?.aborted) return;
          if (!outcome.dict.length && r.result.value.dict.length) outcome.dict = r.result.value.dict;
          if (!outcome.definitions?.length && r.result.value.definitions?.length) outcome.definitions = r.result.value.definitions;
          if (!outcome.examples?.length && r.result.value.examples?.length) outcome.examples = r.result.value.examples;
          const n = normalizeVersion(r.result.value.text);
          if (n && !seen.includes(n)) {
            seen.push(n);
            outcome.alternatives.push({ text: r.result.value.text, via: r.result.via });
          }
          update();
        } catch (e) {
          if (!isAbortError(e)) throw e;
        }
      });
    await Promise.all(asks);
  }
  if (signal?.aborted) throw abortError();

  outcome.done = true;
  update();
  cache.set(key, copy(outcome));
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return copy(outcome);
}

// ---------- History ----------

/** One entry of the translator's recent history (localStorage, newest first). */
export interface HistoryItem {
  from: TranslateLang;
  to: TranslateLang;
  text: string;
  result: string;
  /** Epoch ms; also the item's id. */
  at: number;
}

const HISTORY_KEY = 'translate:history';
export const HISTORY_MAX = 30;
const LANGS: readonly string[] = ['de', 'ru', 'en'];

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function validItem(x: unknown): x is HistoryItem {
  const i = x as Partial<HistoryItem> | null;
  return (
    !!i &&
    typeof i === 'object' &&
    typeof i.from === 'string' &&
    LANGS.includes(i.from) &&
    typeof i.to === 'string' &&
    LANGS.includes(i.to) &&
    typeof i.text === 'string' &&
    i.text.trim() !== '' &&
    typeof i.result === 'string' &&
    typeof i.at === 'number' &&
    Number.isFinite(i.at)
  );
}

export function loadHistory(): HistoryItem[] {
  try {
    const raw = storage()?.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(validItem)
      .map(({ from, to, text, result, at }) => ({ from, to, text, result, at }))
      .slice(0, HISTORY_MAX);
  } catch {
    return [];
  }
}

function saveHistory(items: HistoryItem[]): void {
  try {
    const s = storage();
    if (!s) return;
    if (items.length) s.setItem(HISTORY_KEY, JSON.stringify(items));
    else s.removeItem(HISTORY_KEY);
  } catch {
    // Storage full or blocked: history isn't kept.
  }
}

/** Add an item at the top; an earlier one with the same languages and text is moved up (replaced). */
export function addHistory(item: HistoryItem): void {
  if (!validItem(item)) return;
  const entry: HistoryItem = { from: item.from, to: item.to, text: item.text.trim(), result: item.result, at: item.at };
  const rest = loadHistory().filter((i) => !(i.from === entry.from && i.to === entry.to && i.text.trim() === entry.text));
  saveHistory([entry, ...rest].slice(0, HISTORY_MAX));
}

export function removeHistory(at: number): void {
  saveHistory(loadHistory().filter((i) => i.at !== at));
}

export function clearHistory(): void {
  saveHistory([]);
}
