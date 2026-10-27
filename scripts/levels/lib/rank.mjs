// @ts-nocheck
// Stage 2: lemmatise the frequency list against the dictionary index and rank lemmas.
import { limitMeanings } from './extract.mjs';

/** Parse FrequencyWords "word count" lines. */
export function parseFrequency(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const m = line.trim().match(/^(\S+)\s+(\d+)$/);
    if (m) out.push([m[1].normalize('NFC').toLowerCase(), Number(m[2])]);
  }
  return out;
}

/** Index lemma keys by exact word. */
export function keysByWord(lemmas) {
  const m = new Map();
  for (const key of Object.keys(lemmas)) {
    const word = key.slice(0, key.lastIndexOf('|'));
    let list = m.get(word);
    if (!list) m.set(word, (list = []));
    list.push(key);
  }
  return m;
}

/** Resolve a form-map target ("gehen|verb" or "gehen|?verb") to lemma keys. */
export function resolveTarget(target, lemmas, byWord) {
  const bar = target.lastIndexOf('|');
  const word = target.slice(0, bar);
  const pos = target.slice(bar + 1);
  if (!pos.startsWith('?')) return lemmas[target] ? [target] : [];
  const hint = pos.slice(1);
  const all = byWord.get(word) ?? [];
  const same = all.filter((k) => k.endsWith(`|${hint}`));
  if (same.length) return same;
  // Hints like 'unknown' (e.g. "bin" → sein) say nothing: prefer content words over names.
  return all.filter((k) => !k.endsWith('|name'));
}

/**
 * Candidate lemma keys per token. Imperative-only readings ("schon" of schonen, "mal" of
 * malen, "leid" of leiden) are dropped when the token has any other reading.
 */
export function candidates(freq, dict, exclude = new Set(), keep = new Set()) {
  const byWord = keysByWord(dict.lemmas);
  const out = new Map();
  for (const [token] of freq) {
    const main = new Set();
    const imperative = new Set();
    for (const t of dict.forms[token] ?? []) {
      const imp = t.startsWith('!');
      for (const k of resolveTarget(imp ? t.slice(1) : t, dict.lemmas, byWord)) (imp ? imperative : main).add(k);
    }
    let list = [...(main.size ? main : imperative)].filter((k) => !exclude.has(k));
    // "gute", "letzte": the adjective, not the nominalised "Guter"/"Letzter".
    if (list.some((k) => dict.lemmas[k].rawPos === 'adj')) list = list.filter((k) => !dict.lemmas[k].nominalised);
    if (list.length) out.set(token, list);
  }
  // Nominalised function words ("das Ich", "das Aber", "das Wie") would take the whole count of
  // the pronoun/conjunction: a capitalised noun competing with a function word keeps its
  // place only when it has unambiguous forms of its own ("Zeiten" for "Zeit").
  const unambiguous = new Map();
  for (const [token, count] of freq) {
    const c = out.get(token);
    if (c?.length === 1) unambiguous.set(c[0], (unambiguous.get(c[0]) ?? 0) + count);
  }
  const counts = new Map(freq);
  for (const [token, list] of out) {
    const fn = list.some((k) => FUNCTION_POS.has(dict.lemmas[k].rawPos) && dict.lemmas[k].word.toLowerCase() === token);
    if (!fn) continue;
    const kept = list.filter((k) => {
      const rec = dict.lemmas[k];
      if (rec.pos !== 'noun' || rec.word.toLowerCase() !== token) return true;
      return (unambiguous.get(k) ?? 0) >= counts.get(token) * 0.01 || keep.has(k);
    });
    out.set(token, kept);
  }
  return out;
}

/** Parts of speech that do not inflect (or whose paradigms are separate words). */
export const FUNCTION_POS = new Set(['pron', 'det', 'article', 'prep', 'conj', 'adv', 'particle', 'intj', 'num', 'postp']);

function prior(rec) {
  let p = (rec.senses ?? 1) * (1 + (rec.trCount ?? 0));
  // Lemmas without translations, names and abbreviations are usually obscure homographs.
  if (!rec.tr.en.length && !rec.tr.ru.length) p *= 0.2;
  if (rec.rawPos === 'name' || rec.rawPos === 'abbrev' || rec.rawPos === 'character') p *= 0.2;
  return p;
}

/**
 * Sum token counts per lemma. Ambiguous tokens ("leben", "sein", "gute") are split by a few
 * EM-style rounds: each candidate gets a share proportional to its current total (seeded by
 * unambiguous forms and a small dictionary-richness prior). Nouns get a boost because their
 * unambiguous forms (genitive, plural) are rarer than the ambiguous base form.
 */
export function lemmaCounts(freq, cands, lemmas, { nounBoost = 2, minorShare = 0.1, nounFloor = 0.3, rounds = 8 } = {}) {
  const priors = new Map();
  for (const c of cands.values()) for (const k of c) if (!priors.has(k)) priors.set(k, prior(lemmas[k]));
  let totals = new Map();
  for (const [token, count] of freq) {
    const c = cands.get(token);
    if (c?.length === 1) totals.set(c[0], (totals.get(c[0]) ?? 0) + count);
  }
  for (let round = 0; round < rounds; round++) {
    const next = new Map();
    const add = (k, v) => next.set(k, (next.get(k) ?? 0) + v);
    for (const [token, count] of freq) {
      const c = cands.get(token);
      if (!c) continue;
      if (c.length === 1) {
        add(c[0], count);
        continue;
      }
      let weights = c.map((k) => {
        const rec = lemmas[k];
        let w = (totals.get(k) ?? 0) + priors.get(k);
        if (rec.pos === 'noun') w *= nounBoost;
        // The token is the lemma itself: a small prior over "is just an inflected form of".
        if (rec.word.toLowerCase() === token) w *= 1.5;
        return w;
      });
      // Minor readings (< 10 % of the main one) get nothing from this token.
      const max = Math.max(...weights);
      weights = weights.map((w) => (w < max * minorShare ? 0 : w));
      const sum = weights.reduce((a, b) => a + b, 0);
      let shares = weights.map((w) => w / sum);
      // "liebe", "frage", "ruhe": the noun's own base form keeps at least `nounFloor` of the
      // token even though the verb ("ich liebe") has far more unambiguous evidence.
      const n = c.findIndex((k) => lemmas[k].pos === 'noun' && lemmas[k].word.toLowerCase() === token);
      // Only when every other reading is an inflected form ("ich liebe", "liebe Grüße") and the
      // noun is a substantial dictionary word compared with them (not "Habe" next to "haben").
      const rivals = c.filter((k, i) => i !== n && lemmas[k].rawPos !== 'name');
      const othersAreForms = rivals.every((k) => lemmas[k].word.toLowerCase() !== token);
      const rich = n >= 0 && rivals.every((k) => priors.get(c[n]) >= 0.25 * priors.get(k));
      if (n >= 0 && othersAreForms && rich && shares[n] < nounFloor) {
        const rest = 1 - shares[n];
        shares = shares.map((s, i) => (i === n ? nounFloor : rest ? (s * (1 - nounFloor)) / rest : 0));
      }
      c.forEach((k, i) => shares[i] && add(k, count * shares[i]));
    }
    totals = next;
  }
  return totals;
}

const KEEP_POS = new Set(['noun', 'verb', 'adj', 'adv', 'pron', 'prep', 'conj', 'particle', 'num', 'det', 'article', 'intj', 'postp']);
const SKIP_WORDS = new Set(['der', 'die', 'das']);
/** Interjections that are just sounds, and subtitle English. */
const NOISE = new Set([
  'ah', 'oh', 'äh', 'ähm', 'öh', 'eh', 'hm', 'hmm', 'mhm', 'mmh', 'uh', 'uhm', 'ha', 'haha', 'hahaha', 'hehe', 'pst',
  'psst', 'sch', 'aah', 'ooh', 'oho', 'huh', 'yeah', 'yes', 'wow', 'whoa', 'ok', 'hi', 'bye', 'sorry', 'please', 'fuck',
  'shit', 'damn', 'man', 'baby', 'boy', 'oops', 'ups', 'jo', 'yo', 'nah', 'bla', 'blabla', 'äh', 'tz', 'hu', 'hui', 'mh',
]);

/** Why a lemma is excluded from the presets, or '' to keep it. */
export function exclusionReason(rec) {
  if (!KEEP_POS.has(rec.rawPos)) return `pos:${rec.rawPos}`;
  if (SKIP_WORDS.has(rec.word)) return 'article';
  if (!/^\p{L}[\p{L}-]*\p{L}$/u.test(rec.word)) return 'shape';
  if (rec.word === rec.word.toUpperCase()) return 'acronym';
  const capital = rec.word[0] !== rec.word[0].toLowerCase();
  if (capital && rec.pos !== 'noun') return 'capitalised non-noun';
  if (rec.tags.includes('abbreviation')) return 'abbreviation';
  if (NOISE.has(rec.word.toLowerCase())) return 'noise';
  if (rec.offensive) return 'offensive';
  if (!rec.tr.en.length && !rec.tr.ru.length) return 'no translation';
  return '';
}

/** Identity of a card: one per word and pos class (adverb/particle/conj homographs merge). */
export function groupId(rec) {
  return `${rec.word}|${rec.pos}`;
}

/**
 * Ranked kept lemmas, by count desc: [{key, count, members}]. Homographs in the same group
 * ("mal" adverb/particle/conjunction) are summed; translations interleave the members'.
 */
export function rankLemmas(totals, lemmas, limit = Infinity) {
  const groups = new Map();
  for (const [key, count] of totals) {
    const rec = lemmas[key];
    if (!rec || exclusionReason(rec)) continue;
    const id = groupId(rec);
    let g = groups.get(id);
    if (!g) groups.set(id, (g = { id, count: 0, members: [] }));
    g.count += count;
    g.members.push({ key, count });
  }
  const sorted = [...groups.values()].sort((a, b) => b.count - a.count).slice(0, limit);
  return sorted.map((g) => {
    g.members.sort((a, b) => b.count - a.count);
    return { key: g.members[0].key, count: Math.round(g.count), members: g.members.map((m) => m.key) };
  });
}

/** Translations of a group: first meaning of each member (by part of speech), then the rest. */
const MEMBER_ORDER = ['noun', 'verb', 'adj', 'conj', 'pron', 'prep', 'det', 'num', 'adv', 'intj', 'postp', 'particle'];

/**
 * Meanings (string[][]) of a card made of several homographs ("schon" adverb + particle →
 * [["already"], ["indeed"]]); one member's meanings unchanged.
 */
export function groupTranslations(members, lemmas, lang) {
  // Modal particles ("schon" = "indeed") come after the adverb reading ("already").
  const order = (k) => {
    const i = MEMBER_ORDER.indexOf(lemmas[k].rawPos);
    return i < 0 ? MEMBER_ORDER.length : i;
  };
  const sorted = members.map((k, i) => ({ k, i })).sort((a, b) => order(a.k) - order(b.k) || a.i - b.i);
  const lists = sorted.map(({ k }) => lemmas[k].tr[lang]).filter((l) => l.length);
  return limitMeanings([...lists.map((l) => l[0]), ...lists.flatMap((l) => l.slice(1))]);
}
