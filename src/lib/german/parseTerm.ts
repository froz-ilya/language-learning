import type { Auxiliary, Gender, Pos } from '../types';
import { GENDER_OF_ARTICLE } from './articles';
import { baseOfReflexive, isReflexiveTerm, withSich } from './reflexive';
import { caseOfWord, CONTRACTIONS, formatPrep, isPairBase, joiningPair, PREPOSITIONS, resolveCase, withPrep, type CaseFrom, type PrepCase, type PrepPart } from './prepositions';

export interface ParsedTerm {
  /** The word as a card stores it: no article; a reflexive verb keeps "sich" ("sich treffen"). */
  term: string;
  /**
   * "sich treffen": a reflexive verb. `term` keeps "sich"; dictionaries are asked for the verb
   * (baseOfReflexive(term)). Only for "sich" + one word, not "sich Sorgen machen".
   */
  reflexive?: true;
  pos?: Pos;
  genders: Gender[];
  plural?: string;
  praeteritum?: string;
  partizip2?: string;
  auxiliary?: Auxiliary;
  /**
   * "bestehen auf", "pflegen zu": a preposition that is part of the word (`joins` in the list of
   * common words, prepositions.ts). `term` ends with it; `case` is the one typed, fixed or listed.
   */
  prep?: PrepPart & { from?: CaseFrom };
  /** With `prep`: the term without it ("bestehen", "sich verlassen"): what dictionaries are asked for. */
  base?: string;
  /**
   * "denken an", "warten auf + Akk": a preposition that is a detail of the word. `term` is the
   * word ("denken"); `case` as for `prep`, absent when only a dictionary or the user can tell.
   */
  note?: PrepPart & { from?: CaseFrom };
  /** The typed prepositions in Card.preps format ("an + Akk"; "auf + Akk; über + Akk"). */
  preps?: string;
}

/** "Haus" → "Häus", "Mutter" → "Mütter": umlaut on the stem's last a / o / u / au (an -er/-el/-en/-e ending is skipped). */
function umlaut(word: string): string {
  const ending = word.match(/(?:er|el|en|e)$/)?.[0] ?? '';
  const stem = word.slice(0, word.length - ending.length);
  const m = stem.match(/^(.*?)(au|Au|a|o|u|A|O|U)([^aeiouäöüAEIOUÄÖÜ]*)$/);
  if (!m) return word;
  const map: Record<string, string> = { au: 'äu', a: 'ä', o: 'ö', u: 'ü', Au: 'Äu', A: 'Ä', O: 'Ö', U: 'Ü' };
  return m[1] + map[m[2]] + m[3] + ending;
}

/**
 * The plural part after the noun, in the styles word lists use:
 *   "die Häuser" / "Häuser"        → Häuser
 *   "-en" / "en" / "-n" / "-e" …   → noun + ending (Handlung, en → Handlungen)
 *   "-¨er" / "¨e" / "-¨"           → umlauted noun + ending (Haus, -¨er → Häuser)
 *   "-"                            → same as the singular (Lehrer, - → Lehrer)
 * Anything else (several words, notes) is not a plural.
 */
function pluralOf(noun: string, part: string): string | undefined {
  const p = part.replace(/^\(|\)$/g, '').trim();
  if (!p) return undefined;
  const full = p.match(/^(?:die\s+)?(\p{Lu}[\p{L}-]*)$/u);
  if (full) return full[1];
  const short = p.match(/^-?\s*(¨|")?\s*(e|en|n|er|s|nen|se)?$/);
  if (short && (short[1] || short[2] || p === '-')) return (short[1] ? umlaut(noun) : noun) + (short[2] ?? '');
  return undefined;
}

/**
 * Understands what people type into a German term field (and what Quizlet sets usually contain):
 *   "der Tisch"                   → noun, m
 *   "der/das Teil"                → noun, m+n
 *   "das Haus, die Häuser"        → noun, n, plural Häuser (also "Häuser", "-¨er", "en": see pluralOf)
 *   "gehen, ging, ist gegangen"   → verb with forms
 *   "sich treffen"                → term "sich treffen", reflexive (also with verb forms)
 *   "denken an (+ Akk)"           → term "denken", note an + Akk (also "an jdn. denken")
 *   "bestehen auf", "pflegen zu"  → term "bestehen auf", prep auf + Dat: part of the word
 *   "gehen"                       → term only
 */
export function parseGermanInput(raw: string): ParsedTerm {
  const text = raw.trim().replace(/\s+/g, ' ');
  const comma = text.indexOf(',');
  const head = comma < 0 ? text : text.slice(0, comma);
  const rest = comma < 0 ? '' : text.slice(comma);
  const tail = prepTail(head);
  if (tail) {
    const p = reflexive(parseTerm(tail.base + rest));
    if (tail.many) return { ...p, preps: tail.many.join('; ') };
    const r = resolveCase(p.term, tail.word, { typed: tail.case });
    const part = { word: tail.word, ...(r.case ? { case: r.case } : {}), ...(r.from ? { from: r.from } : {}) };
    const preps = formatPrep(part);
    // Part of the word only when it changes the meaning (bestehen auf); else a detail (denken an).
    if (joiningPair(p.term, tail.word)) return { ...p, term: withPrep(p.term, tail.word), base: p.term, prep: part, preps };
    return { ...p, note: part, preps };
  }
  return reflexive(parseTerm(text));
}

/** "Sich treffen" → "sich treffen"; one verb after "sich", not a phrase. */
function reflexive(p: ParsedTerm): ParsedTerm {
  const base = baseOfReflexive(p.term);
  return isReflexiveTerm(p.term) && p.pos !== 'noun' && /^\S+$/.test(base) ? { ...p, term: withSich(base), reflexive: true } : p;
}

// ---------- A preposition at the end ("warten auf + Akk") ----------

const P = PREPOSITIONS.join('|');
const CASE_WORD = 'akkusativ|akk|dativ|dat|genitiv|gen|infinitiv|inf';
const PLACEHOLDER = 'etwas|etw|jemanden|jemandem|jemand|jmdn|jmdm|jmd|jdn|jdm';
/** "… auf", "… auf + Akk", "… auf (Akk.)", "… auf Akk", "… auf jdn.", "… auf/über". */
const TAIL = new RegExp(
  `^(.+?)\\s+((?:${P})(?:\\s*/\\s*(?:${P}))*)` +
    `(?:\\s*\\+\\s*(${CASE_WORD}|a|d|g)\\.?|\\s*\\(\\s*\\+?\\s*(${CASE_WORD}|a|d|g)\\.?\\s*\\)|\\s+(${CASE_WORD})\\.?|\\s+(${PLACEHOLDER})\\.?)?$`,
  'iu',
);
/** Dictionary order: "auf jdn. warten", "sich auf etw. freuen". */
const LEAD = new RegExp(`^(sich\\s+)?(${P})\\s+(${PLACEHOLDER})\\.?\\s+(.+)$`, 'iu');

/** Case a placeholder stands in: "jdn" → Akk, "jdm" → Dat, "etwas" → unknown. */
const placeholderCase = (w: string): PrepCase | undefined =>
  /^(?:jemanden|jmdn|jdn)$/i.test(w) ? 'Akk' : /^(?:jemandem|jmdm|jdm)$/i.test(w) ? 'Dat' : undefined;

/** Lowercase words ending like an infinitive that aren't verbs. */
const NOT_VERBS = new Set(['schon', 'ein', 'kein', 'mein', 'dein', 'man', 'wann', 'wenn', 'dann', 'denn', 'gern', 'fern', 'den', 'ihn', 'nun', 'oben', 'unten', 'eben', 'neben', 'gegen', 'innen', 'außen', 'morgen', 'gestern', 'selten', 'einen', 'keinen', 'meinen', 'deinen', 'seinen', 'ihren', 'unseren', 'euren', 'diesen', 'jeden', 'allen', 'vielen', 'wen', 'zusammen']);

/** Could this be the word a preposition goes with? An infinitive, a noun, or an adjective of the list. */
function headWord(base: string): boolean {
  const words = base.split(' ').filter((w) => !/^(?:sich|der|die|das)$/i.test(w));
  if (!words.length || words.length > 3) return false;
  const last = words[words.length - 1];
  if (PREPOSITIONS.includes(last.toLowerCase())) return false;
  if (/^\p{Lu}/u.test(last)) return true; // a noun: "die Angst vor", "Lust auf"
  if (NOT_VERBS.has(last)) return isPairBase(base.replace(/^(?:der|die|das)\s+/i, ''));
  if (last.length >= 3 && /(?:[^e]en|[eu]rn|eln|ern|[aeiouäöü]n)$/.test(last)) return true;
  return isPairBase(base.replace(/^(?:der|die|das)\s+/i, ''));
}

/**
 * The preposition at the end of the typed head (the text before a comma), when the rest reads as
 * a word that goes with it: "warten auf", "die Angst vor", "stolz auf". An explicit case or a
 * placeholder ("auf jdn.") always counts; "ab und zu", "nach wie vor", "kommt an" don't.
 */
function prepTail(head: string): { base: string; word: string; case?: PrepCase; many?: string[] } | null {
  let h = head.trim();
  const ellipsis = /…|\.\.\./.test(h);
  if (ellipsis) h = h.replace(/\s*(?:…|\.\.\.)\s*/g, ' ').trim();
  const lead = h.match(LEAD);
  if (lead) {
    const base = `${lead[1] ?? ''}${lead[4]}`.trim();
    if (!headWord(base)) return null;
    return { base, word: lead[2].toLowerCase(), case: placeholderCase(lead[3]) };
  }
  const m = h.match(TAIL);
  if (!m) return null;
  const base = m[1].trim();
  // A phrase that starts with a preposition stays whole: "in Bezug auf", "im Vergleich zu".
  const first = base.split(' ')[0].toLowerCase();
  if (PREPOSITIONS.includes(first) || Object.prototype.hasOwnProperty.call(CONTRACTIONS, first)) return null;
  const words = m[2].toLowerCase().split(/\s*\/\s*/);
  const marker = m[3] ?? m[4] ?? m[5];
  const typed = marker ? caseOfWord(marker) : m[6] ? placeholderCase(m[6]) : undefined;
  const explicit = !!marker || !!m[6] || (ellipsis && words[0] === 'zu');
  if (!headWord(base) && (!explicit || base.split(' ').length > 4)) return null;
  if (words.length > 1) {
    return { base, word: words[0], many: words.map((w) => formatPrep({ word: w, ...knownOf(base, w) })) };
  }
  const word = words[0];
  const c = typed ?? (ellipsis && word === 'zu' ? 'Inf' : undefined);
  return { base, word, ...(c ? { case: c } : {}) };
}

const knownOf = (base: string, word: string): { case?: PrepCase } => {
  const r = resolveCase(base, word);
  return r.case ? { case: r.case } : {};
};

function parseTerm(raw: string): ParsedTerm {
  const text = raw.trim().replace(/\s+/g, ' ');

  const article = text.match(/^((?:der|die|das)(?:\s*\/\s*(?:der|die|das))*)\s+(.+)$/i);
  if (article) {
    const genders = [...new Set(article[1].toLowerCase().split('/').map((a) => GENDER_OF_ARTICLE[a.trim()]))];
    const [noun, ...rest] = article[2].split(',').map((s) => s.trim());
    const term = noun.replace(/\s*\(.*\)$/, '');
    return { term, pos: 'noun', genders, plural: pluralOf(term, rest.join(',').trim()) };
  }

  const parts = text.split(',').map((s) => s.trim());
  if (parts.length === 3) {
    const perfekt = parts[2].match(/^(ist|hat|sein|haben)\s+(\S+)$/i);
    if (perfekt) {
      const aux = perfekt[1].toLowerCase();
      return {
        term: parts[0],
        pos: 'verb',
        genders: [],
        praeteritum: parts[1],
        partizip2: perfekt[2],
        auxiliary: aux === 'ist' || aux === 'sein' ? 'sein' : 'haben',
      };
    }
  }

  return { term: text, genders: [] };
}
