import type { Auxiliary, Gender, Lang, Pos } from '../types';
import { checkResponse, SourceError } from '../sources/chain';
import { mergeMeanings, pickMeanings, sameMeaning, type SenseTranslations } from './meanings';

const API = 'https://de.wiktionary.org/w/api.php';

/** One article of a noun whose articles differ in meaning (see WikiEntry.articles). */
export interface WikiArticle {
  genders: Gender[];
  plural: string;
  translations: Record<Lang, string[][]>;
  examples: string[];
}

export interface WikiEntry {
  title: string;
  pos: Pos;
  genders: Gender[];
  plural: string;
  praeteritum: string;
  partizip2: string;
  auxiliary: Auxiliary;
  /**
   * Translations grouped by meaning, best first: meanings → synonyms, e.g. Folge (ru) →
   * [["последствие"], ["череда", "ряд"], ["эпизод"]]. Format with formatMeanings (./meanings).
   */
  translations: Record<Lang, string[][]>;
  examples: string[];
  /** For inflected forms ("ging", "Häuser"): the dictionary form. */
  lemma?: string;
  /**
   * Nouns whose articles differ in meaning ("der See" lake, "die See" sea): one entry per
   * article in page order; the entry's own genders/plural/translations/examples are the
   * first one's. Absent for gender variants of one meaning (der/das Teil: genders [n, m]).
   */
  articles?: WikiArticle[];
}

/** Wiktionary refused the request (HTTP 429/503). */
export class RateLimitError extends SourceError {
  constructor(message: string, status = 429) {
    super(message, { status, refusal: true });
    this.name = 'RateLimitError';
  }
}

/**
 * One API request. Rate limits are not retried here: the source chain puts Wiktionary in
 * cooldown and asks the next source instead.
 */
async function api(params: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
  const url = `${API}?${new URLSearchParams({ ...params, format: 'json', formatversion: '2', origin: '*' })}`;
  const res = await fetch(url, { signal });
  if (res.status === 429 || res.status === 503) {
    throw new RateLimitError('Wiktionary is rate-limiting requests. Try again in a minute.', res.status);
  }
  checkResponse(res, 'Wiktionary');
  return res.json();
}

/** Raw wikitext of a page, or null if it doesn't exist. Follows redirects. */
export async function fetchWikitext(title: string, signal?: AbortSignal): Promise<string | null> {
  const data = (await api({ action: 'parse', page: title, prop: 'wikitext', redirects: '1' }, signal)) as {
    parse?: { wikitext: string };
    error?: { code: string };
  };
  if (data.error) {
    if (data.error.code === 'missingtitle' || data.error.code === 'invalidtitle') return null;
    if (data.error.code === 'ratelimited') throw new RateLimitError('Wiktionary is rate-limiting requests.');
    throw new SourceError(`Wiktionary error ${data.error.code}`);
  }
  return data.parse?.wikitext ?? null;
}

/** Titles per request (the API's limit without a bot account). */
export const MAX_TITLES = 50;
/** Longest "titles" parameter (URL-encoded) sent in one GET request. */
const MAX_TITLES_CHARS = 4000;
/** Follow-up requests for pages a response left out, at most (guards against a loop). */
const MAX_PAGE_REQUESTS = 20;

/** Titles split into requests of at most MAX_TITLES titles and MAX_TITLES_CHARS URL characters. */
export function titleChunks(titles: string[]): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  let size = 0;
  for (const t of titles) {
    const len = encodeURIComponent(t).length + 3; // "|" encoded
    if (cur.length && (cur.length >= MAX_TITLES || size + len > MAX_TITLES_CHARS)) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(t);
    size += len;
  }
  if (cur.length) out.push(cur);
  return out;
}

interface QueryPage {
  title: string;
  missing?: boolean;
  invalid?: boolean;
  revisions?: { slots?: { main?: { content?: unknown } } }[];
}

interface QueryResponse {
  query?: { normalized?: { from: string; to: string }[]; redirects?: { from: string; to: string }[]; pages?: QueryPage[] };
  error?: { code: string };
}

/**
 * Raw wikitext of many pages: one request per 50 titles instead of one per page. Follows
 * redirects like fetchWikitext and maps normalized/redirected titles back to the requested
 * ones. A response cut short by the API's size limit (pages without content) is continued with
 * the pages it left out. Returns each requested title's wikitext, or null when the page
 * doesn't exist (or the title is invalid); titles the API never sent content for are absent.
 */
export async function fetchWikitexts(titles: string[], signal?: AbortSignal): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  let queue: string[] = [];
  for (const t of new Set(titles)) {
    // "|" separates titles; the single-page API calls such titles invalid as well.
    if (!t.trim() || t.includes('|')) out.set(t, null);
    else queue.push(t);
  }
  for (let requests = 0; queue.length && requests < MAX_PAGE_REQUESTS; ) {
    const next: string[] = [];
    for (const chunk of titleChunks(queue)) {
      if (requests++ >= MAX_PAGE_REQUESTS) break;
      const data = (await api(
        { action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', titles: chunk.join('|'), redirects: '1' },
        signal,
      )) as QueryResponse;
      if (data.error) {
        if (data.error.code === 'ratelimited') throw new RateLimitError('Wiktionary is rate-limiting requests.');
        throw new SourceError(`Wiktionary error ${data.error.code}`);
      }
      const normalized = new Map((data.query?.normalized ?? []).map((n) => [n.from, n.to]));
      const redirects = new Map((data.query?.redirects ?? []).map((r) => [r.from, r.to]));
      const pages = new Map((data.query?.pages ?? []).map((p) => [p.title, p]));
      const left: string[] = [];
      for (const t of chunk) {
        const n = normalized.get(t) ?? t;
        const page = pages.get(redirects.get(n) ?? n);
        const content = page?.revisions?.[0]?.slots?.main?.content;
        if (typeof content === 'string') out.set(t, content);
        else if (!page || page.missing || page.invalid) out.set(t, null);
        else left.push(t);
      }
      // Pages without content: the response hit the size limit; ask again for the rest. A
      // response that sent no content at all is not asked again.
      if (left.length < chunk.length) next.push(...left);
    }
    queue = next;
  }
  return out;
}

/** Which of the given titles exist (one request for up to 50 titles). */
export async function existingTitles(titles: string[], signal?: AbortSignal): Promise<Set<string>> {
  const data = (await api({ action: 'query', titles: titles.slice(0, 50).join('|') }, signal)) as {
    query?: { pages?: { title: string; missing?: boolean }[] };
  };
  return new Set((data.query?.pages ?? []).filter((p) => !p.missing).map((p) => p.title));
}

/** Prefix search: "Hausschl" → ["Hausschlüssel", …]. */
export async function prefixSearch(prefix: string, limit = 8, signal?: AbortSignal): Promise<string[]> {
  const data = (await api({ action: 'opensearch', search: prefix, limit: String(limit), namespace: '0' }, signal)) as [
    string,
    string[],
  ];
  return data[1] ?? [];
}

// ---------- Parsing ----------

/** Only the "== X ({{Sprache|Deutsch}}) ==" section of a page. */
export function germanSection(wikitext: string): string | null {
  const start = wikitext.search(/^== [^\n]*\{\{Sprache\|Deutsch\}\}[^\n]*==[ \t]*$/m);
  if (start < 0) return null;
  const rest = wikitext.slice(start);
  const next = rest.slice(3).search(/^== (?!=)/m);
  return next < 0 ? rest : rest.slice(0, next + 3);
}

/** Split a language section into "=== {{Wortart|…}} ===" blocks. */
function posBlocks(section: string): { header: string; body: string }[] {
  const lines = section.split('\n');
  const blocks: { header: string; body: string[] }[] = [];
  for (const line of lines) {
    if (/^=== (?!=)/.test(line)) blocks.push({ header: line, body: [] });
    else blocks.at(-1)?.body.push(line);
  }
  return blocks.map((b) => ({ header: b.header, body: b.body.join('\n') }));
}

/** Named parameters of the first {{Name …}} template, e.g. Deutsch Substantiv Übersicht. */
export function templateParams(text: string, name: string): Record<string, string> | null {
  const start = text.indexOf(`{{${name}`);
  if (start < 0) return null;
  // Find the matching closing braces (templates may be nested).
  let depth = 0;
  let end = start;
  for (let i = start; i < text.length - 1; i++) {
    if (text[i] === '{' && text[i + 1] === '{') {
      depth++;
      i++;
    } else if (text[i] === '}' && text[i + 1] === '}') {
      depth--;
      i++;
      if (depth === 0) {
        end = i - 1;
        break;
      }
    }
  }
  const inner = text.slice(start + 2 + name.length, end);
  const params: Record<string, string> = {};
  // Split at pipes that start a "name=" pair, so "|Bild=x.jpg|mini|1" stays one value.
  for (const part of inner.split(/\|(?=[^=|{}[\]\n]+=)/)) {
    const eq = part.indexOf('=');
    if (eq > 0) params[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return params;
}

function wortarten(header: string): string[] {
  return [...header.matchAll(/\{\{Wortart\|([^|}]+)\|Deutsch\}\}/g)].map((m) => m[1]);
}

function posOf(kinds: string[]): Pos {
  if (kinds.includes('Substantiv')) return 'noun';
  if (kinds.includes('Verb')) return 'verb';
  if (kinds.includes('Adjektiv')) return 'adj';
  return 'other';
}

const INFLECTED = /Konjugierte Form|Deklinierte Form|Partizip I|Komparativ|Superlativ/;

const GENDERS: Record<string, Gender> = { m: 'm', f: 'f', n: 'n' };

/** Strip wiki markup from a line of running text. */
export function stripMarkup(s: string): string {
  let out = s
    .replace(/<ref[^>]*\/>/g, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/'{2,}/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
  // Remove remaining templates, innermost first.
  for (let i = 0; i < 5 && /\{\{/.test(out); i++) out = out.replace(/\{\{[^{}]*\}\}/g, '');
  return out.replace(/\s+/g, ' ').trim();
}

/** Short, self-made example sentences first; long literary quotes with references are skipped. */
function parseExamples(body: string): string[] {
  const m = body.match(/\{\{Beispiele\}\}\n([\s\S]*?)(?:\n\n|\n\{\{|$)/);
  if (!m) return [];
  const all = m[1]
    .split('\n')
    .filter((l) => l.startsWith(':'))
    .map((l) => ({ quoted: /<ref|„/.test(l), text: stripMarkup(l.replace(/^:+\s*(\[[^\]]*\])?\s*/, '')) }))
    .filter((e) => e.text.length > 3 && e.text.length <= 140);
  const own = all.filter((e) => !e.quoted).map((e) => e.text);
  const quotes = all.filter((e) => e.quoted).map((e) => e.text.replace(/^„|“$/g, ''));
  return [...new Set([...own, ...quotes])].slice(0, 3);
}

/** Usage labels that make a sense second-rate (colloquial, dated, regional, jargon, figurative, …). */
const MARGINAL_LABEL =
  /(?<!\p{L})(ugs|umgangssprachlich|salopp|derb|vulg|vulgär|abw|abwertend|pejorativ|veraltet|veraltend|landsch|landschaftlich|regional|dialektal|mundartlich|scherzh|scherzhaft|Jugendspr|Jugendsprache|Jägerspr|Jägersprache|Seemannsspr|Seemannssprache|übertr|übertragen|fachspr|fachsprachlich|poet|poetisch|gehoben|selten|historisch|österr|schweiz|süddt|norddt|Schach)(?!\p{L})/iu;

/** Sense numbers (never 1) whose definition carries a usage label: ":[3] {{K|ugs.}} …". */
function marginalSenses(body: string): Set<number> {
  const out = new Set<number>();
  const m = body.match(/\{\{Bedeutungen\}\}\n([\s\S]*?)(?:\n\n|\n\{\{(?!K\|)|$)/);
  for (const line of (m?.[1] ?? '').split('\n')) {
    const d = line.match(/^:\[(\d+)\]\s*((?:\{\{[^{}]*\}\}\s*|''[^']*''\s*)*)/);
    if (d && Number(d[1]) !== 1 && MARGINAL_LABEL.test(d[2])) out.add(Number(d[1]));
  }
  return out;
}

/** Inner text of every {{Ü-Tabelle …}} in the block (nested templates included). */
function translationTables(body: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const start = body.indexOf('{{Ü-Tabelle', from);
    if (start < 0) return out;
    let depth = 0;
    let end = body.length;
    for (let i = start; i < body.length - 1; i++) {
      if (body[i] === '{' && body[i + 1] === '{') {
        depth++;
        i++;
      } else if (body[i] === '}' && body[i + 1] === '}') {
        depth--;
        i++;
        if (depth === 0) {
          end = i - 1;
          break;
        }
      }
    }
    out.push(body.slice(start + '{{Ü-Tabelle'.length, end));
    from = end;
  }
}

/** Sense number of translations that name no sense. */
const UNNUMBERED = 99;

/** First number of a sense marker: "[2]" → 2, "[1, 2]" → 1, "[1–3]" → 1. */
const markerNumber = (m: string) => Number(m.match(/\d+/)?.[0] ?? 0);

/**
 * A translation line split at top-level "," and ";" (not inside templates, links or
 * parentheses); sense markers ("[2]", "[1, 2]") become segments of their own.
 */
export function lineSegments(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  let braces = 0;
  let links = 0;
  let parens = 0;
  const flush = () => {
    if (cur.trim()) out.push(cur.trim());
    cur = '';
  };
  for (let i = 0; i < text.length; i++) {
    const two = text.slice(i, i + 2);
    if (two === '{{' || two === '}}' || two === '[[' || two === ']]') {
      if (two === '{{') braces++;
      else if (two === '}}') braces = Math.max(0, braces - 1);
      else if (two === '[[') links++;
      else links = Math.max(0, links - 1);
      cur += two;
      i++;
      continue;
    }
    const c = text[i];
    const top = !braces && !links;
    if (top && c === '(') parens++;
    if (top && c === ')') parens = Math.max(0, parens - 1);
    if (top && !parens && (c === ',' || c === ';')) {
      flush();
      continue;
    }
    if (top && !parens && c === '[') {
      const close = text.indexOf(']', i);
      const inner = close < 0 ? '' : text.slice(i + 1, close);
      if (/^[\d\s,–\-a-z]+$/.test(inner) && /\d/.test(inner)) {
        flush();
        out.push(`[${inner}]`);
        i = close;
        continue;
      }
    }
    cur += c;
  }
  flush();
  return out;
}

/** Italic notes that only say aspect or grammar ("''imperfektiv:''"), unlike "''besonders Schottland:''". */
const NEUTRAL_NOTE = /^(?:(?:im)?perfektiv|(?:in)?transitiv|reflexiv|Plural|Singular|Pl\.|Sg\.|auch|meist|oft)\s*:?$/i;

/** One translation of a segment ("to {{Ü|en|call}} ({{Ü|en|on}})" → "call"), and whether a usage note labels it. */
function segmentWord(seg: string, lang: Lang): { word: string; labelled: boolean } | null {
  const tpl = new RegExp(`\\{\\{Üt?\\??\\|${lang}\\|([^|}]*)(?:\\|[^{}]*)?\\}\\}`, 'g');
  if (!tpl.test(seg)) return null;
  const notes = [...seg.matchAll(/''([^'\n]*)''/g)].map((m) => stripMarkup(m[1].replace(tpl, '$1')));
  const labelled = notes.some((n) => n && !NEUTRAL_NOTE.test(n) && !/^\(.*\)$/.test(n));
  let text = seg.replace(tpl, '$1').replace(/''[^'\n]*''/g, ' ');
  for (let i = 0; i < 3; i++) text = text.replace(/\([^()]*\)/g, ' ');
  let word = stripMarkup(text).replace(/[:.]+$/, '').trim();
  if (lang === 'en') word = word.replace(/^to\s+/i, '');
  // Russian stress marks ("заве́дующий").
  if (lang === 'ru') word = word.normalize('NFD').replace(/\u0301/g, '').normalize('NFC');
  return word ? { word, labelled } : null;
}

/**
 * Translations into `lang` per sense. Current pages have one table per sense
 * ("{{Ü-Tabelle|2|G=…|Ü-Liste=…}}"); older ones a single table whose lines switch senses with
 * markers ("*{{en}}: [1] {{Ü|en|x}}; [2] {{Ü|en|y}}"). A word after a usage note
 * ("''besonders [[Schottland]]:'' {{Ü|en|house}}") counts as labelled. A sense's weight is the
 * number of languages translating it.
 */
export function parseSenseTranslations(body: string, lang: Lang): SenseTranslations[] {
  const senses = new Map<number, { words: SenseTranslations['words']; langs: Set<string> }>();
  const sense = (n: number) => {
    let s = senses.get(n);
    if (!s) senses.set(n, (s = { words: [], langs: new Set() }));
    return s;
  };
  for (const table of translationTables(body)) {
    // "{{Ü-Tabelle|6a|…}}" is part of sense 6; a table without a number comes last.
    const own = table.match(/^\|\s*(\d+)[a-z]?\s*\|/);
    const tableN = own ? Number(own[1]) : UNNUMBERED;
    const list = table.split(/\|Dialekttabelle=/)[0];
    for (const line of list.split('\n')) {
      const l = line.match(/^\*\s*\{\{([a-z]{2,3}(?:-[a-z]+)?)(?:\|[^}]*)?\}\}[^:]*:(.*)$/);
      if (!l) continue;
      const segments = lineSegments(l[2]);
      const markers = own ? [] : segments.filter((x) => x.startsWith('[')).map(markerNumber);
      for (const n of markers.length ? markers : [tableN]) sense(n).langs.add(l[1]);
      if (l[1] !== lang) continue;
      // A marker moves the following words to another sense, also inside a numbered table
      // ("{{Üt|ru|приходить}}; [4] {{Üt|ru|кончить}}" in the table of sense 2).
      let n = tableN;
      for (const seg of segments) {
        if (seg.startsWith('[')) {
          n = markerNumber(seg) || tableN;
          continue;
        }
        const w = segmentWord(seg, lang);
        const s = sense(n);
        if (w && !s.words.some((x) => x.word === w.word)) s.words.push(w);
      }
    }
  }
  return [...senses].map(([n, s]) => ({ n, words: s.words, weight: s.langs.size }));
}

/** Meanings of a part-of-speech block in `lang` (see pickMeanings). */
function parseTranslations(body: string, lang: Lang): string[][] {
  return pickMeanings(parseSenseTranslations(body, lang), marginalSenses(body));
}

function lemmaOf(body: string): string | undefined {
  const m = body.match(/\{\{Grundformverweis[^|}]*\|([^|}]+)/);
  return m?.[1].trim();
}

function firstValue(params: Record<string, string>, keys: string[]): string {
  for (const k of keys) {
    const v = params[k];
    if (v && v !== '—' && v !== '-' && v !== '?') return stripMarkup(v);
  }
  return '';
}

/** Parse a page's wikitext into a German dictionary entry (null if the page has no German section). */
export function parseEntry(title: string, wikitext: string): WikiEntry | null {
  const section = germanSection(wikitext);
  if (!section) return null;
  const blocks = posBlocks(section);
  if (blocks.length === 0) return null;

  // Inflected-form pages ("ging", "Häuser", "gegangen") only point to the lemma.
  const lemmaBlock = blocks.find((b) => INFLECTED.test(b.header) && lemmaOf(b.body));
  const lexical = blocks.filter((b) => !INFLECTED.test(b.header));
  if (lexical.length === 0 && lemmaBlock) {
    return {
      title,
      pos: 'other',
      genders: [],
      plural: '',
      praeteritum: '',
      partizip2: '',
      auxiliary: '',
      translations: { en: [], ru: [] },
      examples: [],
      lemma: lemmaOf(lemmaBlock.body),
    };
  }

  const main = lexical[0];
  const pos = posOf(wortarten(main.header));
  // Blocks of the same part of speech are merged ("die Bank" bench + bank, der/das Teil);
  // noun blocks whose article and meaning both differ ("der See", "die See") are articles.
  const same = lexical.filter((b) => posOf(wortarten(b.header)) === pos);
  if (pos === 'noun') {
    const groups: { genders: Gender[]; bodies: string[]; headers: string[] }[] = [];
    for (const b of same) {
      const one = blockEntry(title, pos, [b.body], [b.header]);
      const g = one.genders[0];
      // A block of a gender seen already, or without one, joins that group; another gender
      // joins a group with the same meaning, else starts an article of its own.
      const group =
        groups.find((x) => !g || !x.genders.length || x.genders.includes(g)) ??
        groups.find((x) => sameMeaning(blockEntry(title, pos, x.bodies, x.headers).translations, one.translations));
      if (group) {
        group.bodies.push(b.body);
        group.headers.push(b.header);
        for (const x of one.genders) if (!group.genders.includes(x)) group.genders.push(x);
      } else groups.push({ genders: [...one.genders], bodies: [b.body], headers: [b.header] });
    }
    const parts = groups.map((x) => blockEntry(title, pos, x.bodies, x.headers));
    if (parts.length < 2) return parts[0];
    const articles = parts.map(({ genders, plural, translations, examples }) => ({ genders, plural, translations, examples }));
    return { ...parts[0], articles };
  }
  return blockEntry(title, pos, same.map((b) => b.body), same.map((b) => b.header));
}

/** One entry from blocks of one part of speech (merged: genders, first forms, meanings, examples). */
function blockEntry(title: string, pos: Pos, bodies: string[], headers: string[]): WikiEntry {
  const entry: WikiEntry = {
    title,
    pos,
    genders: [],
    plural: '',
    praeteritum: '',
    partizip2: '',
    auxiliary: '',
    translations: { en: [], ru: [] },
    examples: [],
  };

  bodies.forEach((body, i) => {
    const b = { body, header: headers[i] ?? '' };
    if (pos === 'noun') {
      const p = templateParams(b.body, 'Deutsch Substantiv Übersicht') ?? {};
      for (const key of ['Genus', 'Genus 1', 'Genus 2', 'Genus 3']) {
        const g = GENDERS[p[key]];
        if (g && !entry.genders.includes(g)) entry.genders.push(g);
      }
      if (!entry.genders.length) {
        for (const m of b.header.matchAll(/\{\{([mfn])\}\}/g)) {
          const g = GENDERS[m[1]];
          if (!entry.genders.includes(g)) entry.genders.push(g);
        }
      }
      entry.plural ||= firstValue(p, ['Nominativ Plural', 'Nominativ Plural 1', 'Nominativ Plural*']);
    }
    if (pos === 'verb') {
      const p = templateParams(b.body, 'Deutsch Verb Übersicht') ?? {};
      entry.praeteritum ||= firstValue(p, ['Präteritum_ich', 'Präteritum_er, sie, es']);
      entry.partizip2 ||= firstValue(p, ['Partizip II']);
      const aux = (p['Hilfsverb'] ?? '').trim();
      if (!entry.auxiliary && (aux === 'haben' || aux === 'sein')) entry.auxiliary = aux;
    }
    // "die Bank" (bench) + "die Bank" (bank): the first meaning of each, then the rest.
    for (const lang of ['en', 'ru'] as const) {
      entry.translations[lang] = mergeMeanings(entry.translations[lang], parseTranslations(b.body, lang));
    }
    for (const ex of parseExamples(b.body)) {
      if (entry.examples.length < 3 && !entry.examples.includes(ex)) entry.examples.push(ex);
    }
  });
  return entry;
}
