import type { ArticleVariant, Card, Example, Gender, Lang, LookupResult, Pos } from '../types';
import type { LexEntry, LocalHit } from '../dict/types';
import { articleVariants } from '../dict/local';
import { ARTICLE } from '../german/articles';
import { db } from '../db/schema';
import { saveCard } from '../db/repo';
import { parseGermanInput, type ParsedTerm } from '../german/parseTerm';
import type { WikiArticle, WikiEntry, WikiPhrase } from './wiktionary';
import { formatMeanings, matchSenses, meaningSentences, previewOf } from './meanings';
import { googlePos, googleTranslate, isAbortError, type DictEntry, type GoogleResult } from './google';
import { isCooling, runChainDetailed, type Provider, type ProviderId } from '../sources/chain';
import { localPrefix, localWord } from '../sources/providers/local';
import {
  deWiktionaryDetails,
  deWiktionaryEntry,
  deWiktionaryPages,
  deWiktionaryPrefix,
  lemmaEntry,
  wikiDetails,
  type WikiDetails,
} from '../sources/providers/dewiktionary';
import { PageLoader } from './pageLoader';
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
 * whose articles differ in meaning come as `articles`, no longer merged into one translation;
 * v4: examples chosen per meaning (`meaningExamples`) and set `phrases`).
 */
const CACHE_VERSION = 'v4';
const DAY = 24 * 60 * 60 * 1000;
const FOUND_TTL = 30 * DAY;
const NOT_FOUND_TTL = DAY;
/** How long a complete offline entry waits for Wiktionary's examples before returning without them. */
const ENRICH_TIMEOUT_MS = 3000;

// ---------- Small helpers ----------

const capitalise = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const lowerFirst = (s: string) => (s.length > 1 && /\p{Lu}/u.test(s[1]) ? s : s ? s[0].toLowerCase() + s.slice(1) : s);
const unique = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];

const OTHER_LANG: Record<Lang, Lang> = { ru: 'en', en: 'ru' };

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

/** What one lookup carries through its steps. */
interface Ctx {
  lang: Lang;
  signal?: AbortSignal;
  /**
   * fillCards: providers that failed earlier in the run. They are not asked again during the
   * run, not even when every provider of a chain is cooling (no forced retries in a loop).
   */
  avoid?: Set<ProviderId>;
  /**
   * fillCards: the card already has the user's own translation, which merging keeps. No service
   * is asked to fill a translation gap (the result is then not cached).
   */
  ownTranslation?: boolean;
}

interface Step<O> {
  value: O | null;
  via: ProviderId | null;
  /** False when no answer came and some provider failed, was cooling or was skipped offline. */
  ok: boolean;
}

async function step<I, O>(ctx: Ctx, capability: string, providers: Provider<I, O>[], input: I): Promise<Step<O>> {
  const usable = ctx.avoid ? providers.filter((p) => !ctx.avoid!.has(p.id)) : providers;
  if (!usable.length) return { value: null, via: null, ok: false };
  const o = await runChainDetailed(capability, usable, input, ctx.signal);
  for (const id of o.failed) ctx.avoid?.add(id);
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

const LOCAL_DETAILS: Provider<ParsedTerm, Details> = {
  id: 'local',
  timeoutMs: localWord.timeoutMs,
  async run(parsed, signal) {
    const hit = await localWord.run({ term: parsed.term, genders: parsed.genders }, signal);
    return hit ? { kind: 'local', hit } : null;
  },
};

/** Word details: offline dictionary → de.wiktionary (entry, lemma redirect, compound fallback). */
const DETAIL_PROVIDERS: Provider<ParsedTerm, Details>[] = [LOCAL_DETAILS, deWiktionaryDetails];

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
}

/**
 * A lookup up to its last step: everything but the example sentences' translations. A single
 * lookup translates them right away (one request); fillCards translates the examples of many
 * words in one request, then finishes each word.
 */
interface Plan {
  /**
   * Sentences to translate (≤ MAX_SENTENCES examples + MAX_PHRASES phrases): a list per meaning
   * and one of fallback examples (see Sentences), for each article when the noun has articles;
   * then the phrases.
   */
  lists: string[][];
  /** The lookup with the lists' translated examples; `ok` is false when translating failed. */
  finish(examples: Example[][], ok: boolean): Resolved;
}

/** A lookup that needs no example translations. */
const planned = (r: Resolved): Plan => ({ lists: [], finish: () => r });

/** Sentences paired with translated lines (no translations when the line count doesn't match). */
function pairLines(lists: string[][], lines: string[] | null): Example[][] {
  const n = lists.reduce((sum, l) => sum + l.length, 0);
  const ok = !!lines && lines.length === n;
  let i = 0;
  return lists.map((l) =>
    l.map((de) => {
      const tr = ok ? lines![i] : '';
      i++;
      return tr ? { de, tr } : { de };
    }),
  );
}

const splitLines = (text: string) => text.split('\n').map((l) => l.trim());

/** Translate example sentences (all lists) in one request: Google → MyMemory. */
async function translateLists(lists: string[][], ctx: Ctx): Promise<{ examples: Example[][]; ok: boolean }> {
  const flat = lists.flat();
  if (!flat.length) return { examples: lists.map(() => []), ok: true };
  const s = await step(ctx, 'translate-text', TEXT_PROVIDERS, { text: flat.join('\n'), from: 'de', to: ctx.lang });
  return { examples: pairLines(lists, s.value === null ? null : splitLines(s.value)), ok: s.ok };
}

/** "the sea" → "sea": Google's translation of "die See" with the article it added. */
const stripArticle = (t: string) => t.replace(/^(?:the|a|an)\s+/i, '');

/** Translation of a word that the dictionaries have no translation for. */
async function translateWord(term: string, pos: Pos | undefined, ctx: Ctx): Promise<{ text: string; ok: boolean }> {
  if (ctx.ownTranslation) return { text: '', ok: false };
  const s = await step(ctx, 'word-translation', translationProviders(ctx.lang, pos), term);
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

const copyExample = (e: Example): Example => ({ ...e });

/** A result's examples, from one of its articles or its own translated sentences (copied). */
type ExampleFields = Pick<ArticleVariant, 'examples' | 'meaningExamples'>;

/** Set a result's examples (and meaningExamples, which it then has exactly when `x` has them). */
function putExamples(r: LookupResult, x: ExampleFields): void {
  r.examples = x.examples.map(copyExample);
  if (x.meaningExamples) r.meaningExamples = x.meaningExamples.map((l) => l.map(copyExample));
  else delete r.meaningExamples;
}

/** The result as one of its articles: that article's genders, plural, translation and examples. */
function withArticle(r: LookupResult, a: ArticleVariant): LookupResult {
  const out: LookupResult = { ...r, genders: [...a.genders], plural: a.plural, translation: a.translation };
  putExamples(out, a);
  return out;
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

// ---------- Example sentences by meaning ----------

/** Examples per meaning, taken from the Wiktionary sense the meaning matches. */
const PER_MEANING = 2;
/** Examples a card gets. */
const MAX_EXAMPLES = 3;
/** Example sentences of one word to translate, at most (fillCards sends many words per request). */
const MAX_SENTENCES = 6;
const MAX_PHRASES = 3;

/** The part of a Wiktionary page examples come from: an entry, or one article of it. */
type Page = Pick<WikiArticle, 'examples' | 'senses'>;

/** Example sentences of one translation (a result's or an article's), chosen before translating. */
interface Sentences {
  /** Per meaning of the translation, from its sense (see matchSenses); null when the page numbers no senses. */
  meanings: string[][] | null;
  /** The page's first examples, used when no meaning has one of its own. */
  fallback: string[];
}

/**
 * Examples for a translation: each meaning's from the sense it matches, up to PER_MEANING each
 * and `total` in all; when none matched (or the page numbers no senses), the page's first
 * `fallback` examples as before. `other` is the word's translation into the other language.
 */
function sentencesFor(translation: string, page: Page | null, other: string, lang: Lang, total = MAX_SENTENCES, fallback = MAX_EXAMPLES): Sentences {
  const senses = page?.senses ?? [];
  const matched = senses.length ? matchSenses(translation, senses, lang, other) : [];
  const meanings = matched.length ? meaningSentences(matched, PER_MEANING, total) : null;
  const own = meanings?.some((m) => m.length) ?? false;
  return { meanings, fallback: own ? [] : (page?.examples ?? []).slice(0, fallback) };
}

/** The lists Sentences add to a plan: one per meaning, then the fallback. */
const sentenceLists = (s: Sentences): string[][] => [...(s.meanings ?? []), s.fallback];

/** Reads a plan's translated lists back in the order they were added. */
type ListReader = (n: number) => Example[][];
function listReader(lists: Example[][]): ListReader {
  let at = 0;
  return (n) => lists.slice(at, (at += n));
}

/** Translated Sentences: the card's examples (first meaning's first, ≤ MAX_EXAMPLES) and meaningExamples. */
function readSentences(s: Sentences, read: ListReader): ExampleFields {
  const meaningExamples = s.meanings ? read(s.meanings.length) : undefined;
  const [fallback = []] = read(1);
  const examples = [...(meaningExamples ?? []).flat(), ...fallback].slice(0, MAX_EXAMPLES).map(copyExample);
  return meaningExamples ? { examples, meaningExamples } : { examples };
}

/** Set phrases of a page ("infrage stellen", "durch die Bank"). */
const phrasesOf = (entry: WikiEntry | null): WikiPhrase[] => (entry?.phrases ?? []).slice(0, MAX_PHRASES);

/**
 * What is translated of the phrases, as the plan's last list: only idioms' explanations
 * ("ohne Ausnahme" → "без исключения"). A phrase translated on its own comes out word by word
 * ("durch die Bank" → "через банк"), so a phrase without an explanation stays untranslated.
 */
const phraseList = (phrases: WikiPhrase[]): string[] => phrases.flatMap((p) => (p.note ? [p.note] : []));

/** The phrases with their explanations' translations (`notes`, in phraseList order). */
function putPhrases(r: LookupResult, phrases: WikiPhrase[], notes: Example[] | undefined): void {
  if (!phrases.length) return;
  let i = 0;
  r.phrases = phrases.map((p) => {
    const tr = p.note ? notes?.[i++]?.tr : undefined;
    return tr ? { de: p.de, tr } : { de: p.de };
  });
}

/** An article as a card would get it (one gender). */
interface ArticleDraft {
  gender: Gender;
  plural: string;
  translation: string;
  sentences: Sentences;
}

/**
 * Article variants of a noun ("der See", "die See"): the offline dictionary's entries first
 * (most common first), then Wiktionary's articles the dictionary lacks (only with translations
 * into both languages, like the dictionary's). A missing translation is asked for with the
 * article ("die See"), so Google can tell them apart. [] when the noun has one article.
 */
async function articleDrafts(local: LexEntry[], wiki: WikiEntry | null, ctx: Ctx): Promise<{ drafts: ArticleDraft[]; ok: boolean }> {
  const { lang } = ctx;
  const o = OTHER_LANG[lang];
  /** A draft before its examples are chosen; `other` is its translation into the other language. */
  type Pending = Omit<ArticleDraft, 'sentences'> & { page: Page | null; other: string };
  const drafts: Pending[] = [];
  for (const x of local) {
    const g = x.genders[0];
    const w = wikiArticle(wiki, g);
    drafts.push({
      gender: g,
      plural: x.plural || w?.plural || '',
      translation: (x.tr[lang] ?? '').trim() || (w ? formatMeanings(w.translations[lang]) : ''),
      page: w,
      other: (x.tr[o] ?? '').trim() || (w ? formatMeanings(w.translations[o]) : ''),
    });
  }
  for (const a of wiki?.articles ?? []) {
    const g = a.genders[0];
    if (!g || drafts.some((d) => d.gender === g)) continue;
    if (drafts.length && (!a.translations.ru.length || !a.translations.en.length)) continue;
    drafts.push({ gender: g, plural: a.plural, translation: formatMeanings(a.translations[lang]), page: a, other: formatMeanings(a.translations[o]) });
  }
  if (drafts.length < 2) return { drafts: [], ok: true };
  let ok = true;
  const term = local[0]?.term ?? wiki?.title ?? '';
  for (const d of drafts) {
    if (d.translation) continue;
    const t = await translateWord(`${ARTICLE[d.gender]} ${term}`, 'noun', ctx);
    d.translation = stripArticle(t.text);
    ok &&= t.ok;
  }
  // Up to 2 examples per article without senses, as before; MAX_SENTENCES shared out with them.
  const total = Math.max(1, Math.floor(MAX_SENTENCES / drafts.length));
  return {
    drafts: drafts.map(({ page, other, ...d }) => ({ ...d, sentences: sentencesFor(d.translation, page, other, lang, total, 2) })),
    ok,
  };
}

/** Example sentences to translate for article drafts, article by article. */
const draftLists = (drafts: ArticleDraft[]) => drafts.flatMap((d) => sentenceLists(d.sentences));

/** Article drafts with their translated examples, as the result's `articles`. */
const draftArticles = (drafts: ArticleDraft[], read: ListReader): ArticleVariant[] =>
  drafts.map((d) => ({ genders: [d.gender], plural: d.plural, translation: d.translation, ...readSentences(d.sentences, read) }));

/** Wiktionary's entry for an offline-dictionary hit; ok is false when it failed, was cooling or offline. */
interface LocalWiki {
  entry: WikiEntry | null;
  ok: boolean;
}

/** One request for the entry of an offline hit; a complete offline entry doesn't wait long for it. */
async function localWiki(e: LexEntry, ctx: Ctx): Promise<LocalWiki> {
  if (isCooling('de.wiktionary')) return { entry: null, ok: false };
  const localComplete = !!(e.tr[ctx.lang] ?? '').trim() && grammarComplete(e);
  const provider = localComplete ? { ...deWiktionaryEntry, timeoutMs: ENRICH_TIMEOUT_MS } : deWiktionaryEntry;
  const s = await step(ctx, 'word-examples', [provider], e.term);
  return { entry: s.value, ok: s.ok };
}

/** Offline-dictionary hit, plus examples (and gaps) from its Wiktionary entry when that answered. */
async function planLocal(hit: LocalHit, wikiStep: LocalWiki, parsed: ParsedTerm, ctx: Ctx): Promise<Plan> {
  const { lang } = ctx;
  const e = hit.entry;
  const localTr = (e.tr[lang] ?? '').trim();

  let complete = wikiStep.ok;
  const wiki = wikiStep.entry;
  const same = wiki && (e.pos === 'other' || wiki.pos === e.pos) ? wiki : null;
  const pos: Pos = e.pos !== 'other' ? e.pos : (same?.pos ?? 'other');

  // A noun whose articles differ in meaning: every article, the hit's one as the result.
  const gender = e.pos === 'noun' ? e.genders[0] : undefined;
  const split = gender ? await articleDrafts(await articleVariants(e), same, ctx) : { drafts: [], ok: true };
  complete &&= split.ok;
  const mine = split.drafts.find((d) => d.gender === gender);
  // Translations and examples of the matching article only (not "die See"'s for "der See").
  const own = gender && same?.articles ? wikiArticle(same, gender) : same;

  let translation = localTr || mine?.translation || (own ? formatMeanings(own.translations[lang]) : '');
  if (!translation) {
    const t = await translateWord(e.term, pos, ctx);
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
  const done = (ok: boolean): Resolved => {
    if (hit.form && hit.form !== e.term) result.lemmaOf = hit.form;
    return { result, via: 'local', complete: complete && ok, detailsMissing: false };
  };
  const phrases = phrasesOf(same);
  if (mine) {
    return {
      lists: [...draftLists(split.drafts), phraseList(phrases)],
      finish(examples, ok) {
        const read = listReader(examples);
        result.articles = draftArticles(split.drafts, read);
        putExamples(result, result.articles.find((a) => a.genders[0] === gender)!);
        putPhrases(result, phrases, read(1)[0]);
        return done(ok);
      },
    };
  }
  const other = (e.tr[OTHER_LANG[lang]] ?? '').trim() || (own ? formatMeanings(own.translations[OTHER_LANG[lang]]) : '');
  const sentences = sentencesFor(translation, own, other, lang);
  return {
    lists: [...sentenceLists(sentences), phraseList(phrases)],
    finish(examples, ok) {
      const read = listReader(examples);
      putExamples(result, readSentences(sentences, read));
      putPhrases(result, phrases, read(1)[0]);
      return done(ok);
    },
  };
}

async function planWiki(details: WikiDetails, parsed: ParsedTerm, ctx: Ctx): Promise<Plan> {
  const done = (result: LookupResult, complete: boolean): Resolved => ({ result, via: 'de.wiktionary', complete, detailsMissing: false });

  if (details.kind === 'compound') {
    const t = await translateWord(details.word, 'noun', ctx);
    return planned(
      done(
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
      ),
    );
  }

  const { entry, lemmaOf } = details;
  let complete = true;
  let translation = formatMeanings(entry.translations[ctx.lang]);
  if (!translation) {
    const t = await translateWord(entry.title, entry.pos, ctx);
    translation = t.text;
    complete = t.ok;
  }
  const split = entry.pos === 'noun' && entry.articles ? await articleDrafts([], entry, ctx) : null;
  if (split) complete &&= split.ok;
  const phrases = phrasesOf(entry);

  const build = (own: ExampleFields, articles: ArticleVariant[] | undefined, phraseExamples: Example[] | undefined, ok: boolean): Resolved => {
    const result: LookupResult = {
      term: entry.title,
      pos: entry.pos,
      genders: entry.genders.length ? entry.genders : entry.pos === 'noun' ? parsed.genders : [],
      plural: entry.plural || (entry.pos === 'noun' ? (parsed.plural ?? '') : ''),
      praeteritum: entry.praeteritum || (entry.pos === 'verb' ? (parsed.praeteritum ?? '') : ''),
      partizip2: entry.partizip2 || (entry.pos === 'verb' ? (parsed.partizip2 ?? '') : ''),
      auxiliary: entry.auxiliary || (entry.pos === 'verb' ? (parsed.auxiliary ?? '') : ''),
      translation: articles && !translation ? articles[0].translation : translation,
      examples: [],
      source: 'wiktionary',
    };
    putExamples(result, own);
    putPhrases(result, phrases, phraseExamples);
    if (articles) result.articles = articles;
    if (lemmaOf) result.lemmaOf = lemmaOf;
    return done(result, complete && ok);
  };
  if (split?.drafts.length) {
    const drafts = split.drafts;
    return {
      lists: [...draftLists(drafts), phraseList(phrases)],
      finish(examples, ok) {
        const read = listReader(examples);
        const articles = draftArticles(drafts, read);
        return build(articles[0], articles, read(1)[0], ok);
      },
    };
  }
  const sentences = sentencesFor(translation, entry, formatMeanings(entry.translations[OTHER_LANG[ctx.lang]]), ctx.lang);
  return {
    lists: [...sentenceLists(sentences), phraseList(phrases)],
    finish(examples, ok) {
      const read = listReader(examples);
      return build(readSentences(sentences, read), undefined, read(1)[0], ok);
    },
  };
}

/** What the word-details step found. */
type Found =
  /** An offline-dictionary hit, with Wiktionary's entry for its lemma (examples, gaps). */
  | { kind: 'local'; hit: LocalHit; wiki: LocalWiki }
  | { kind: 'wiki'; details: WikiDetails }
  /** Nothing; `ok` is false when a source failed, was cooling or offline. */
  | { kind: 'none'; ok: boolean };

/** Word details for one word: offline dictionary, else de.wiktionary (one request per page). */
async function find(parsed: ParsedTerm, ctx: Ctx): Promise<Found> {
  const d = await step(ctx, 'word-details', DETAIL_PROVIDERS, parsed);
  if (d.value?.kind === 'local') return { kind: 'local', hit: d.value.hit, wiki: await localWiki(d.value.hit.entry, ctx) };
  if (d.value) return { kind: 'wiki', details: d.value };
  return { kind: 'none', ok: d.ok };
}

async function plan(found: Found, parsed: ParsedTerm, ctx: Ctx): Promise<Plan> {
  if (found.kind === 'local') return planLocal(found.hit, found.wiki, parsed, ctx);
  if (found.kind === 'wiki') return planWiki(found.details, parsed, ctx);

  // Last resort: a translation-only result (no grammar beyond what was typed).
  const s = await step(ctx, 'word-translation', translationProviders(ctx.lang, parsed.pos), parsed.term);
  const base = { complete: found.ok && s.ok, detailsMissing: !found.ok };
  if (!s.value) return planned({ ...base, result: null, via: null });
  const pos: Pos = parsed.pos ?? s.value.pos ?? 'other';
  return planned({
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
  });
}

async function resolve(parsed: ParsedTerm, ctx: Ctx): Promise<Resolved> {
  const p = await plan(await find(parsed, ctx), parsed, ctx);
  const ex = await translateLists(p.lists, ctx);
  return p.finish(ex.examples, ex.ok);
}

interface Lookup extends Resolved {
  fromCache: boolean;
}

/** A word to look up: parsed input, its cache key, and the cached lookup if there is one. */
interface Prepared {
  parsed: ParsedTerm;
  key: string;
  cached: Lookup | null;
}

const NONE = { result: null, via: null, complete: true, detailsMissing: false } as const;

async function prepare(input: string, lang: Lang): Promise<Prepared> {
  const parsed = parseGermanInput(input.normalize('NFC'));
  const key = `${CACHE_VERSION}:${lang}:${parsed.term}`;
  if (!parsed.term) return { parsed, key, cached: { ...NONE, fromCache: true } };
  const cached = await readCache(key);
  // "See" and "die See" share the row: it holds the first article; a typed one is picked here.
  const result = cached.result ? preferArticle(cached.result, parsed.genders) : null;
  return { parsed, key, cached: cached.hit ? { ...NONE, result, via: cached.via, fromCache: true } : null };
}

/** Cache a finished lookup (when complete) and return it with the typed article picked. */
async function store(w: Prepared, r: Resolved): Promise<Lookup> {
  const canonical = r.result?.articles ? withArticle(r.result, r.result.articles[0]) : r.result;
  if (r.complete) await writeCache(w.key, canonical, r.via);
  return { ...r, result: canonical ? preferArticle(canonical, w.parsed.genders) : null, fromCache: false };
}

async function lookupWithCache(input: string, lang: Lang, signal?: AbortSignal): Promise<Lookup> {
  const w = await prepare(input, lang);
  if (w.cached) return w.cached;
  return store(w, await resolve(w.parsed, { lang, signal }));
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

// ---------- Filling many cards ----------

/** Batch size and the pause between batches of fillCards (exported so tests can change them). */
export const fillTiming = { batchSize: 50, batchGapMs: 500 };
/** Example sentences sent to Google in one fillCards request, at most this many characters. */
const MAX_BATCH_TEXT = 4000;

/** Google for a batch of example sentences: a longer text, so a longer timeout. */
const googleBatch: Provider<TextQuery, string> = { ...googlePlain, timeoutMs: 10_000 };

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
}

/**
 * Example translations of many lookups: one Google request per ~4000 characters, the lines
 * mapped back to each word. When Google fails, is cooling or answers with another number of
 * lines, those words are translated one by one as a single lookup would (Google → MyMemory;
 * MyMemory takes at most 500 bytes per query, so it is never sent a batch).
 */
async function translatePlans(plans: Plan[], ctx: Ctx): Promise<{ examples: Example[][]; ok: boolean }[]> {
  const out = plans.map((p) => ({ examples: p.lists.map((): Example[] => []), ok: true }));
  const chunks: number[][] = [];
  let size = 0;
  plans.forEach((p, i) => {
    const flat = p.lists.flat();
    if (!flat.length) return;
    const len = flat.join('\n').length + 1;
    if (!chunks.length || size + len > MAX_BATCH_TEXT) {
      chunks.push([]);
      size = 0;
    }
    chunks.at(-1)!.push(i);
    size += len;
  });

  for (const chunk of chunks) {
    const flat = chunk.flatMap((i) => plans[i].lists.flat());
    let lines: string[] | null = null;
    // A lone word goes the single-lookup way at once; a cooling Google isn't forced.
    if (chunk.length > 1 && !isCooling('google') && !ctx.avoid?.has('google')) {
      const s = await step(ctx, 'translate-text', [googleBatch], { text: flat.join('\n'), from: 'de', to: ctx.lang });
      if (s.value !== null) lines = splitLines(s.value);
    }
    if (lines && lines.length === flat.length) {
      let at = 0;
      for (const i of chunk) {
        const n = plans[i].lists.flat().length;
        out[i] = { examples: pairLines(plans[i].lists, lines.slice(at, at + n)), ok: true };
        at += n;
      }
    } else {
      for (const i of chunk) out[i] = await translateLists(plans[i].lists, ctx);
    }
  }
  return out;
}

/**
 * Lookups of one batch of cards, with the same results (and cache rows) as one lookup per card:
 * cache and offline dictionary first, then every Wiktionary page the words need in batched
 * requests (a round per spelling variant / lemma / compound head still needed), then one
 * translation request for all example sentences. Null for a card whose lookup broke.
 */
async function lookupBatch(cards: Card[], lang: Lang, avoid: Set<ProviderId>, signal?: AbortSignal): Promise<(Lookup | null)[]> {
  const shared: Ctx = { lang, signal, avoid };
  const words = await Promise.all(cards.map((c) => prepare(c.term, lang)));
  const out: (Lookup | null)[] = words.map((w) => w.cached);
  const todo = words.flatMap((w, i) => (w.cached ? [] : [i]));
  if (!todo.length) return out;

  // Offline dictionary.
  const local: Step<Details>[] = [];
  for (const i of todo) local[i] = await step(shared, 'word-details', [LOCAL_DETAILS], words[i].parsed);
  throwIfAborted(signal);

  // Wiktionary pages, batched. A refusal puts Wiktionary in cooldown: the rest of the run goes on without it.
  const loader = new PageLoader(async (q) => {
    if (avoid.has('de.wiktionary') || isCooling('de.wiktionary')) throw new SourceUnavailableError();
    const o = await runChainDetailed('word-pages', [deWiktionaryPages], q, signal);
    for (const id of o.failed) avoid.add(id);
    if (!o.result) throw new SourceUnavailableError();
    return o.result.value;
  });
  const settled = await loader.all(
    todo.map((i) => async (): Promise<Found> => {
      const l = local[i];
      if (l.value?.kind === 'local') {
        const { hit } = l.value;
        try {
          return { kind: 'local', hit, wiki: { entry: await lemmaEntry(hit.entry.term, loader), ok: true } };
        } catch {
          return { kind: 'local', hit, wiki: { entry: null, ok: false } };
        }
      }
      try {
        const details = await wikiDetails(words[i].parsed, loader);
        return details ? { kind: 'wiki', details } : { kind: 'none', ok: l.ok };
      } catch {
        return { kind: 'none', ok: false };
      }
    }),
  );
  throwIfAborted(signal);

  // Each word up to its examples (a translation gap is still asked for per word, see translateWord).
  const plans: (Plan | null)[] = [];
  for (const [k, i] of todo.entries()) {
    throwIfAborted(signal);
    const s = settled[k];
    const found: Found = s.status === 'fulfilled' ? s.value : { kind: 'none', ok: false };
    if (found.kind === 'none' && !found.ok) {
      // No grammar source answered: the card stays "needs fill", so no translation is asked for.
      out[i] = { result: null, via: null, complete: false, detailsMissing: true, fromCache: false };
      continue;
    }
    try {
      plans[i] = await plan(found, words[i].parsed, { ...shared, ownTranslation: !!cards[i].translation.trim() });
    } catch (e) {
      if (isAbortError(e) || signal?.aborted) throw e;
    }
  }

  // Example sentences of the whole batch.
  const ready = todo.filter((i) => plans[i]);
  const examples = await translatePlans(
    ready.map((i) => plans[i]!),
    shared,
  );
  for (const [k, i] of ready.entries()) out[i] = await store(words[i], plans[i]!.finish(examples[k].examples, examples[k].ok));
  return out;
}

/**
 * Save a lookup into the card as it is in the DB right now: filling runs in the background, so
 * the user may have edited the card (their edits win, only empty fields are filled) or deleted
 * it (it isn't re-created). Read and write happen in one transaction. False when it's gone.
 */
async function saveFilled(card: Card, result: LookupResult | null): Promise<boolean> {
  const fill = (c: Card): Card => (result ? mergeIntoCard(c, result) : { ...c, needsFill: 0 });
  const id = card.id;
  if (id === undefined) {
    await saveCard(fill(card));
    return true;
  }
  return db.transaction('rw', db.cards, async () => {
    const fresh = await db.cards.get(id);
    if (!fresh) return false;
    await saveCard(fill(fresh));
    return true;
  });
}

/**
 * Auto-fill many cards (import / "fill later") in batches of 50, saving each to the DB in order
 * and clearing needsFill. Each card is merged into its current DB copy (see saveFilled); a card
 * deleted meanwhile is skipped and not counted. Results are the same as looking up each card on its own, with far
 * fewer requests (see lookupBatch). A word whose grammar sources all failed, were cooling or
 * offline counts as failed and keeps needsFill = 1; a source that refuses is not asked again
 * during the run. Short pause between batches; stops early when aborted (unsaved cards keep
 * needsFill = 1).
 */
export async function fillCards(
  cards: Card[],
  lang: Lang,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<{ filled: number; notFound: number; failed: number }> {
  const counts = { filled: 0, notFound: 0, failed: 0 };
  const avoid = new Set<ProviderId>();
  const size = Math.max(1, fillTiming.batchSize);
  let done = 0;
  let asked = false;

  for (let start = 0; start < cards.length; start += size) {
    if (signal?.aborted) break;
    if (asked) {
      await sleep(fillTiming.batchGapMs, signal);
      if (signal?.aborted) break;
    }
    const batch = cards.slice(start, start + size);
    let outcomes: (Lookup | null)[];
    try {
      outcomes = await lookupBatch(batch, lang, avoid, signal);
    } catch (e) {
      if (isAbortError(e) || signal?.aborted) break;
      outcomes = batch.map(() => null);
    }
    asked = outcomes.some((o) => !o?.fromCache);

    for (const [i, card] of batch.entries()) {
      if (signal?.aborted) return counts;
      const outcome = outcomes[i];
      try {
        if (!outcome || outcome.detailsMissing || (!outcome.result && !outcome.complete)) {
          counts.failed++;
        } else if (await saveFilled(card, outcome.result)) {
          if (outcome.result) counts.filled++;
          else counts.notFound++;
        }
      } catch {
        counts.failed++;
      }
      onProgress?.(++done, cards.length);
    }
  }
  return counts;
}
