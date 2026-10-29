import type { Auxiliary, Gender, Lang, Pos } from '../types';
import { checkResponse, SourceError } from '../sources/chain';
import { formatPreps, mergeMeanings, pickMeanings, sameMeaning, type SenseTranslations } from './meanings';

const API = 'https://de.wiktionary.org/w/api.php';

/** One numbered meaning of a page ("[2]" under {{Bedeutungen}}) with what the page ties to it. */
export interface WikiSense {
  /** Sense number on the page (1, 2, …). */
  n: number;
  /** Translations of this sense per language, page order. */
  translations: Record<Lang, string[]>;
  /** Example sentences marked with this sense ("[2] Er …"), page order, markup stripped. */
  examples: string[];
  /**
   * A reflexive use of a verb ("sich treffen"): its definition is labelled "{{K|refl.}}",
   * "''reflexiv:''", "''sich …:''", or it stands under a "reflexiv:" heading.
   */
  reflexive?: true;
  /** Prepositions with their case the sense is used with, page order ("auf + Akk"; see sensePreps). */
  preps?: string[];
}

/**
 * A set phrase and, for an idiom, the page's plain German explanation of it ("durch die Bank" –
 * "ohne Ausnahme"). Idioms are translated through the explanation: translating the phrase itself
 * word by word goes wrong ("через банк").
 */
export interface WikiPhrase {
  de: string;
  note?: string;
}

/** One article of a noun whose articles differ in meaning (see WikiEntry.articles). */
export interface WikiArticle {
  genders: Gender[];
  plural: string;
  translations: Record<Lang, string[][]>;
  examples: string[];
  /** Numbered senses, as on WikiEntry. */
  senses?: WikiSense[];
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
  /** Numbered senses in page order; absent or [] when the page numbers none (then use `examples`). */
  senses?: WikiSense[];
  /** Set phrases with the word ("infrage stellen", "durch die Bank"), at most 3. */
  phrases?: WikiPhrase[];
  /** For inflected forms ("ging", "Häuser"): the dictionary form. */
  lemma?: string;
  /**
   * Nouns whose articles differ in meaning ("der See" lake, "die See" sea): one entry per
   * article in page order; the entry's own genders/plural/translations/examples are the
   * first one's. Absent for gender variants of one meaning (der/das Teil: genders [n, m]).
   */
  articles?: WikiArticle[];
  /**
   * Verbs used with "sich": 'only' when every sense on the page is reflexive (sich beeilen),
   * 'also' when some are (treffen / sich treffen). Same values as LexEntry.reflexive.
   */
  reflexive?: 'also' | 'only';
  /**
   * With `reflexive`: meanings of the reflexive senses, as `translations`. `translations` then
   * holds the other senses' meanings (all senses' when the others have no translation).
   */
  reflexiveTranslations?: Record<Lang, string[][]>;
  /**
   * Prepositions with their case of all senses, "; "-separated, at most 3, as Card.preps
   * ("auf + Akk; über + Akk"). Lookups take the ones of the senses a reading stands for
   * (WikiSense.preps).
   */
  preps?: string;
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

/**
 * Sense numbers of a marker's inside: "1" → [1], "1, 2" → [1, 2], "1–3" → [1, 2, 3],
 * "2a" → [2] (sub-senses belong to their sense), "*" → [].
 */
export function markerNumbers(inner: string): number[] {
  const out: number[] = [];
  for (const part of inner.split(',')) {
    const range = part.match(/(\d+)[a-z]?\s*[–—-]\s*(\d+)/);
    const nums = range ? [Number(range[1]), Number(range[2])] : [Number(part.match(/\d+/)?.[0] ?? 0)];
    // Ranges are short ("1–3"); a typo like "1–300" is not unrolled.
    for (let n = nums[0]; n && n <= nums[nums.length - 1] && n < nums[0] + 30; n++) if (!out.includes(n)) out.push(n);
  }
  return out;
}

/** Example lines under {{Beispiele}}: the senses they are marked with, cleaned text, and whether they quote a source. */
function exampleLines(body: string): { senses: number[]; quoted: boolean; text: string }[] {
  const m = body.match(/\{\{Beispiele\}\}\n([\s\S]*?)(?:\n\n|\n\{\{|$)/);
  if (!m) return [];
  return m[1]
    .split('\n')
    .filter((l) => l.startsWith(':'))
    .map((l) => {
      const marker = l.match(/^:+\s*\[([^\]]*)\]/);
      return { senses: marker ? markerNumbers(marker[1]) : [], quoted: /<ref|„/.test(l), text: stripMarkup(l.replace(/^:+\s*(\[[^\]]*\])?\s*/, '')) };
    })
    .filter((e) => e.text.length > 3 && e.text.length <= 140)
    .map((e) => (e.quoted ? { ...e, text: e.text.replace(/^„|“$/g, '') } : e));
}

/** Short, self-made example sentences first; long literary quotes with references last. */
function pickExamples(lines: { quoted: boolean; text: string }[], max = 3): string[] {
  const own = lines.filter((e) => !e.quoted).map((e) => e.text);
  const quotes = lines.filter((e) => e.quoted).map((e) => e.text);
  return [...new Set([...own, ...quotes])].slice(0, max);
}

/** Example sentences of the block, whatever sense they illustrate (see pickExamples). */
function parseExamples(body: string): string[] {
  return pickExamples(exampleLines(body));
}

/** The lines of the {{Bedeutungen}} section (sense lines ":[2] …" and label lines "*{{K|…}}"). */
function meaningLines(body: string): string[] {
  const m = body.match(/\{\{Bedeutungen\}\}\n([\s\S]*?)(?:\n\n|\n\{\{(?!K\|)|$)/);
  return (m?.[1] ?? '').split('\n');
}

/** Sense numbers under {{Bedeutungen}} in page order (":[2a]" counts as 2). */
function senseNumbers(body: string): number[] {
  const out: number[] = [];
  for (const line of meaningLines(body)) {
    const d = line.match(/^:\s*\[(\d+)[a-z]?\]/);
    if (d && !out.includes(Number(d[1]))) out.push(Number(d[1]));
  }
  return out;
}

/**
 * Numbered senses of a block with their own translations, examples and prepositions: an
 * example marked "[1, 2]" belongs to both. Senses the page ties nothing to are left out.
 * `offset` is added to the sense numbers (see blockEntry); only a verb's senses are marked
 * reflexive.
 */
function parseSenses(body: string, title: string, offset = 0, verb = false): WikiSense[] {
  const numbers = senseNumbers(body);
  if (!numbers.length) return [];
  const words = { en: parseSenseTranslations(body, 'en'), ru: parseSenseTranslations(body, 'ru') };
  const lines = exampleLines(body);
  const marks = senseMarks(body, title);
  const out: WikiSense[] = [];
  for (const n of numbers) {
    const translations = { en: [], ru: [] } as Record<Lang, string[]>;
    for (const lang of ['en', 'ru'] as const) {
      const w = words[lang].find((s) => s.n === n)?.words ?? [];
      // Plain words before labelled ones ("''umgangssprachlich:'' серия").
      const sorted = [...w.filter((x) => !x.labelled), ...w.filter((x) => x.labelled)].map((x) => x.word);
      translations[lang] = [...new Set(sorted)];
    }
    const examples = pickExamples(lines.filter((e) => e.senses.includes(n)));
    const mark = marks.get(n);
    const preps = mark?.preps ?? [];
    if (examples.length || translations.en.length || translations.ru.length || preps.length) {
      const sense: WikiSense = { n: n + offset, translations, examples };
      if (verb && mark?.reflexive) sense.reflexive = true;
      if (preps.length) sense.preps = preps;
      out.push(sense);
    }
  }
  return out;
}

// ---------- Reflexive senses and prepositions ----------

/** Labels in front of a definition: templates and italic notes ("{{K|refl.}} ''sich auf etwas freuen:''"). */
const LEADING_LABELS = /^(?:\{\{(?:[^{}]|\{\{[^{}]*\}\})*\}\}\s*|''[^'\n]*''\s*:?\s*)+/;

/** A label marking a reflexive use: "{{K|refl.}}", "''reflexiv:''", "''sich treffen:''", "''es trifft sich:''". */
const REFLEXIVE_LABEL = /(?<!\p{L})(?:refl\.|reflexiv|sich(?!\p{L}))/iu;

type Case = 'Akk' | 'Dat' | 'Gen';

/**
 * Case of a preposition's object when the wording doesn't say ("auf etwas" → Akk). Two-way
 * prepositions get the case they nearly always have after a verb (warten auf + Akk, sich
 * fürchten vor + Dat); null where both are common (an, in): those need "jemanden"/"jemandem"
 * or an explicit case.
 */
const PREP_CASE: Record<string, Case | null> = {
  mit: 'Dat', von: 'Dat', zu: 'Dat', aus: 'Dat', bei: 'Dat', nach: 'Dat', seit: 'Dat', gegenüber: 'Dat',
  für: 'Akk', um: 'Akk', gegen: 'Akk', durch: 'Akk', ohne: 'Akk',
  wegen: 'Gen',
  auf: 'Akk', über: 'Akk', vor: 'Dat', unter: 'Dat',
  an: null, in: null, neben: null, hinter: null, zwischen: null,
};
/** Prepositions whose case never depends on the wording. */
const FIXED_CASE = new Set(['mit', 'von', 'zu', 'aus', 'bei', 'nach', 'seit', 'gegenüber', 'für', 'um', 'gegen', 'durch', 'ohne', 'wegen']);
const PREP = `(${Object.keys(PREP_CASE).join('|')})`;
/** "sich auf etwas freuen", "sich (über etwas) freuen", "mit jemandem": a preposition and the placeholder for its object. */
const PREP_OBJECT = new RegExp(`(?<![\\p{L}])${PREP}\\s+(etwas|etw\\.|jemanden|jemandem|jemand|jmdn\\.?|jmdm\\.?|jdn\\.?|jdm\\.?)(?![\\p{L}])`, 'giu');
/** "auf + Akk.", "mit + Dativ". */
const PREP_PLUS_CASE = new RegExp(`(?<![\\p{L}])${PREP}\\s*\\+\\s*(Akk|Dat|Gen)`, 'giu');

const caseOf = (c: string): Case | null => {
  const k = c.slice(0, 3).toLowerCase();
  return k === 'akk' ? 'Akk' : k === 'dat' ? 'Dat' : k === 'gen' ? 'Gen' : null;
};

/** "auf + Akk" for a preposition and the case given (or implied), null when the case is unknown. */
function prepWith(prep: string, given: Case | null): string | null {
  const p = prep.toLowerCase();
  if (!(p in PREP_CASE)) return null;
  const c = FIXED_CASE.has(p) ? PREP_CASE[p] : (given ?? PREP_CASE[p]);
  return c ? `${p} + ${c}` : null;
}

/** Case a placeholder stands in: "jemanden" → Akk, "jemandem" → Dat, "etwas" → unknown. */
const placeholderCase = (w: string): Case | null =>
  /^(?:jemanden|jmdn|jdn)/i.test(w) ? 'Akk' : /^(?:jemandem|jmdm|jdm)/i.test(w) ? 'Dat' : null;

/**
 * Prepositions in a definition's labels, conservatively: the K template's "Prä=auf|Kas=Akk."
 * or "auf + Akk.", and an italic usage note with the word or "sich" in it whose preposition
 * comes with a placeholder ("''sich auf etwas freuen:''", "''sich beeilen mit etwas''"). A
 * preposition starting a clause ("sich beeilen, um … etwas zu …") is not one: it is not
 * followed by the placeholder. The definition itself is never read ("auf etwas aufprallen"
 * explains the word, it is not how the word is used).
 */
function labelPreps(label: string, title: string): string[] {
  const out: string[] = [];
  const add = (p: string | null) => p && !out.includes(p) && out.push(p);
  for (const k of label.matchAll(/\{\{K\|((?:[^{}]|\{\{[^{}]*\}\})*)\}\}/g)) {
    for (const m of k[1].matchAll(/Prä(\d*)\s*=\s*([^|}]+)/g)) {
      const kas = k[1].match(new RegExp(`Kas${m[1]}\\s*=\\s*([^|}]+)`));
      add(prepWith(stripMarkup(m[2]).trim(), kas ? caseOf(kas[1].trim()) : null));
    }
  }
  for (const m of stripMarkup(label.replace(/''/g, ' ')).matchAll(PREP_PLUS_CASE)) add(prepWith(m[1], caseOf(m[2])));
  const word = title.toLowerCase();
  for (const it of label.matchAll(/''([^'\n]*)''/g)) {
    const text = stripMarkup(it[1]);
    const lower = text.toLowerCase();
    if (!lower.includes(word) && !/(?<!\p{L})sich(?!\p{L})/u.test(lower)) continue;
    for (const m of text.matchAll(PREP_OBJECT)) add(prepWith(m[1], placeholderCase(m[2])));
  }
  return out;
}

/**
 * Reflexive flag and prepositions of each sense under {{Bedeutungen}}: a sense is reflexive
 * when its definition's labels say so (REFLEXIVE_LABEL) or it stands under a heading line that
 * does ("''reflexiv:''"); a heading without the mark ends such a group. Sub-senses ("::[1b]")
 * add their prepositions to their sense.
 */
function senseMarks(body: string, title: string): Map<number, { reflexive: boolean; preps: string[] }> {
  const out = new Map<number, { reflexive: boolean; preps: string[] }>();
  let group = false;
  for (const line of meaningLines(body)) {
    const d = line.match(/^(:+)\s*\[(\d+)[a-z]?\]\s*(.*)$/);
    if (!d) {
      const rest = line.replace(/^[:*]+\s*/, '').trim();
      const label = rest.match(LEADING_LABELS)?.[0];
      if (rest && label?.length === rest.length) group = REFLEXIVE_LABEL.test(label);
      continue;
    }
    const n = Number(d[2]);
    const label = d[3].match(LEADING_LABELS)?.[0] ?? '';
    let mark = out.get(n);
    if (!mark) {
      if (d[1].length > 1) continue; // a sub-sense of a sense not listed
      out.set(n, (mark = { reflexive: group || REFLEXIVE_LABEL.test(label), preps: [] }));
    }
    for (const p of labelPreps(label, title)) if (!mark.preps.includes(p)) mark.preps.push(p);
  }
  return out;
}

/** Reflexive sense numbers of a block (see senseMarks). */
function reflexiveSenses(body: string, title: string): Set<number> {
  return new Set([...senseMarks(body, title)].filter(([, m]) => m.reflexive).map(([n]) => n));
}

/** Longest set phrase kept (WikiEntry.phrases). */
const MAX_PHRASE = 60;

/** Lines (":…") of a "{{Name}}" section of the block. */
function sectionLines(body: string, name: string): string[] {
  const m = body.match(new RegExp(`\\{\\{${name}\\}\\}\\n([\\s\\S]*?)(?:\\n\\n|\\n\\{\\{|$)`));
  return (m?.[1] ?? '').split('\n').filter((l) => l.startsWith(':'));
}

/** Index of the first " – " (or " - ", " — ") outside links and templates: where an explanation starts. */
function explanationStart(line: string): number {
  const masked = line.replace(/\[\[[^\]]*\]\]|\{\{[^{}]*\}\}/g, (s) => '_'.repeat(s.length));
  const i = masked.search(/\s[–—-]\s/);
  return i < 0 ? line.length : i;
}

/** Longest explanation kept for an idiom (WikiPhrase.note). */
const MAX_NOTE = 120;

/** An explanation after " – " as plain text ("– ohne Ausnahme" → "ohne Ausnahme"), or undefined. */
function cleanNote(s: string): string | undefined {
  const n = stripMarkup(s)
    .replace(/^\s*[–—-]\s*/, '')
    .replace(/\[[^\]]*\]\s*/g, '')
    .replace(/[\s.…:,;]+$/, '')
    .trim();
  return n.length >= 3 && n.length <= MAX_NOTE ? n : undefined;
}

/** A phrase candidate as plain text, or '' when it isn't one ("abreißen", "zu Haus/Hause"). */
function cleanPhrase(s: string, word: string): string {
  let p = stripMarkup(s);
  for (let i = 0; i < 3; i++) p = p.replace(/\s*\([^()]*\)/g, '');
  p = p
    .replace(/[\s.…:,;]+$/, '')
    .replace(/^[‚„“"'«»]+|[‘“”"'«»]+$/g, '')
    .trim();
  const ok = p.length <= MAX_PHRASE && p.includes(' ') && !p.includes('/') && p.toLowerCase().includes(word.toLowerCase());
  return ok ? p : '';
}

/**
 * Wording of a definition that says the word occurs only in set phrases, followed by them:
 * "''in der Wendung:'' jemandem den Garaus machen – töten", "nur in den Wendungen ‚x‘, ‚y‘".
 */
const ONLY_IN_PHRASES =
  /(?:^|\s)in (?:der|den|einer|festen|feststehenden|folgenden)(?: festen| feststehenden)? (?:Wendung|Redewendung|Verbindung|Wortverbindung|Fügung|Kombination)(?:en)?(?:\s*(?::|(?=[‚„“"«]))\s*)(.*)$/i;

/** Phrases from a definition like "nur in der Wendung: …" (see ONLY_IN_PHRASES). */
function definitionPhrases(body: string, word: string): WikiPhrase[] {
  const out: WikiPhrase[] = [];
  for (const line of meaningLines(body)) {
    if (!/^:\s*\[\d+[a-z]?\]/.test(line)) continue;
    const m = stripMarkup(line.replace(/^:\s*\[[^\]]*\]\s*/, '')).match(ONLY_IN_PHRASES);
    if (!m) continue;
    const at = explanationStart(m[1]);
    const tail = m[1].slice(0, at);
    const note = cleanNote(m[1].slice(at));
    const quoted = [...tail.matchAll(/[‚„“"«]([^‘“”"»]+)[‘“”"»]/g)].map((q) => q[1]);
    for (const p of quoted.length ? quoted : tail.split(/[,;]|\s(?:oder|und)\s/)) {
      const c = cleanPhrase(p, word);
      if (c) out.push(note ? { de: c, note } : { de: c });
    }
  }
  return out;
}

/**
 * Set phrases with the word: the ones a definition says it occurs in, then
 * {{Charakteristische Wortkombinationen}} ("zur ''Folge'' haben"), then {{Redewendungen}}
 * ("[[auf den Tisch hauen|…]] – Erklärung"). Lines are lists split at top-level "," and ";";
 * sense markers, explanations after " – " and parentheses are dropped, and so is the rest of a
 * line after a usage label ("{{ugs.}}:", "''euphemistisch:''"). Only short phrases that contain
 * the word are kept. An idiom's explanation is kept as its `note` (collocations have none).
 */
function parsePhrases(body: string, word: string): WikiPhrase[] {
  const out = definitionPhrases(body, word);
  for (const name of ['Charakteristische Wortkombinationen', 'Redewendungen']) {
    for (const line of sectionLines(body, name)) {
      const text = line.replace(/^:+\s*/, '');
      const at = explanationStart(text);
      const note = name === 'Redewendungen' ? cleanNote(text.slice(at)) : undefined;
      for (const seg of lineSegments(text.slice(0, at))) {
        if (/^\[[^[\]]*\]$/.test(seg)) continue; // sense marker
        // "''euphemistisch:'' x", "{{ugs.}}'':'' x": labelled from here on.
        if (/^(?:''[^']*:\s*''|\{\{[^{}]*\}\}(?:<ref[^>]*\/>)*\s*'':''|[^\s[{']+:)/.test(seg)) break;
        // "[[a|a]]/[[b|b]]": alternatives of one phrase, the first is enough.
        const c = cleanPhrase(seg.replace(/\]\]\s*\/\s*\[\[[\s\S]*$/, ']]'), word);
        if (c) out.push(note ? { de: c, note } : { de: c });
      }
    }
  }
  return out;
}

/** Usage labels that make a sense second-rate (colloquial, dated, regional, jargon, figurative, …). */
const MARGINAL_LABEL =
  /(?<!\p{L})(ugs|umgangssprachlich|salopp|derb|vulg|vulgär|abw|abwertend|pejorativ|veraltet|veraltend|landsch|landschaftlich|regional|dialektal|mundartlich|scherzh|scherzhaft|Jugendspr|Jugendsprache|Jägerspr|Jägersprache|Seemannsspr|Seemannssprache|übertr|übertragen|fachspr|fachsprachlich|poet|poetisch|gehoben|selten|historisch|österr|schweiz|süddt|norddt|Schach)(?!\p{L})/iu;

/** Sense numbers (never 1) whose definition carries a usage label: ":[3] {{K|ugs.}} …". */
function marginalSenses(body: string): Set<number> {
  const out = new Set<number>();
  for (const line of meaningLines(body)) {
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

/**
 * Meanings of a part-of-speech block in `lang` (see pickMeanings). With reflexive senses
 * (`refl`), `plain` are the other senses' meanings (all senses' when the others have no
 * translation) and `reflexive` the reflexive senses' own.
 */
function parseTranslations(body: string, lang: Lang, refl: Set<number> = new Set()): { plain: string[][]; reflexive: string[][] } {
  const senses = parseSenseTranslations(body, lang);
  const marginal = marginalSenses(body);
  const all = pickMeanings(senses, marginal);
  if (!refl.size) return { plain: all, reflexive: [] };
  const plain = pickMeanings(senses.filter((s) => !refl.has(s.n)), marginal);
  return { plain: plain.length ? plain : all, reflexive: pickMeanings(senses.filter((s) => refl.has(s.n)), marginal) };
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
    // Each article keeps its own senses; the entry's senses and phrases are the first article's.
    const articles = parts.map(({ genders, plural, translations, examples, senses }) => ({
      genders,
      plural,
      translations,
      examples,
      ...(senses ? { senses } : {}),
    }));
    return { ...parts[0], articles };
  }
  return blockEntry(title, pos, same.map((b) => b.body), same.map((b) => b.header));
}

/** Sense numbers of the i-th merged block start at i × SENSE_OFFSET + 1 (see blockEntry). */
const SENSE_OFFSET = 100;

/**
 * One entry from blocks of one part of speech (merged: genders, first forms, meanings,
 * examples, senses, phrases). Every block numbers its senses from [1], so the senses of later
 * blocks are offset to keep them apart: "die Bank" bench [1]–[6], then bank [1]–[2] → 101, 102.
 */
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
  const senses: WikiSense[] = [];
  const phrases: WikiPhrase[] = [];
  const reflexive = { en: [] as string[][], ru: [] as string[][] };
  /** Sense counts over the blocks: all, and reflexive ones. */
  let senseCount = 0;
  let reflCount = 0;

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
    const refl = pos === 'verb' ? reflexiveSenses(b.body, title) : new Set<number>();
    senseCount += senseNumbers(b.body).length;
    reflCount += refl.size;
    // "die Bank" (bench) + "die Bank" (bank): the first meaning of each, then the rest.
    for (const lang of ['en', 'ru'] as const) {
      const t = parseTranslations(b.body, lang, refl);
      entry.translations[lang] = mergeMeanings(entry.translations[lang], t.plain);
      reflexive[lang] = mergeMeanings(reflexive[lang], t.reflexive);
    }
    for (const ex of parseExamples(b.body)) {
      if (entry.examples.length < 3 && !entry.examples.includes(ex)) entry.examples.push(ex);
    }
    senses.push(...parseSenses(b.body, title, i * SENSE_OFFSET, pos === 'verb'));
    for (const p of parsePhrases(b.body, title)) if (!phrases.some((x) => x.de === p.de)) phrases.push(p);
  });
  if (senses.length) entry.senses = senses;
  if (phrases.length) entry.phrases = phrases.slice(0, 3);
  if (reflCount) {
    entry.reflexive = reflCount === senseCount ? 'only' : 'also';
    entry.reflexiveTranslations = reflexive;
  }
  const preps = formatPreps(senses.flatMap((s) => s.preps ?? []));
  if (preps) entry.preps = preps;
  return entry;
}
