import type { Auxiliary, Gender, Lang, Pos } from '../types';
import { checkResponse, SourceError } from '../sources/chain';

const API = 'https://de.wiktionary.org/w/api.php';

export interface WikiEntry {
  title: string;
  pos: Pos;
  genders: Gender[];
  plural: string;
  praeteritum: string;
  partizip2: string;
  auxiliary: Auxiliary;
  translations: Record<Lang, string[]>;
  examples: string[];
  /** For inflected forms ("ging", "Häuser"): the dictionary form. */
  lemma?: string;
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

/** All {{Ü|en|x}} / {{Üt|ru|x}} targets of a language in the block, de-duplicated, in order. */
function parseTranslations(body: string, lang: Lang): string[] {
  const words: string[] = [];
  const line = new RegExp(`^\\*\\{\\{${lang}\\}\\}:(.*)$`, 'gm');
  for (const m of body.matchAll(line)) {
    for (const t of m[1].matchAll(new RegExp(`\\{\\{Üt?\\??\\|${lang}\\|([^|}]*)`, 'g'))) {
      const w = stripMarkup(t[1]);
      if (w && !words.includes(w)) words.push(w);
    }
  }
  return words;
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
  // Blocks of the same part of speech (e.g. "der See" and "die See") are merged.
  const same = lexical.filter((b) => posOf(wortarten(b.header)) === pos);

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

  for (const b of same) {
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
    for (const lang of ['en', 'ru'] as const) {
      for (const w of parseTranslations(b.body, lang)) {
        if (!entry.translations[lang].includes(w)) entry.translations[lang].push(w);
      }
    }
    for (const ex of parseExamples(b.body)) {
      if (entry.examples.length < 3 && !entry.examples.includes(ex)) entry.examples.push(ex);
    }
  }
  return entry;
}
