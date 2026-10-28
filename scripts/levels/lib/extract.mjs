// @ts-nocheck
// Pure helpers that turn kaikki.org (wiktextract) German Wiktionary entries into compact
// dictionary records. No I/O here so they can be unit-tested on fixture lines.

/** kaikki pos → app Pos. Everything that is not a noun/verb/adjective is 'other'. */
export function appPos(rawPos) {
  return rawPos === 'noun' || rawPos === 'verb' || rawPos === 'adj' ? rawPos : 'other';
}

const GENDER = { masculine: 'm', feminine: 'f', neuter: 'n' };

/** Sense/translation tags that make a lemma unsuitable for a learner preset. */
const OFFENSIVE = /\b(vulgar|derogatory|offensive|pejorat\w*|slur|vulgär|abwertend|derb|beleidigend|impolite|diskriminierend|schimpfwort)\b/i;
/** Senses that should not supply the main translations. */
const MARGINAL = /^(archaic|obsolete|outdated|dated|historical|rare|regional|dialectal|poetic|literary|jargon|slang|veraltet|selten)$/i;

/** Raw pos as used by the pipeline: 'phrase' entries tagged as interjections become 'intj'. */
export function rawPosOf(entry) {
  const tags = entry.tags ?? [];
  if (entry.pos === 'phrase' && tags.includes('intj')) return 'intj';
  return entry.pos ?? 'unknown';
}

/** True for inflected-form entries ("ging", "Häuser"). */
export function isFormOf(entry) {
  return (entry.tags ?? []).includes('form-of') || (entry.senses ?? []).every((s) => (s.tags ?? []).includes('form-of'));
}

const LEMMA_IN_GLOSS =
  /(?:des|der|von)\s+(?:(?:Verbs|Substantivs|Adjektivs|Pronomens|Personalpronomens|Possessivpronomens|Demonstrativpronomens|Relativpronomens|Interrogativpronomens|Indefinitpronomens|Artikels|Numerales|Adverbs|Hilfsverbs|Modalverbs)\s+)?([\p{L}-]+)\s*$/u;

/** Lemmas an inflected-form entry points to ("ging" → ["gehen"]). */
export function formOfTargets(entry) {
  const out = [];
  for (const s of entry.senses ?? []) {
    for (const f of s.form_of ?? []) if (f.word && !out.includes(f.word)) out.push(f.word);
    if (!s.form_of?.length) {
      for (const g of s.glosses ?? []) {
        const m = g.match(LEMMA_IN_GLOSS);
        if (m && !out.includes(m[1])) out.push(m[1]);
      }
    }
  }
  return out;
}

const INFLECTION_TAGS = new Set([
  'nominative', 'genitive', 'dative', 'accusative', 'present', 'past', 'subjunctive-i', 'subjunctive-ii',
  'imperative', 'participle-2', 'comparative', 'superlative', 'positive', 'singular', 'plural',
]);
const NON_INFLECTION_TAGS = new Set([
  'auxiliary', 'variant', 'abbreviation', 'diminutive', 'alternative', 'masculine-form', 'obsolete', 'symbol',
]);

function cleanForm(f) {
  return (f ?? '').replace(/!$/, '').trim();
}

/** Single-word inflected forms listed in a lemma's forms table (lower-cased). */
export function inflectedForms(entry) {
  const out = new Set();
  for (const f of entry.forms ?? []) {
    const tags = f.tags ?? [];
    if (!tags.some((t) => INFLECTION_TAGS.has(t)) || tags.some((t) => NON_INFLECTION_TAGS.has(t))) continue;
    if (tags.includes('imperative') || /!$/.test(f.form ?? '')) continue;
    // Gender counterparts ("Vater" for "Mutter") are tagged with a bare gender.
    if (tags.length === 1 && GENDER[tags[0]]) continue;
    const form = cleanForm(f.form);
    if (!form || /\s/.test(form) || form === '—' || form === '-') continue;
    out.add(form.toLowerCase());
  }
  return [...out];
}

function firstForm(entry, pred) {
  for (const f of entry.forms ?? []) {
    const form = cleanForm(f.form);
    if (!form || form === '—' || form === '-' || form === '?') continue;
    if (pred(f.tags ?? [])) return form;
  }
  return '';
}

/** Grammar fields of the card. */
export function grammarOf(entry) {
  const pos = appPos(rawPosOf(entry));
  const out = { genders: [], plural: '', praeteritum: '', partizip2: '', auxiliary: '' };
  if (pos === 'noun') {
    // The declension table's articles give the main gender first ("der Monat", not "das Monat");
    // the entry tags are the fallback.
    const ARTICLE = { der: 'm', die: 'f', das: 'n' };
    for (const f of entry.forms ?? []) {
      const t = f.tags ?? [];
      const g = ARTICLE[f.article];
      if (g && t.includes('nominative') && t.includes('singular') && !out.genders.includes(g)) out.genders.push(g);
    }
    if (!out.genders.length) {
      for (const t of entry.tags ?? []) if (GENDER[t] && !out.genders.includes(GENDER[t])) out.genders.push(GENDER[t]);
    }
    // Further genders are mostly regional variants ("das Monat", "der Butter"): keep the main one.
    out.genders = out.genders.slice(0, 1);
    out.plural = firstForm(entry, (t) => t.includes('nominative') && t.includes('plural'));
  } else if (pos === 'verb') {
    out.praeteritum = firstForm(entry, (t) => t.length === 1 && t[0] === 'past');
    out.partizip2 = firstForm(entry, (t) => t.includes('participle-2'));
    const aux = firstForm(entry, (t) => t.includes('auxiliary'));
    out.auxiliary = aux === 'haben' || aux === 'sein' ? aux : '';
  }
  return out;
}

function senseNumber(s) {
  const m = String(s ?? '').match(/\d+/);
  return m ? Number(m[0]) : 99;
}

/** Normalise one translation string: "call ( against )" → "call", "идти (Uhr)" → "идти". */
export function cleanTranslation(word, lang) {
  let w = String(word ?? '')
    .split(/\s*[,;]\s+|\s+,\s*/)[0]
    .replace(/\([^)]*\)/g, ' ')
    // German glosses quoted inside a translation: "мочь „dürfen“" → "мочь".
    .replace(/„[^“”"]*[“”"]?/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    // Separators left behind by removed notes: "make do (with) ," → "make do".
    .replace(/^[\s,;:]+|[\s,;:]+$/g, '')
    .replace(/[!¡?¿]+$/g, '')
    .trim();
  if (lang === 'en') w = w.replace(/^to\s+/i, '');
  // Russian stress marks ("заве́дующий").
  if (lang === 'ru') w = w.normalize('NFD').replace(/\u0301/g, '').normalize('NFC');
  if (!w || /^[-–—…,.;:]+$/.test(w)) return '';
  return w;
}

/** Register/usage labels that make a sense (other than the first) or a translation second-rate. */
const REGISTER = /\b(archaic|obsolete|outdated|dated|historical|rare|regional|dialectal|poetic|literary|jargon|slang|colloquial|vulgar|impolite|derogatory|offensive|informal|casual|humorous|figurative)\b/i;
const REGISTER_DE = /umgangssprachlich|salopp|derb|vulgär|veraltet|landschaftlich|regional|scherzhaft|abwertend|übertragen|fachsprachlich|Jägersprache|Seemannssprache|Schach|Sport|Turnen|Jugendsprache/i;

/** Sense numbers (never 1) whose translations should not be used when better ones exist. */
export function marginalSenses(entry) {
  const out = new Set();
  for (const s of entry.senses ?? []) {
    const n = senseNumber(s.sense_index);
    if (n === 1) continue;
    if ((s.tags ?? []).some((t) => REGISTER.test(t)) || (s.raw_tags ?? []).some((t) => REGISTER_DE.test(t))) out.add(n);
  }
  return out;
}

/** Caps of a translation string: meanings, synonyms per meaning, synonyms of a single meaning. */
export const MAX_MEANINGS = 3;
export const MAX_SYNONYMS = 2;
export const MAX_SINGLE = 3;

const tokens = (w) => w.toLowerCase().split(/[\s\-–/]+/).filter(Boolean);

/**
 * Near-duplicate: the same word, or one is a whole-word part of the other ("current" /
 * "electric current", "ток" / "электрический ток").
 */
export function similarWord(a, b) {
  const x = tokens(a).join(' ');
  const y = tokens(b).join(' ');
  return x === y || ` ${x} `.includes(` ${y} `) || ` ${y} `.includes(` ${x} `);
}

/**
 * Merge meaning lists (each string[][], best first) into one: meanings in the given order,
 * words already used by an earlier meaning dropped, a meaning left empty skipped. At most
 * `maxMeanings` meanings of at most `maxSynonyms` words; a single meaning keeps `maxSingle`.
 */
export function limitMeanings(meanings, { maxMeanings = MAX_MEANINGS, maxSynonyms = MAX_SYNONYMS, maxSingle = MAX_SINGLE } = {}) {
  const out = [];
  const used = [];
  for (const m of meanings) {
    if (out.length >= maxMeanings) break;
    const words = [];
    for (const w of m ?? []) {
      // A word never contains the separators.
      const t = String(w ?? '')
        .replace(/[;,]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!t || used.some((u) => similarWord(u, t)) || words.some((u) => similarWord(u, t))) continue;
      words.push(t);
    }
    if (!words.length) continue;
    out.push(words.slice(0, maxSingle));
    // Only the words that stay count as used, so a dropped synonym can still start a meaning.
    used.push(...words.slice(0, out.length === 1 ? maxSingle : maxSynonyms));
  }
  return out.length > 1 ? out.map((m) => m.slice(0, maxSynonyms)) : out;
}

/** [["последствие", "результат"], ["серия"]] → "последствие, результат; серия" (same as joinMeanings in src/lib/german/meanings.ts). */
export function formatMeanings(meanings) {
  return limitMeanings(meanings ?? [])
    .map((m) => m.join(', '))
    .join('; ');
}

/** "a, b; c" → [["a", "b"], ["c"]] (same as splitMeanings in src/lib/german/meanings.ts). */
export function parseMeanings(text) {
  return String(text ?? '')
    .split(';')
    .map((m) =>
      m
        .split(',')
        .map((w) => w.trim())
        .filter(Boolean),
    )
    .filter((m) => m.length);
}

/** Sense number → how many languages Wiktionary translates that sense into (its weight). */
function senseWeights(entry) {
  const langs = new Map();
  for (const t of entry.translations ?? []) {
    const n = senseNumber(t.sense_index);
    if (!langs.has(n)) langs.set(n, new Set());
    langs.get(n).add(t.lang_code);
  }
  return new Map([...langs].map(([n, s]) => [n, s.size]));
}

/**
 * Translations into `lang` grouped by meaning, best first: string[][] (meanings → synonyms),
 * e.g. Folge → [["последствие"], ["череда", "ряд"], ["эпизод"]].
 *
 * Meaning 1 comes from the best sense (lowest number with a plain register; a labelled one only
 * when nothing else is translated). Other plain senses add a meaning when they matter: Wiktionary
 * translates them into at least `minShare` as many languages as the first one ("Zug": train,
 * draught, move — not "groove"); sense 2 always may when sense 1 gave a single word. The heaviest such senses are kept, in Wiktionary's sense order;
 * a sense whose words were all used already adds nothing ("Haus" 2 is дом again). Register-
 * labelled senses never add a meaning: "Pferd" → horse (not "knight"), "kommen" never gets
 * "кончить". Within a sense, translations without usage labels come first, then those that
 * recur across senses ("go" for gehen; first meaning only), then Wiktionary's order.
 */
export function translationsOf(entry, lang, { maxMeanings = MAX_MEANINGS, minShare = 0.3 } = {}) {
  const marginal = marginalSenses(entry);
  const bySense = new Map();
  const recur = new Map();
  (entry.translations ?? []).forEach((t, i) => {
    if (t.lang_code !== lang) return;
    const word = cleanTranslation(t.word, lang);
    if (!word) return;
    const n = senseNumber(t.sense_index);
    const bad = (t.raw_tags?.length ? 1 : 0) + ((t.tags ?? []).some((x) => REGISTER.test(x)) ? 1 : 0);
    if (!bySense.has(n)) bySense.set(n, []);
    bySense.get(n).push({ word, i, bad });
    if (!marginal.has(n)) recur.set(word.toLowerCase(), (recur.get(word.toLowerCase()) ?? 0) + 1);
  });
  if (!bySense.size) return [];
  const senses = [...bySense.keys()].sort((a, b) => Number(marginal.has(a)) - Number(marginal.has(b)) || a - b);
  const first = senses[0];
  // Recurring words lead only the first meaning ("go" for gehen); elsewhere they are the
  // least specific ones, so Wiktionary's order decides.
  const rec = (x, n) => (n === first ? (recur.get(x.word.toLowerCase()) ?? 0) : 0);
  const self = String(entry.word ?? '').toLowerCase();
  const words = (n) => {
    const items = bySense.get(n).sort((a, b) => a.bad - b.bad || rec(b, n) - rec(a, n) || a.i - b.i);
    const good = items.filter((x) => !x.bad);
    // Another meaning that is the German word itself ("Reich" → "Reich") says nothing.
    const list = (good.length ? good : items).map((x) => x.word).filter((x) => n === first || x.toLowerCase() !== self);
    return [...new Set(list)];
  };
  const weight = senseWeights(entry);
  const w = (n) => weight.get(n) ?? 0;
  // Sense 2 also counts when sense 1 gave a single word ("Griff": ручка; хват, ухват).
  const thin = first === 1 && words(first).length < 2;
  const others = senses
    .filter((n) => n !== first && !marginal.has(n) && bySense.get(n).some((x) => !x.bad))
    .filter((n) => w(n) >= minShare * w(first) || (thin && n === 2))
    .sort((a, b) => w(b) - w(a) || a - b);
  // Heaviest senses that add new words, then back into sense order.
  const picked = [first];
  let meanings = limitMeanings([words(first)]);
  for (const n of others) {
    if (picked.length >= maxMeanings) break;
    const next = [...picked, n].sort((a, b) => a - b);
    const m = limitMeanings(next.map(words));
    if (m.length > meanings.length) {
      picked.push(n);
      meanings = m;
    }
  }
  return meanings;
}

/** True when the main meaning is vulgar/offensive. */
export function isOffensive(entry) {
  const senses = entry.senses ?? [];
  const bad = (s) => [...(s.tags ?? []), ...(s.raw_tags ?? [])].some((t) => OFFENSIVE.test(t));
  if (senses.length && bad(senses[0])) return true;
  return senses.length > 0 && senses.filter(bad).length * 2 >= senses.length;
}

/** Strip quotes, citation brackets and leftovers from an example sentence. */
export function cleanExample(text) {
  let t = String(text ?? '')
    .replace(/^\s*\[[^\]]*\]:?\s*/, '')
    .replace(/\s*\[…\]\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const m = t.match(/^[„"»«‚](.*)[“"«»‘]\.?$/);
  if (m && !/[„“"»«]/.test(m[1])) t = m[1].trim();
  return t;
}

/** Example candidates (cleaned) in preference order: own (non-quotation) examples of the first senses. */
export function examplesOf(entry, maxLen = 100) {
  const cands = [];
  (entry.senses ?? []).forEach((s, si) => {
    if ((s.tags ?? []).some((t) => MARGINAL.test(t))) si += 20;
    (s.examples ?? []).forEach((e, ei) => {
      if (e.ref) return;
      const text = cleanExample(e.text);
      if (text.length < 8 || text.length > maxLen) return;
      if (/[„“"«»…\[\]/|=]|^\W|\(.*\)|:\s/.test(text)) return;
      if (!/[.!?]$/.test(text)) return;
      if (!e.bold_text_offsets?.length) return;
      // Prefer one sentence of moderate length.
      const sentences = text.split(/[.!?]\s+(?=[A-ZÄÖÜ])/).length;
      const score = si * 10 + ei + (sentences > 1 ? 15 : 0) + (text.length > 70 ? 5 : 0) + (text.length < 18 ? 3 : 0);
      cands.push({ text, score });
    });
  });
  cands.sort((a, b) => a.score - b.score);
  return [...new Set(cands.map((c) => c.text))].slice(0, 3);
}

/**
 * Compact record of a German lemma entry, or a form-of record, or null (other languages, junk).
 * @returns {{kind:'lemma', word, rawPos, pos, genders, plural, praeteritum, partizip2, auxiliary,
 *   tr:{en:string[][],ru:string[][]}, examples:string[], forms:string[], offensive:boolean, tags:string[]}
 *   | {kind:'form', word, rawPos, lemmas:string[]} | null}
 */
export function parseKaikkiEntry(entry) {
  if (!entry || entry.lang_code !== 'de' || !entry.word) return null;
  const rawPos = rawPosOf(entry);
  if (isFormOf(entry)) {
    const lemmas = formOfTargets(entry);
    // Imperatives ("schon!" of schonen, "mal!" of malen) are rare next to their homographs.
    const imperative = (entry.senses ?? []).every((s) => (s.tags ?? []).includes('imperative'));
    return lemmas.length ? { kind: 'form', word: entry.word, rawPos, lemmas, imperative } : null;
  }
  return {
    kind: 'lemma',
    word: entry.word,
    rawPos,
    pos: appPos(rawPos),
    ...grammarOf(entry),
    tr: { en: translationsOf(entry, 'en'), ru: translationsOf(entry, 'ru') },
    examples: examplesOf(entry),
    forms: inflectedForms(entry),
    offensive: isOffensive(entry),
    tags: entry.tags ?? [],
    // Nominalised adjectives ("Letzter", "Erster") decline like adjectives.
    nominalised:
      rawPos === 'noun' && (entry.forms ?? []).some((f) => (f.raw_tags ?? []).some((r) => /Deklination/.test(r))),
    senses: (entry.senses ?? []).length,
    trCount: (entry.translations ?? []).filter((t) => t.lang_code === 'en' || t.lang_code === 'ru').length,
  };
}

/**
 * Translations of two homonyms (same word + pos): the first meaning of each, then the rest.
 * Nouns of another gender ("der Leiter" / "die Leiter") are another word: only a missing
 * language is filled, as before.
 */
function mergeTranslations(a, b, lang) {
  const x = a.tr[lang];
  if (!x.length) return b.tr[lang];
  if (a.pos === 'noun' && a.genders.join('') !== b.genders.join('')) return x;
  // "Rad" (wheel) + "Rad" (the unit "rad"): a meaning that is the word itself says nothing.
  const y = b.tr[lang].map((m) => m.filter((w) => w.toLowerCase() !== a.word.toLowerCase()));
  if (!y.some((m) => m.length)) return x;
  return limitMeanings([x[0], y[0], ...x.slice(1), ...y.slice(1)]);
}

const hasTr = (r) => !!(r.tr.ru.length || r.tr.en.length);

/**
 * Do two entries mean the same thing? True when, in some language both translate, their first
 * meanings share a word ("der Teil" / "das Teil": часть; "der/das Moment": момент). Undecidable
 * (one has no translations) counts as the same.
 */
export function sameMeaning(a, b) {
  if (!hasTr(a) || !hasTr(b)) return true;
  let compared = false;
  for (const lang of ['ru', 'en']) {
    const x = a.tr[lang][0] ?? [];
    const y = b.tr[lang][0] ?? [];
    if (!x.length || !y.length) continue;
    compared = true;
    if (x.some((u) => y.some((v) => similarWord(u, v)))) return true;
  }
  return !compared;
}

/**
 * Collect a word's noun entries by article (`list` is changed and returned). An entry joins the
 * entry of its own gender (homonyms of one article stay one word: "die Bank" bench + bank), or
 * an entry of another gender with the same meaning (gender variants: der/das Teil); an entry
 * whose gender and meaning both differ starts a new article ("der See" lake / "die See" sea).
 * The first entry is the main article (the one the merged record keeps).
 */
export function addArticle(list, rec) {
  const g = rec.genders[0];
  const own = g ? list.find((x) => x.genders[0] === g || !x.genders.length) : list[0];
  if (own) {
    const i = list.indexOf(own);
    list[i] = mergeLemma(own, rec);
    return list;
  }
  const like = list.find((x) => sameMeaning(x, rec));
  if (like) list[list.indexOf(like)] = mergeLemma(like, rec);
  else list.push(rec);
  return list;
}

/** The fields of one article kept in dict.json (see buildDict). */
export function articleRecord(rec) {
  return {
    genders: rec.genders,
    plural: rec.plural,
    tr: rec.tr,
    examples: rec.examples,
    forms: rec.forms,
    offensive: rec.offensive,
    senses: rec.senses,
    trCount: rec.trCount,
  };
}

/** Merge a later homonym entry (same word + pos) into the first one. */
export function mergeLemma(a, b) {
  const uniq = (xs) => [...new Set(xs)];
  return {
    ...a,
    genders: a.genders.length ? a.genders : b.genders,
    plural: a.plural || b.plural,
    praeteritum: a.praeteritum || b.praeteritum,
    partizip2: a.partizip2 || b.partizip2,
    auxiliary: a.auxiliary || b.auxiliary,
    // "Bank" (bench) + "Bank" (bank): скамейка, скамья; банк.
    tr: { en: mergeTranslations(a, b, 'en'), ru: mergeTranslations(a, b, 'ru') },
    examples: uniq([...a.examples, ...b.examples]),
    forms: uniq([...a.forms, ...b.forms]),
    offensive: a.offensive && b.offensive,
    senses: a.senses + b.senses,
    trCount: a.trCount + b.trCount,
    homonyms: (a.homonyms ?? 1) + 1,
  };
}
