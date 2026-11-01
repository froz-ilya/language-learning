// @ts-nocheck
// The extra layer of the offline dictionary: rare separable verbs outside the size budget of the
// main pieces (scripts/dict/build.mjs), and the base verbs they need ("fächerte" → fächern). Pure,
// no I/O. The runtime reads it only when the main dictionary has no verb for a word
// (src/lib/dict/local.ts). A verb's particle is the end of its Präteritum ("fächerte auf").
import { formatMeanings } from '../levels/lib/extract.mjs';
import { reflexiveFields, reflexiveOf } from './reflexive.mjs';
import { encodeEntry, formsOfEntry, ruleCandidates } from './lib.mjs';

/** Ranks of the extra layer start after anything the main dictionary can hold. */
export const EXTRA_RANK = 50000;
/** A base verb points to at most this many particle verbs, as next to "ging" in the main pieces. */
const MAX_COMPOUNDS = 3;

/**
 * Verbs the dump has no usable data for, in the style of HAND_FORMS in build.mjs. `base` makes a
 * particle verb from its base verb's table: Wiktionary has no entry "auffächern", only a mention
 * under fächern (which has no translations of its own).
 */
export const HAND_VERBS = {
  fächern: { tr: { ru: 'делить на отделения; расходиться веером', en: 'divide into compartments; fan out' } },
  auffächern: {
    particle: 'auf',
    base: 'fächern',
    tr: { ru: 'раскладывать веером; разбивать на части', en: 'fan out; break down' },
    reflexive: 'also',
    trRefl: { ru: 'расходиться веером; распадаться, разветвляться', en: 'fan out; branch out' },
    preps: 'in + Akk',
  },
};

/** Labels of a word learners rarely meet: dated, regional. "Austrian German", "Bavarian", "mD". */
const MARKED = /^(archaic|obsolete|outdated|dated|historical|regional|dialectal|veraltet|veraltend|landschaftlich|mundartlich|Süddeutschland|Norddeutschland|Österreich|Schweiz|mD|nordd|südd)$|German$|Bavarian|Swabian|Alemannic|Erzgebirgisch|Vienna|deutsch$/i;

/** True when some sense with a meaning has none of the labels in MARKED. */
export function hasPlainSense(entry) {
  const senses = (entry.senses ?? []).filter((s) => s.sense_index && (s.glosses ?? []).some((g) => g.trim()));
  return senses.some((s) => ![...(s.tags ?? []), ...(s.raw_tags ?? [])].some((t) => MARKED.test(t)));
}

/** Adds a verb entry of the dump to `verbs` (word → what the extra layer needs of it); homonyms merge. */
export function noteVerb(verbs, entry) {
  let v = verbs.get(entry.word);
  if (!v) verbs.set(entry.word, (v = { word: entry.word, particle: '', forms: new Set(), split: new Set(), infos: [], plain: false }));
  const f = formsOfEntry(entry);
  for (const x of f.forms) v.forms.add(x);
  for (const x of f.split) v.split.add(x);
  if (f.particle.length > v.particle.length) v.particle = f.particle;
  v.infos.push(reflexiveOf(entry));
  v.plain ||= hasPlainSense(entry);
}

/** The base verb of a particle verb ("auffächern" → "fächern"), or '' when nothing verb-like is left. */
export function baseOf(word, particle) {
  const base = word.slice(particle.length);
  return base.length >= 4 && /n$/.test(base) ? base : '';
}

/** Forms of "auffächern" from its base's: joined finite forms, Partizip II and zu-infinitive. */
export function compoundOf(particle, base) {
  const participle = base.partizip2.toLowerCase();
  const forms = new Set([`${particle}zu${base.term}`.toLowerCase(), `${particle}${participle}`.toLowerCase()]);
  for (const f of base.forms) if (f !== participle) forms.add(`${particle}${f}`.toLowerCase());
  return {
    term: `${particle}${base.term}`,
    praeteritum: base.praeteritum ? `${base.praeteritum} ${particle}` : '',
    partizip2: base.partizip2 ? `${particle}${base.partizip2}` : '',
    auxiliary: base.auxiliary,
    forms,
  };
}

/** A base verb Wiktionary doesn't have ("beraumen"), from its particle verb's table. */
export function baseFromCompound(term, particle, compound) {
  const praeteritum = compound.praeteritum.split(/\s+/)[0] ?? '';
  const partizip2 = compound.partizip2.startsWith(particle) ? compound.partizip2.slice(particle.length) : '';
  return { term, praeteritum, partizip2, auxiliary: compound.auxiliary, forms: new Set([...compound.split, partizip2.toLowerCase()].filter(Boolean)) };
}

const lexEntry = (e) => ({
  term: e.term,
  pos: 'verb',
  genders: [],
  plural: '',
  praeteritum: e.praeteritum ?? '',
  partizip2: e.partizip2 ?? '',
  auxiliary: e.auxiliary ?? '',
  tr: e.tr,
  rank: 0,
  ...(e.reflexive ? { reflexive: e.reflexive } : {}),
  ...(e.trRefl ? { trRefl: e.trRefl } : {}),
  ...(e.preps ? { preps: e.preps } : {}),
});

/**
 * Picks the verbs of the extra layer.
 *   verbs: from noteVerb; mainVerbs: terms of the verbs in the main pieces;
 *   wordOf(term): { rec, praeteritum, partizip2, auxiliary, tr: {ru, en} } from dict.json, tr as
 *   text; undefined when the dump has no such verb; rec as dict.json has it.
 *   usable(rec): the word may stand in the dictionary (not offensive, junk, without translation);
 *   mainRank(term): rank of a verb of the main pieces.
 * Particle verbs: not in the main pieces, translated, some sense without a dated or regional
 * label. Base verbs: of those and of the main pieces' particle verbs, when not in the main pieces
 * themselves (real ones with or without a translation, since a form only has to read as a verb;
 * made up from the particle verb's table when Wiktionary has none).
 * @returns {{verbs: object[], stats: object, compounds: Map<string, string[]>}} `verbs` are
 *   { entry: LexEntry, forms: Set<string>, particle, made }, best first and ranked; compounds:
 *   base term → terms of its particle verbs (of both layers), most useful first.
 */
export function selectExtra({ verbs, mainVerbs, wordOf, usable, mainRank, hand = HAND_VERBS }) {
  const out = new Map();
  const stats = { separable: 0, inMain: 0, untranslated: 0, unusable: 0, marked: 0, hand: 0, realBases: 0, madeBases: 0 };
  const add = (e, forms, particle, score, made = false) => out.set(e.term, { entry: lexEntry(e), forms, particle, score, made });
  const reflexive = (v, tr) => reflexiveFields(v?.infos ?? [], tr);
  for (const v of verbs.values()) {
    if (!v.particle || /\s/.test(v.word)) continue;
    stats.separable++;
    if (mainVerbs.has(v.word)) {
      stats.inMain++;
      continue;
    }
    const w = wordOf(v.word);
    if (!w?.tr.ru && !w?.tr.en) {
      stats.untranslated++;
      continue;
    }
    if (!usable(w.rec)) {
      stats.unusable++;
      continue;
    }
    if (!v.plain) {
      stats.marked++;
      continue;
    }
    if (!w.praeteritum || !w.partizip2) {
      stats.unusable++;
      continue;
    }
    add({ ...w, term: v.word, ...reflexive(v, w.tr) }, v.forms, v.particle, (w.tr.ru ? 4 : 0) + (w.tr.en ? 2 : 0) + 1);
  }

  // Hand-made particle verbs and translations.
  for (const [term, h] of Object.entries(hand)) {
    if (mainVerbs.has(term) || !h.base) continue;
    const w = wordOf(h.base);
    if (!w) continue;
    const b = { ...w, term: h.base, forms: verbs.get(h.base)?.forms ?? new Set() };
    const c = compoundOf(h.particle, b);
    add({ ...c, tr: h.tr, reflexive: h.reflexive, trRefl: h.trRefl, preps: h.preps }, c.forms, h.particle, 7);
    verbs.set(term, { word: term, particle: h.particle, forms: c.forms, split: b.forms, infos: [], plain: true });
    stats.hand++;
  }

  // Base verbs. A particle verb of the main pieces counts too ("tischte … auf": tischen).
  const compounds = new Map();
  const particleVerbs = [...verbs.values()].filter((v) => v.particle && !/\s/.test(v.word) && (out.has(v.word) || mainVerbs.has(v.word)));
  for (const v of particleVerbs) {
    const base = baseOf(v.word, v.particle);
    if (!base || mainVerbs.has(base)) continue;
    if (!compounds.has(base)) compounds.set(base, []);
    compounds.get(base).push(v.word);
    if (out.has(base) && !hand[base]) continue;
    const w = wordOf(base);
    const h = hand[base];
    if (w?.rec.offensive) continue;
    const tr = h?.tr ?? w?.tr ?? { ru: '', en: '' };
    if (out.has(base)) {
      out.get(base).entry.tr = tr;
      continue;
    }
    const c = out.get(v.word)?.entry ?? wordOf(v.word);
    const made = baseFromCompound(base, v.particle, { praeteritum: c?.praeteritum ?? '', partizip2: c?.partizip2 ?? '', auxiliary: c?.auxiliary ?? '', split: v.split });
    if (w) {
      // A table without Präteritum or Partizip II ("ahmen") takes them from its particle verb.
      const e = { ...w, praeteritum: w.praeteritum || made.praeteritum, partizip2: w.partizip2 || made.partizip2 };
      add({ ...e, term: base, tr, ...reflexive(verbs.get(base), tr) }, verbs.get(base)?.forms ?? new Set(), '', tr.ru || tr.en ? 3 : 0);
      stats.realBases++;
    } else if (made.praeteritum) {
      add({ ...made, tr }, made.forms, '', 0, true);
      stats.madeBases++;
    }
  }
  for (const [base, list] of compounds) {
    const rank = (t) => mainRank(t) ?? EXTRA_RANK;
    compounds.set(base, list.sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : 1)).slice(0, MAX_COMPOUNDS));
  }

  const list = [...out.values()].sort((a, b) => b.score - a.score || (a.entry.term < b.entry.term ? -1 : 1));
  list.forEach((v, i) => (v.entry.rank = EXTRA_RANK + i + 1));
  return { verbs: list, stats, compounds };
}

/**
 * Forms left out of the extra layer: the bare stem ("kram", "bein", "butter" of ich butter) and the
 * short forms of -ern/-eln verbs ("dunklen" of ich dunkle) read as other words far more often.
 */
function rareForm(term, form) {
  const lower = term.toLowerCase();
  const m = lower.match(/^(.+)e([lr])n$/);
  return form === lower.replace(/e?n$/, '') || (!!m && form.startsWith(`${m[1]}${m[2]}`));
}

/**
 * Pieces of the extra layer, in the format of the main ones ({ lemmas, forms }), and its gate.
 *   forms: forms the ending rules don't resolve to exactly their verbs, not those the main
 *   dictionary reads as a verb (the runtime never gets here with them); a base verb's lemma key
 *   holds its particle verbs ("fächern" → auffächern).
 *   probe(form): { any, verb }, what the main dictionary finds for a lower-case form.
 *   frequent(form): the word is common, so with a main hit it is that word ("sondern", "klaren").
 *   gate: what the runtime may look for although the main dictionary has a non-verb hit
 *   (extraMayKnow in src/lib/dict/local.ts). Any other word with a main hit needs no extra file.
 *   "fächern": the verb, by itself and from forms with a verbal ending ("fächerte" next to Fächer);
 *   "sondern*": only from those; a form the rules don't find ("spie"): by itself.
 */
export function layoutExtra(verbs, compounds, probe, frequent) {
  const byLower = new Map(verbs.map((v) => [v.entry.term.toLowerCase(), v.entry.term]));
  const lemmas = new Map();
  const formIds = new Map();
  const participles = new Set();
  for (const v of verbs) {
    lemmas.set(v.entry.term, encodeEntry(v.entry));
    participles.add(v.entry.partizip2.toLowerCase());
    for (const f of v.forms) {
      if (rareForm(v.entry.term, f)) continue;
      if (!formIds.has(f)) formIds.set(f, []);
      formIds.get(f).push(v.entry.term);
    }
  }
  const forms = new Map();
  const gate = new Set();
  const shadowed = new Set(); // lower-case verbs with a form behind a main hit
  for (const [f, ids] of formIds) {
    const m = probe(f);
    // Main reads it as a verb, or as the adjective a participle mostly is ("ausgezeichnet").
    if (m.verb || (m.any && participles.has(f))) continue;
    const own = byLower.get(f);
    const others = ids.filter((id) => id !== own);
    if (!others.length) continue;
    const rule = new Set();
    if (!own) for (const c of ruleCandidates(f)) if (byLower.has(c)) rule.add(byLower.get(c));
    if (rule.size === others.length && others.every((id) => rule.has(id))) {
      if (m.any) for (const id of others) shadowed.add(id.toLowerCase());
    } else if (!m.any || !frequent(f)) {
      forms.set(f, others);
      if (m.any) gate.add(f);
    }
  }
  for (const v of verbs) {
    const f = v.entry.term.toLowerCase();
    const m = probe(f);
    if (m.verb) continue;
    if (m.any) gate.add(v.made || frequent(f) ? `${f}*` : f);
    else if (shadowed.has(f)) gate.add(f);
  }
  for (const [base, list] of compounds) {
    if (!lemmas.has(base)) continue;
    const key = base.toLowerCase();
    forms.set(key, [...new Set([...(forms.get(key) ?? []), ...list])]);
  }
  return { lemmas, forms, gate: [...gate].sort() };
}

/** "a, b; c" meanings as text from dict.json's string[][] (formatMeanings), for wordOf. */
export const trText = (tr) => ({ ru: formatMeanings(tr.ru), en: formatMeanings(tr.en) });
