import type { Pos } from '../../types';
import { checkResponse, SourceError, type Provider } from '../chain';

/**
 * English Wiktionary: German entries' English definitions (REST, CORS-open) and opensearch.
 * Used for English translations and as the last suggestion source.
 */
const REST = 'https://en.wiktionary.org/api/rest_v1/page/definition/';
const API = 'https://en.wiktionary.org/w/api.php';

/** Definitions taken from the German section. */
const MAX_DEFINITIONS = 3;
/** Terms in the joined translation string. */
const MAX_TERMS = 3;
/** Single glosses longer than this are descriptions, not translations. */
const MAX_TERM_LENGTH = 60;

export interface EnGloss {
  pos: Pos;
  /** Cleaned definitions, e.g. ["house, building", "home", "theatre"]. */
  glosses: string[];
  /** Up to 3 short terms for a card's translation, e.g. "house, building, home". */
  translation: string;
}

interface RestDefinition {
  definition?: unknown;
}
interface RestEntry {
  partOfSpeech?: unknown;
  definitions?: unknown;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*|#39);/gi, (m, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[name.toLowerCase()] ?? m;
  });
}

/** Plain text of a definition's HTML, without labels in parentheses or brackets. */
export function cleanDefinition(html: string): string {
  let s = html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<(script|sup)[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  for (let i = 0; i < 3; i++) s = s.replace(/\([^()]*\)/g, '').replace(/\[[^[\]]*\]/g, '');
  return s
    .replace(/\s+/g, ' ')
    .replace(/\s+([,;:.])/g, '$1')
    .replace(/^[\s,;:.]+|[\s,;:]+$/g, '')
    .trim();
}

const FORM_OF = /\b(?:inflection|plural|singular|participle|preterite|imperative|alternative form|alternative spelling|obsolete spelling|misspelling|superseded spelling) of\b/i;

function isFormOf(html: string, text: string): boolean {
  return /form-of-definition/.test(html) || FORM_OF.test(text);
}

function posOf(label: string): Pos {
  switch (label.toLowerCase()) {
    case 'noun':
    case 'proper noun':
      return 'noun';
    case 'verb':
      return 'verb';
    case 'adjective':
      return 'adj';
    default:
      return 'other';
  }
}

/** Short translation terms from glosses: "to go, to walk" → ["go", "walk"]. */
function termsOf(glosses: string[], pos: Pos): string[] {
  const out: string[] = [];
  for (const g of glosses) {
    for (let t of g.split(/[;,]/)) {
      t = t.trim().replace(/\.$/, '');
      if (pos === 'verb') t = t.replace(/^to\s+/i, '');
      if (!t || t.length > MAX_TERM_LENGTH || out.includes(t)) continue;
      out.push(t);
    }
  }
  return out.slice(0, MAX_TERMS);
}

/** German part-of-speech section of a REST definition response, as English glosses. */
export function parseEnDefinitions(data: unknown): EnGloss | null {
  const de = (data as { de?: unknown } | null)?.de;
  if (!Array.isArray(de)) return null;
  // Proper-noun sections (places, surnames) only when nothing else is there.
  const entries = (de as RestEntry[]).filter((e) => e && typeof e === 'object');
  const ordered = [
    ...entries.filter((e) => e.partOfSpeech !== 'Proper noun'),
    ...entries.filter((e) => e.partOfSpeech === 'Proper noun'),
  ];
  for (const e of ordered) {
    if (!Array.isArray(e.definitions)) continue;
    const glosses: string[] = [];
    for (const d of e.definitions as RestDefinition[]) {
      if (typeof d?.definition !== 'string') continue;
      const text = cleanDefinition(d.definition);
      if (!text || isFormOf(d.definition, text) || glosses.includes(text)) continue;
      glosses.push(text);
      if (glosses.length >= MAX_DEFINITIONS) break;
    }
    if (!glosses.length) continue;
    const pos = posOf(typeof e.partOfSpeech === 'string' ? e.partOfSpeech : '');
    const translation = termsOf(glosses, pos).join(', ');
    if (!translation) continue;
    return { pos, glosses, translation };
  }
  return null;
}

async function fetchDefinitions(word: string, signal: AbortSignal): Promise<unknown | null> {
  const res = await fetch(REST + encodeURIComponent(word.replace(/ /g, '_')), { signal });
  if (res.status === 404) return null;
  checkResponse(res, 'Wiktionary (EN)');
  try {
    return await res.json();
  } catch (e) {
    if (signal.aborted) throw e;
    throw new SourceError('Unexpected response from Wiktionary (EN)', { refusal: true });
  }
}

/** English glosses of a German word ("Haus" → house, building, home). Tries "tisch" as "Tisch" too. */
export const enWiktionaryGlosses: Provider<string, EnGloss> = {
  id: 'en.wiktionary',
  async run(word, signal) {
    const w = word.trim();
    if (!w) return null;
    const variants = [...new Set([w, w[0].toUpperCase() + w.slice(1)])];
    for (const v of variants) {
      const data = await fetchDefinitions(v, signal);
      const gloss = data === null ? null : parseEnDefinitions(data);
      if (gloss) return gloss;
    }
    return null;
  },
};

/** Titles from an opensearch response: [query, titles, descriptions, urls]. */
export function parseOpensearch(data: unknown): string[] {
  if (!Array.isArray(data) || !Array.isArray(data[1])) return [];
  return (data[1] as unknown[]).filter((t): t is string => typeof t === 'string' && t.trim() !== '');
}

/** en.wiktionary prefix search (titles of all languages; used last). */
export const enWiktionaryPrefix: Provider<{ prefix: string; limit: number }, string[]> = {
  id: 'en.wiktionary',
  async run({ prefix, limit }, signal) {
    const params = new URLSearchParams({
      action: 'opensearch',
      search: prefix,
      limit: String(limit),
      namespace: '0',
      format: 'json',
      origin: '*',
    });
    const res = await fetch(`${API}?${params}`, { signal });
    checkResponse(res, 'Wiktionary (EN)');
    let data: unknown;
    try {
      data = await res.json();
    } catch (e) {
      if (signal.aborted) throw e;
      throw new SourceError('Unexpected response from Wiktionary (EN)', { refusal: true });
    }
    const words = parseOpensearch(data);
    return words.length ? words : null;
  },
};
