import type { ArticleVariant, Card, Example, Gender, Lang, LookupResult, Pos } from '../types';
import type { LexEntry, LocalHit } from '../dict/types';
import { articleVariants } from '../dict/local';
import { ARTICLE } from '../german/articles';
import { db } from '../db/schema';
import { saveCard } from '../db/repo';
import { parseGermanInput, type ParsedTerm } from '../german/parseTerm';
import type { WikiArticle, WikiEntry } from './wiktionary';
import { formatMeanings, previewOf } from './meanings';
import { googlePos, googleTranslate, isAbortError, type DictEntry, type GoogleResult } from './google';
import { isCooling, runChainDetailed, type Provider, type ProviderId } from '../sources/chain';
import { localPrefix, localWord } from '../sources/providers/local';
import {
  deWiktionaryDetails,
  deWiktionaryEntry,
  deWiktionaryPrefix,
  type WikiDetails,
} from '../sources/providers/dewiktionary';
import { enWiktionaryGlosses, enWiktionaryPrefix } from '../sources/providers/enwiktionary';
import { googleText, type TextQuery } from '../sources/providers/google';
import { myMemoryText } from '../sources/providers/mymemory';

export interface Suggestion {
  /** Word as spelled in the dictionary (correct capitalisation), e.g. "Hausschlüssel". */
  word: string;
  /** Short translation preview in the target language, if available. */
  preview?: string;
  /**
   * Set for one article of a noun whose articles differ in meaning: "See" comes as two
   * suggestions, ['m'] (озеро) and ['f'] (море).
   */
  genders?: Gender[];
}

/** Thrown when nothing was found because every source that could answer failed, was cooling or offline. */
export class SourceUnavailableError extends Error {
  constructor(message = 'No dictionary source is reachable right now. Try again later.') {
    super(message);
    this.name = 'SourceUnavailableError';
  }
}

/**
 * Bump when the shape of cached results changes (v2: translations grouped by meaning; v3: nouns
 * whose articles differ in meaning come as `articles`, no longer merged into one translation).
 */
const CACHE_VERSION = 'v3';
const DAY = 24 * 60 * 60 * 1000;
const FOUND_TTL = 30 * DAY;
const NOT_FOUND_TTL = DAY;
/** How long a complete offline entry waits for Wiktionary's examples before returning without them. */
const ENRICH_TIMEOUT_MS = 3000;

/** Delays used by fillCards (exported so tests can shorten them). */
export const fillTiming = { gapMs: 700, rateLimitWaitMs: 20_000 };

// ---------- Small helpers ----------

const capitalise = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const lowerFirst = (s: string) => (s.length > 1 && /\p{Lu}/u.test(s[1]) ? s : s ? s[0].toLowerCase() + s.slice(1) : s);
const unique = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];

const POS_LABEL: Record<Pos, string> = { noun: 'noun', verb: 'verb', adj: 'adjective', other: '' };

/**
 * Google dictionary alternatives (up to 3, preferring the matching part of speech), else the
 * main translation. Google gives no meaning information, so its words are one meaning.
 */
function googleWordTranslation(g: GoogleResult, pos?: Pos): string {
  if (g.dict.length) {
    const label = pos ? POS_LABEL[pos] : '';
    const ordered: DictEntry[] = [...g.dict.filter((d) => d.pos === label), ...g.dict.filter((d) => d.pos !== label)];
    const terms = formatMeanings([unique(ordered.flatMap((d) => d.terms))]);
    if (terms) return terms;
  }
  return lowerFirst(g.text.trim());
}

/** Did Google actually recognise the word (rather than echo it back)? */
function googleKnows(g: GoogleResult, term: string): boolean {
  if (g.dict.length) return true;
  const out = g.text.trim().toLowerCase();
  return out !== '' && out !== term.toLowerCase();
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}

// ---------- Source chains ----------

/** Collects which providers failed during one lookup (several chains). */
class Trace {
  failed = new Set<ProviderId>();
}

interface Step<O> {
  value: O | null;
  via: ProviderId | null;
  /** False when no answer came and some provider failed, was cooling or was skipped offline. */
  ok: boolean;
}

async function step<I, O>(
  trace: Trace,
  capability: string,
  providers: Provider<I, O>[],
  input: I,
  signal?: AbortSignal,
): Promise<Step<O>> {
  const o = await runChainDetailed(capability, providers, input, signal);
  for (const id of o.failed) trace.failed.add(id);
  return {
    value: o.result?.value ?? null,
    via: o.result?.via ?? null,
    ok: o.result !== null || (!o.failed.length && !o.skipped.length),
  };
}

/** Plain text translation: Google → MyMemory. */
const googlePlain: Provider<TextQuery, string> = {
  id: 'google',
  run: async (q, signal) => (await googleTranslate(q.text, q.from, q.to, signal)).text,
};
const TEXT_PROVIDERS: Provider<TextQuery, string>[] = [googlePlain, myMemoryText];

interface WordTranslation {
  text: string;
  pos?: Pos;
}

const enWiktionaryWord: Provider<string, WordTranslation> = {
  id: 'en.wiktionary',
  async run(term, signal) {
    const g = await enWiktionaryGlosses.run(term, signal);
    return g ? { text: g.translation, pos: g.pos } : null;
  },
};

/** Word translation beyond the dictionaries: en.wiktionary glosses (EN only) → Google → MyMemory. */
function translationProviders(lang: Lang, pos?: Pos): Provider<string, WordTranslation>[] {
  const google: Provider<string, WordTranslation> = {
    id: 'google',
    async run(term, signal) {
      const g = await googleText.run({ text: term, from: 'de', to: lang }, signal);
      if (!g || !googleKnows(g, term)) return null;
      const gPos = g.dict.length ? googlePos(g.dict[0].pos) : undefined;
      return { text: googleWordTranslation(g, pos ?? gPos), pos: gPos };
    },
  };
  const mymemory: Provider<string, WordTranslation> = {
    id: 'mymemory',
    async run(term, signal) {
      const text = await myMemoryText.run({ text: term, from: 'de', to: lang }, signal);
      return text ? { text: lowerFirst(text) } : null;
    },
  };
  return [...(lang === 'en' ? [enWiktionaryWord] : []), google, mymemory];
}

type Details = { kind: 'local'; hit: LocalHit } | WikiDetails;

/** Word details: offline dictionary → de.wiktionary (entry, lemma redirect, compound fallback). */
const DETAIL_PROVIDERS: Provider<ParsedTerm, Details>[] = [
  {
    id: 'local',
    timeoutMs: localWord.timeoutMs,
    async run(parsed, signal) {
      const hit = await localWord.run({ term: parsed.term, genders: parsed.genders }, signal);
      return hit ? { kind: 'local', hit } : null;
    },
  },
  deWiktionaryDetails,
];

// ---------- Cache (IndexedDB; failures are ignored so lookups still work without it) ----------

interface CacheHit {
  hit: boolean;
  result: LookupResult | null;
  via: ProviderId | null;
}

function viaOfSource(result: LookupResult | null): ProviderId | null {
  if (!result) return null;
  return result.source === 'google' ? 'google' : 'de.wiktionary';
}

async function readCache(key: string): Promise<CacheHit> {
  try {
    const row = await db.lookupCache.get(key);
    if (row) {
      const ttl = row.result ? FOUND_TTL : NOT_FOUND_TTL;
      if (Date.now() - row.fetchedAt < ttl) {
        const via = (row as { via?: ProviderId }).via ?? viaOfSource(row.result);
        return { hit: true, result: row.result, via: row.result ? via : null };
      }
    }
  } catch {
    // IndexedDB unavailable (private mode, tests): behave as a miss.
  }
  return { hit: false, result: null, via: null };
}

async function writeCache(key: string, result: LookupResult | null, via: ProviderId | null): Promise<void> {
  try {
    // `via` is stored alongside the row (not part of LookupCacheEntry's type; Dexie keeps it).
    const row = { key, result, fetchedAt: Date.now(), via };
    await db.lookupCache.put(row);
  } catch {
    // Ignore: caching is best-effort.
  }
}

// ---------- Lookup ----------

interface Resolved {
  result: LookupResult | null;
  /** Provider that supplied the word (details, or the translation for a translation-only result). */
  via: ProviderId | null;
  /** Every source needed answered (or truly had nothing): safe to cache. */
  complete: boolean;
  /** No grammar source answered because one failed, was cooling or offline. */
  detailsMissing: boolean;
  /** Some provider failed during this lookup and was put in cooldown. */
  refused: boolean;
}

/** Translate up to 3 example sentences in one request (Google → MyMemory). */
async function translateExamples(
  sentences: string[],
  lang: Lang,
  trace: Trace,
  signal?: AbortSignal,
): Promise<{ examples: Example[]; ok: boolean }> {
  const de = sentences.slice(0, 3);
  if (!de.length) return { examples: [], ok: true };
  const s = await step(trace, 'translate-text', TEXT_PROVIDERS, { text: de.join('\n'), from: 'de', to: lang }, signal);
  if (s.value !== null) {
    const lines = s.value.split('\n').map((l) => l.trim());
    if (lines.length === de.length) return { examples: de.map((d, i) => ({ de: d, tr: lines[i] || undefined })), ok: true };
  }
  return { examples: de.map((d) => ({ de: d })), ok: s.ok };
}

/**
 * Example sentences of several articles ("der See", "die See") translated in one request:
 * up to `per` sentences each. Returns the examples per set.
 */
async function translateExampleSets(
  sets: string[][],
  lang: Lang,
  trace: Trace,
  signal?: AbortSignal,
  per = 2,
): Promise<{ examples: Example[][]; ok: boolean }> {
  const lists = sets.map((s) => s.slice(0, per));
  const flat = lists.flat();
  if (!flat.length) return { examples: lists.map(() => []), ok: true };
  const s = await step(trace, 'translate-text', TEXT_PROVIDERS, { text: flat.join('\n'), from: 'de', to: lang }, signal);
  const lines = s.value?.split('\n').map((l) => l.trim());
  const ok = !!lines && lines.length === flat.length;
  let i = 0;
  const examples = lists.map((l) =>
    l.map((de) => {
      const tr = ok ? lines![i] : '';
      i++;
      return tr ? { de, tr } : { de };
    }),
  );
  return { examples, ok: ok || s.ok };
}

/** "the sea" → "sea": Google's translation of "die See" with the article it added. */
const stripArticle = (t: string) => t.replace(/^(?:the|a|an)\s+/i, '');

/** Translation of a word that the dictionaries have no translation for. */
async function translateWord(
  term: string,
  lang: Lang,
  pos: Pos | undefined,
  trace: Trace,
  signal?: AbortSignal,
): Promise<{ text: string; ok: boolean }> {
  const s = await step(trace, 'word-translation', translationProviders(lang, pos), term, signal);
  return { text: s.value?.text ?? '', ok: s.ok };
}

function grammarComplete(e: LexEntry): boolean {
  if (e.pos === 'noun') return e.genders.length > 0;
  if (e.pos === 'verb') return !!(e.praeteritum && e.partizip2 && e.auxiliary);
  return true;
}

/** The Wiktionary article of one gender (der See / die See), or the whole entry when it has none. */
function wikiArticle(wiki: WikiEntry | null, gender: Gender | undefined): WikiArticle | WikiEntry | null {
  if (!wiki) return null;
  if (!wiki.articles) return wiki;
  return wiki.articles.find((a) => !!gender && a.genders.includes(gender)) ?? null;
}

/** The result as one of its articles: that article's genders, plural, translation and examples. */
function withArticle(r: LookupResult, a: ArticleVariant): LookupResult {
  return { ...r, genders: [...a.genders], plural: a.plural, translation: a.translation, examples: a.examples.map((e) => ({ ...e })) };
}

/**
 * The article matching a typed or known gender ("die See" → море), else the result unchanged.
 * Results without articles are returned as they are.
 */
export function preferArticle(r: LookupResult, genders: Gender[]): LookupResult {
  if (!r.articles || !genders.length) return r;
  const a = r.articles.find((x) => genders.includes(x.genders[0]));
  return a ? withArticle(r, a) : r;
}

/** An article as a card would get it (one gender). */
interface ArticleDraft {
  gender: Gender;
  plural: string;
  translation: string;
  examples: string[];
}

/**
 * Article variants of a noun ("der See", "die See"): the offline dictionary's entries first
 * (most common first), then Wiktionary's articles the dictionary lacks (only with translations
 * into both languages, like the dictionary's). A missing translation is asked for with the
 * article ("die See"), so Google can tell them apart. [] when the noun has one article.
 */
async function articleDrafts(
  local: LexEntry[],
  wiki: WikiEntry | null,
  lang: Lang,
  trace: Trace,
  signal?: AbortSignal,
): Promise<{ drafts: ArticleDraft[]; ok: boolean }> {
  const drafts: ArticleDraft[] = [];
  for (const x of local) {
    const g = x.genders[0];
    const w = wikiArticle(wiki, g);
    drafts.push({
      gender: g,
      plural: x.plural || w?.plural || '',
      translation: (x.tr[lang] ?? '').trim() || (w ? formatMeanings(w.translations[lang]) : ''),
      examples: w?.examples ?? [],
    });
  }
  for (const a of wiki?.articles ?? []) {
    const g = a.genders[0];
    if (!g || drafts.some((d) => d.gender === g)) continue;
    if (drafts.length && (!a.translations.ru.length || !a.translations.en.length)) continue;
    drafts.push({ gender: g, plural: a.plural, translation: formatMeanings(a.translations[lang]), examples: a.examples });
  }
  if (drafts.length < 2) return { drafts: [], ok: true };
  let ok = true;
  const term = local[0]?.term ?? wiki?.title ?? '';
  for (const d of drafts) {
    if (d.translation) continue;
    const t = await translateWord(`${ARTICLE[d.gender]} ${term}`, lang, 'noun', trace, signal);
    d.translation = stripArticle(t.text);
    ok &&= t.ok;
  }
  return { drafts, ok };
}

/** Article drafts with translated examples, as the result's `articles`. */
async function finishArticles(
  drafts: ArticleDraft[],
  lang: Lang,
  trace: Trace,
  signal?: AbortSignal,
): Promise<{ articles: ArticleVariant[]; ok: boolean }> {
  const ex = await translateExampleSets(
    drafts.map((d) => d.examples),
    lang,
    trace,
    signal,
  );
  return {
    articles: drafts.map((d, i) => ({ genders: [d.gender], plural: d.plural, translation: d.translation, examples: ex.examples[i] })),
    ok: ex.ok,
  };
}

/** Offline-dictionary hit, plus examples (and gaps) from Wiktionary when it answers in time. */
async function fromLocal(hit: LocalHit, parsed: ParsedTerm, lang: Lang, trace: Trace, signal?: AbortSignal): Promise<Resolved> {
  const e = hit.entry;
  const localTr = (e.tr[lang] ?? '').trim();
  const localComplete = !!localTr && grammarComplete(e);

  let complete = true;
  let wiki: WikiEntry | null = null;
  if (isCooling('de.wiktionary')) {
    complete = false;
  } else {
    const provider = localComplete ? { ...deWiktionaryEntry, timeoutMs: ENRICH_TIMEOUT_MS } : deWiktionaryEntry;
    const s = await step(trace, 'word-examples', [provider], e.term, signal);
    wiki = s.value;
    complete = s.ok;
  }
  const same = wiki && (e.pos === 'other' || wiki.pos === e.pos) ? wiki : null;
  const pos: Pos = e.pos !== 'other' ? e.pos : (same?.pos ?? 'other');

  // A noun whose articles differ in meaning: every article, the hit's one as the result.
  const gender = e.pos === 'noun' ? e.genders[0] : undefined;
  const split = gender ? await articleDrafts(await articleVariants(e), same, lang, trace, signal) : { drafts: [], ok: true };
  complete &&= split.ok;
  const mine = split.drafts.find((d) => d.gender === gender);
  // Translations and examples of the matching article only (not "die See"'s for "der See").
  const own = gender && same?.articles ? wikiArticle(same, gender) : same;

  let translation = localTr || mine?.translation || (own ? formatMeanings(own.translations[lang]) : '');
  if (!translation) {
    const t = await translateWord(e.term, lang, pos, trace, signal);
    translation = t.text;
    complete &&= t.ok;
  }

  const result: LookupResult = {
    term: e.term,
    pos,
    genders: e.genders.length ? [...e.genders] : own?.genders.length ? [...own.genders] : pos === 'noun' ? parsed.genders : [],
    plural: e.plural || own?.plural || '',
    praeteritum: e.praeteritum || same?.praeteritum || '',
    partizip2: e.partizip2 || same?.partizip2 || '',
    auxiliary: e.auxiliary || same?.auxiliary || '',
    translation,
    examples: [],
    source: 'wiktionary',
  };
  if (mine) {
    const done = await finishArticles(split.drafts, lang, trace, signal);
    complete &&= done.ok;
    result.articles = done.articles;
    result.examples = done.articles.find((a) => a.genders[0] === gender)!.examples.map((x) => ({ ...x }));
  } else {
    const ex = await translateExamples(own?.examples ?? [], lang, trace, signal);
    complete &&= ex.ok;
    result.examples = ex.examples;
  }
  if (hit.form && hit.form !== e.term) result.lemmaOf = hit.form;
  return { result, via: 'local', complete, detailsMissing: false, refused: trace.failed.size > 0 };
}

async function fromWiki(details: WikiDetails, parsed: ParsedTerm, lang: Lang, trace: Trace, signal?: AbortSignal): Promise<Resolved> {
  const done = (result: LookupResult, complete: boolean): Resolved => ({
    result,
    via: 'de.wiktionary',
    complete,
    detailsMissing: false,
    refused: trace.failed.size > 0,
  });

  if (details.kind === 'compound') {
    const t = await translateWord(details.word, lang, 'noun', trace, signal);
    return done(
      {
        term: details.word,
        pos: 'noun',
        genders: details.head.genders,
        plural: details.plural,
        praeteritum: '',
        partizip2: '',
        auxiliary: '',
        translation: t.text,
        examples: [],
        source: 'compound',
      },
      t.ok,
    );
  }

  const { entry, lemmaOf } = details;
  let complete = true;
  let translation = formatMeanings(entry.translations[lang]);
  if (!translation) {
    const t = await translateWord(entry.title, lang, entry.pos, trace, signal);
    translation = t.text;
    complete = t.ok;
  }
  let articles: ArticleVariant[] | undefined;
  let examples: Example[];
  if (entry.pos === 'noun' && entry.articles) {
    const split = await articleDrafts([], entry, lang, trace, signal);
    const done = await finishArticles(split.drafts, lang, trace, signal);
    complete &&= split.ok && done.ok;
    articles = done.articles.length ? done.articles : undefined;
    examples = articles?.[0].examples ?? [];
    if (articles && !translation) translation = articles[0].translation;
  } else {
    const ex = await translateExamples(entry.examples, lang, trace, signal);
    complete &&= ex.ok;
    examples = ex.examples;
  }

  const result: LookupResult = {
    term: entry.title,
    pos: entry.pos,
    genders: entry.genders.length ? entry.genders : entry.pos === 'noun' ? parsed.genders : [],
    plural: entry.plural || (entry.pos === 'noun' ? (parsed.plural ?? '') : ''),
    praeteritum: entry.praeteritum || (entry.pos === 'verb' ? (parsed.praeteritum ?? '') : ''),
    partizip2: entry.partizip2 || (entry.pos === 'verb' ? (parsed.partizip2 ?? '') : ''),
    auxiliary: entry.auxiliary || (entry.pos === 'verb' ? (parsed.auxiliary ?? '') : ''),
    translation,
    examples,
    source: 'wiktionary',
  };
  if (articles) result.articles = articles;
  if (lemmaOf) result.lemmaOf = lemmaOf;
  return done(result, complete);
}

async function resolve(parsed: ParsedTerm, lang: Lang, signal?: AbortSignal): Promise<Resolved> {
  const trace = new Trace();
  const details = await step(trace, 'word-details', DETAIL_PROVIDERS, parsed, signal);
  if (details.value?.kind === 'local') return fromLocal(details.value.hit, parsed, lang, trace, signal);
  if (details.value) return fromWiki(details.value, parsed, lang, trace, signal);

  // Last resort: a translation-only result (no grammar beyond what was typed).
  const s = await step(trace, 'word-translation', translationProviders(lang, parsed.pos), parsed.term, signal);
  const base = { complete: details.ok && s.ok, detailsMissing: !details.ok, refused: trace.failed.size > 0 };
  if (!s.value) return { ...base, result: null, via: null };
  const pos: Pos = parsed.pos ?? s.value.pos ?? 'other';
  return {
    ...base,
    via: s.via,
    result: {
      term: pos === 'noun' ? capitalise(parsed.term) : parsed.term,
      pos,
      genders: pos === 'noun' ? parsed.genders : [],
      plural: parsed.plural ?? '',
      praeteritum: parsed.praeteritum ?? '',
      partizip2: parsed.partizip2 ?? '',
      auxiliary: parsed.auxiliary ?? '',
      translation: s.value.text,
      examples: [],
      source: 'google',
    },
  };
}

interface Lookup extends Resolved {
  fromCache: boolean;
}

async function lookupWithCache(input: string, lang: Lang, signal?: AbortSignal): Promise<Lookup> {
  const parsed = parseGermanInput(input.normalize('NFC'));
  const none = { result: null, via: null, complete: true, detailsMissing: false, refused: false };
  if (!parsed.term) return { ...none, fromCache: true };
  const key = `${CACHE_VERSION}:${lang}:${parsed.term}`;
  // "See" and "die See" share the row: it holds the first article; a typed one is picked here.
  const typed = (r: LookupResult | null) => (r ? preferArticle(r, parsed.genders) : r);
  const cached = await readCache(key);
  if (cached.hit) return { ...none, result: typed(cached.result), via: cached.via, fromCache: true };

  const r = await resolve(parsed, lang, signal);
  const canonical = r.result?.articles ? withArticle(r.result, r.result.articles[0]) : r.result;
  if (r.complete) await writeCache(key, canonical, r.via);
  return { ...r, result: typed(canonical), fromCache: false };
}

/**
 * Look up a German word (user input; may include an article like "der Tisch") and report which
 * source supplied it. Sources: IndexedDB cache, offline dictionary, de.wiktionary (inflected form
 * → lemma, compound-noun fallback), then translation-only sources. Null if nothing was found.
 * Throws SourceUnavailableError when nothing was found because sources failed, were cooling or
 * the device is offline; AbortError when aborted.
 */
export async function lookupWordWithSource(
  input: string,
  lang: Lang,
  signal?: AbortSignal,
): Promise<{ result: LookupResult | null; via: ProviderId | null }> {
  const r = await lookupWithCache(input, lang, signal);
  if (!r.result && !r.complete) throw new SourceUnavailableError();
  return { result: r.result, via: r.result ? r.via : null };
}

/** Look up a German word; see lookupWordWithSource. */
export async function lookupWord(input: string, lang: Lang, signal?: AbortSignal): Promise<LookupResult | null> {
  return (await lookupWordWithSource(input, lang, signal)).result;
}

/**
 * Prefix suggestions: offline dictionary → de.wiktionary → en.wiktionary. Previews come from
 * the offline dictionary; the rest get one batched Google request unless Google is cooling.
 */
export async function suggest(prefix: string, lang: Lang, signal?: AbortSignal): Promise<Suggestion[]> {
  const p = prefix
    .normalize('NFC')
    .trim()
    .replace(/^(?:der|die|das)\s+/i, '');
  if (p.length < 2) return [];
  const multiWord = /\s/.test(p);
  const keep = (words: string[] | null) => {
    const ws = unique((words ?? []).filter((w) => multiWord || !/\s/.test(w)));
    return ws.length ? ws : null;
  };
  type Q = { prefix: string; limit: number };
  const providers: Provider<Q, Suggestion[]>[] = [
    {
      id: 'local',
      timeoutMs: localPrefix.timeoutMs,
      async run(q, s) {
        const entries = (await localPrefix.run(q, s)) ?? [];
        const words = keep(entries.map((e) => e.term));
        if (!words) return null;
        return words.flatMap((word): Suggestion[] => {
          // A noun whose articles differ in meaning: one row per article ("der See", "die See").
          const nouns = entries.filter((e) => e.term === word && e.pos === 'noun' && e.genders.length);
          const articles = nouns.filter((e, i) => nouns.findIndex((x) => x.genders[0] === e.genders[0]) === i);
          const list = articles.length > 1 ? articles : [entries.find((e) => e.term === word)];
          return list.map((e) => {
            // "последствие; серия" for a word with several meanings, else two synonyms.
            const preview = previewOf(e?.tr[lang]);
            const out: Suggestion = preview ? { word, preview } : { word };
            if (articles.length > 1 && e) out.genders = [e.genders[0]];
            return out;
          });
        });
      },
    },
    { id: 'de.wiktionary', run: async (q, s) => keep(await deWiktionaryPrefix.run(q, s))?.map((word) => ({ word })) ?? null },
    { id: 'en.wiktionary', run: async (q, s) => keep(await enWiktionaryPrefix.run(q, s))?.map((word) => ({ word })) ?? null },
  ];
  const out = await runChainDetailed('suggest', providers, { prefix: p, limit: 8 }, signal);
  const suggestions = out.result?.value ?? [];

  const missing = suggestions.filter((s) => !s.preview);
  if (missing.length && !isCooling('google')) {
    // Previews are optional: failures only put Google in cooldown.
    const g = await runChainDetailed(
      'suggest-preview',
      [googleText],
      { text: missing.map((s) => s.word).join('\n'), from: 'de', to: lang },
      signal,
    );
    const lines = g.result?.value.text.split('\n').map((l) => l.trim()) ?? [];
    if (lines.length === missing.length) {
      missing.forEach((s, i) => {
        if (lines[i]) s.preview = lowerFirst(lines[i]);
      });
    }
  }
  return suggestions;
}

/**
 * Translate free text (phrases, example sentences): Google → MyMemory.
 * Throws SourceUnavailableError when no service answered.
 */
export async function translateText(text: string, from: 'de' | Lang, to: 'de' | Lang, signal?: AbortSignal): Promise<string> {
  if (!text.trim()) return '';
  const out = await runChainDetailed('translate-text', TEXT_PROVIDERS, { text, from, to }, signal);
  if (out.result) return out.result.value;
  if (out.failed.length || out.skipped.length) throw new SourceUnavailableError('No translation service is reachable right now.');
  return text; // Both services echoed it back: nothing to translate.
}

/**
 * Merge a lookup result into a card, filling only empty fields. A card that already has an
 * article takes that article's meaning ("die See" → море, not озеро). Pure function.
 */
export function mergeIntoCard(card: Card, lookup: LookupResult): Card {
  const result = card.pos === 'noun' || card.pos === 'other' ? preferArticle(lookup, card.genders) : lookup;
  return {
    ...card,
    translation: card.translation.trim() ? card.translation : result.translation,
    pos: card.pos === 'other' ? result.pos : card.pos,
    genders: card.genders.length ? [...card.genders] : [...result.genders],
    plural: card.plural.trim() ? card.plural : result.plural,
    praeteritum: card.praeteritum.trim() ? card.praeteritum : result.praeteritum,
    partizip2: card.partizip2.trim() ? card.partizip2 : result.partizip2,
    auxiliary: card.auxiliary || result.auxiliary,
    examples: card.examples.some((e) => e.de.trim())
      ? card.examples.map((e) => ({ ...e }))
      : result.examples.map((e) => ({ ...e })),
    needsFill: 0,
  };
}

/**
 * Auto-fill many cards (import / "fill later"), paced, saving each to the DB and clearing
 * needsFill. A word whose grammar sources all failed, were cooling or offline counts as failed
 * and keeps needsFill = 1. After a source refuses, waits longer before the next word.
 * Stops early when aborted.
 */
export async function fillCards(
  cards: Card[],
  lang: Lang,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<{ filled: number; notFound: number; failed: number }> {
  const counts = { filled: 0, notFound: 0, failed: 0 };
  let done = 0;
  let wait = 0;

  for (const card of cards) {
    if (signal?.aborted) break;
    if (wait) {
      await sleep(wait, signal);
      if (signal?.aborted) break;
    }

    let outcome: Lookup | undefined;
    try {
      outcome = await lookupWithCache(card.term, lang, signal);
    } catch (e) {
      if (isAbortError(e) || signal?.aborted) break;
    }
    if (signal?.aborted) break;
    wait = outcome?.fromCache ? 0 : outcome?.refused ? fillTiming.rateLimitWaitMs : fillTiming.gapMs;

    try {
      if (!outcome || outcome.detailsMissing || (!outcome.result && !outcome.complete)) {
        counts.failed++;
      } else if (outcome.result) {
        await saveCard(mergeIntoCard(card, outcome.result));
        counts.filled++;
      } else {
        await saveCard({ ...card, needsFill: 0 });
        counts.notFound++;
      }
    } catch {
      counts.failed++;
    }
    onProgress?.(++done, cards.length);
  }
  return counts;
}
