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
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[!¡?¿]+$/g, '')
    .replace(/\s+/g, ' ')
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

/**
 * Translations into `lang` for the card, best first. Only the first one or two senses count:
 * the best sense (lowest number, plain register) gives its translations, and sense 2 may add
 * one when it is a plain sense too and the first gave fewer than two. Within a sense, translations without usage labels come
 * first, then those that recur across senses ("go" for gehen), then Wiktionary's order.
 * "Pferd" → horse (not "knight", a colloquial chess sense); "kommen" never gets "кончить".
 */
export function translationsOf(entry, lang, max = 3) {
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
  const senses = [...bySense.keys()].sort((a, b) => Number(marginal.has(a)) - Number(marginal.has(b)) || a - b);
  const out = [];
  const seen = new Set();
  let first = null;
  for (const n of senses) {
    // A second sense only adds to a thin first one ("Mutter" stays мать, мама, not матка).
    if (first !== null && (n > 2 || marginal.has(n) || out.length >= 2)) break;
    const items = bySense.get(n).sort(
      (a, b) => a.bad - b.bad || (recur.get(b.word.toLowerCase()) ?? 0) - (recur.get(a.word.toLowerCase()) ?? 0) || a.i - b.i,
    );
    const good = items.filter((x) => !x.bad);
    if (!good.length && first !== null) continue;
    for (const { word } of good.length ? good : items) {
      const k = word.toLowerCase();
      if (seen.has(k) || out.length >= max) continue;
      seen.add(k);
      out.push(word);
    }
    if (first === null) first = n;
    if (out.length >= max) break;
  }
  return out;
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
 *   tr:{en:string[],ru:string[]}, examples:string[], forms:string[], offensive:boolean, tags:string[]}
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
    // A second homonym (Mutter "mother" / Mutter "nut") only fills a missing language.
    tr: { en: a.tr.en.length ? a.tr.en : b.tr.en, ru: a.tr.ru.length ? a.tr.ru : b.tr.ru },
    examples: uniq([...a.examples, ...b.examples]),
    forms: uniq([...a.forms, ...b.forms]),
    offensive: a.offensive && b.offensive,
    senses: a.senses + b.senses,
    trCount: a.trCount + b.trCount,
    homonyms: (a.homonyms ?? 1) + 1,
  };
}
