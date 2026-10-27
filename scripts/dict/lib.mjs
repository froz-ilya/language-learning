// @ts-nocheck
// Pure helpers for the offline dictionary build (scripts/dict/build.mjs). No I/O.
import { inflectedForms } from '../levels/lib/extract.mjs';

/** Same as normalizeKey in src/lib/dict/local.ts: lowercase, ä→a ö→o ü→u ß→ss. */
export function normalizeKey(word) {
  return word.toLowerCase().replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss');
}

/** Piece prefix of a word (lemma or form). */
export const prefixOf = (word) => normalizeKey(word).slice(0, 2);

/**
 * File of the piece that holds a word: the longest key (4, 3 or 2 letters of normalizeKey) in
 * the index. Prefixes too big for one file are split by their next letters.
 */
export function pieceFile(pieces, word) {
  const k = normalizeKey(word);
  for (let n = 4; n >= 1; n--) if (n <= k.length && pieces[k.slice(0, n)]) return pieces[k.slice(0, n)];
  return undefined;
}

/** A form worth indexing: one word of letters (inner hyphens/apostrophes allowed), not absurdly long. */
export function plausibleToken(form) {
  return form.length >= 1 && form.length <= 40 && /^\p{L}(?:[\p{L}'’-]*\p{L})?$/u.test(form);
}

const PRONOUNS = new Set(['ich', 'du', 'er', 'sie', 'es', 'er/sie/es', 'wir', 'ihr', 'Sie', 'man']);

/**
 * Inflected forms of a kaikki lemma entry, lower-cased: the single-word forms of the level
 * pipeline (noun cases and plurals, conjugations, Partizip II, adjective declensions and
 * comparatives) plus zu-infinitives ("anzurufen"); `separable` holds the finite verb of
 * split forms ("rief an" → "rief", "ich rufe an" → "rufe").
 * @returns {{forms: string[], separable: string[]}}
 */
export function formsOfEntry(entry) {
  const out = new Set(inflectedForms(entry));
  const separable = new Set();
  const word = entry.word ?? '';
  if (entry.pos === 'verb') {
    for (const f of entry.forms ?? []) {
      const tags = f.tags ?? [];
      if (tags.includes('imperative') || tags.includes('auxiliary')) continue;
      let parts = String(f.form ?? '')
        .replace(/!$/, '')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      if (parts.length > 1 && PRONOUNS.has(parts[0])) parts = parts.slice(1);
      if (parts.length === 1) {
        // Finite forms from the conjugation table ("ich anrufe") and zu-infinitives.
        const finite = tags.some((t) => ['present', 'past', 'subjunctive-i', 'subjunctive-ii'].includes(t));
        const zu = tags.includes('infinitive') && tags.includes('extended');
        if ((finite && !tags.some((t) => /passive|perfect/.test(t))) || zu) out.add(parts[0].toLowerCase());
      } else if (parts.length === 2) {
        // Separable verb: "rief an" of anrufen. The particle must be the start of the lemma.
        const [verb, particle] = parts;
        if (particle.length >= 2 && word.startsWith(particle) && word.length > particle.length + 2) separable.add(verb.toLowerCase());
      }
    }
  }
  const ok = (set) => [...set].filter((f) => plausibleToken(f));
  return { forms: ok(out), separable: ok(separable).filter((f) => !out.has(f)) };
}

/**
 * Endings stripped by the runtime's fallback lemmatiser (src/lib/dict/local.ts keeps an
 * identical copy): noun cases/plurals, adjective declension, comparative and superlative,
 * regular present/past verb endings. A form these rules resolve to exactly its lemmas is not
 * stored in the forms map.
 */
export const SUFFIXES = [
  'e', 'n', 's', 't', 'en', 'em', 'er', 'es', 'st', 'et', 'te', 'nd', 'est', 'ten', 'tet', 'ete', 'end', 'ern', 'nen',
  'ere', 'ste', 'test', 'eten', 'etet', 'eren', 'erem', 'erer', 'eres', 'sten', 'stem', 'ster', 'stes', 'este',
  'etest', 'esten', 'estem', 'ester', 'estes',
];

/** Lower-cased lemma candidates of a lower-cased token by ending rules (stems ≥ 3 letters). */
export function ruleCandidates(token) {
  const out = [];
  for (const s of SUFFIXES) {
    if (!token.endsWith(s) || token.length - s.length < 3) continue;
    const stem = token.slice(0, -s.length);
    for (const c of [stem, `${stem}en`, `${stem}n`]) if (c !== token && !out.includes(c)) out.push(c);
  }
  return out;
}

/** Pos letter / tag string of the compact entry (see decodeEntry in src/lib/dict/local.ts). */
const POS_CODE = { noun: 'n', verb: 'v', adj: 'a', other: 'o' };
const LEVEL_DIGIT = { A1: '1', A2: '2', B1: '3', B2: '4', C1: '5', C2: '6' };

/**
 * A grammar form relative to the term: "<n><suffix>" = drop the last n (0–9) letters of the term
 * and append the suffix ("Tisch" + "0e" = "Tische", "machen" + "2te" = "machte"); the full form
 * when that is not shorter. Forms never start with a digit, so the two are unambiguous.
 */
export function compactForm(term, form) {
  if (!form) return form;
  let i = 0;
  while (i < term.length && i < form.length && term[i] === form[i]) i++;
  const drop = term.length - i;
  if (drop > 9) return form;
  const c = `${drop}${form.slice(i)}`;
  return c.length < form.length ? c : form;
}

/** Inverse of compactForm. */
export function expandForm(term, s) {
  if (!s || !/^\d/.test(s)) return s ?? '';
  return term.slice(0, term.length - Number(s[0])) + s.slice(1);
}

/**
 * LexEntry → compact array [rank, tags, ru, en, a?, b?]:
 *   tags = pos letter (n/v/a/o) + noun genders (m/f/n) or verb auxiliary (h/s) + level digit (1–6, A1–C2);
 *   noun: a = plural; verb: a = Präteritum, b = Partizip II, each as compactForm. Trailing
 *   empty strings are dropped. The term is the id (minus "#pos").
 */
export function encodeEntry(e) {
  let tags = POS_CODE[e.pos] ?? 'o';
  if (e.pos === 'noun') tags += e.genders.join('');
  if (e.pos === 'verb' && e.auxiliary) tags += e.auxiliary[0];
  if (e.level) tags += LEVEL_DIGIT[e.level];
  const out = [e.rank, tags, e.tr.ru, e.tr.en];
  if (e.pos === 'noun') out.push(compactForm(e.term, e.plural));
  if (e.pos === 'verb') out.push(compactForm(e.term, e.praeteritum), compactForm(e.term, e.partizip2));
  while (out.length > 4 && !out[out.length - 1]) out.pop();
  return out;
}

/**
 * Group prefixes into files. `sizes`: Map prefix → approx bytes. Prefixes are sorted and
 * consecutive small ones merged until a file reaches `min` bytes. Returns [{name, prefixes}].
 */
export function groupPieces(sizes, { min = 4000 } = {}) {
  const prefixes = [...sizes.keys()].sort();
  const files = [];
  let cur = null;
  for (const p of prefixes) {
    if (!cur || cur.size >= min) {
      cur = { prefixes: [], size: 0 };
      files.push(cur);
    }
    cur.prefixes.push(p);
    cur.size += sizes.get(p);
  }
  // A small last file joins the previous one.
  if (files.length > 1 && files[files.length - 1].size < min) {
    const last = files.pop();
    files[files.length - 1].prefixes.push(...last.prefixes);
  }
  const used = new Set();
  return files.map((f, i) => {
    let name = f.prefixes.find((p) => /^[a-z]{1,4}$/.test(p)) ?? `x${i}`;
    if (used.has(name)) name = `${name}${i}`;
    used.add(name);
    return { name, prefixes: f.prefixes };
  });
}
