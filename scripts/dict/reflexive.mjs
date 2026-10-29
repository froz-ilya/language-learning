// @ts-nocheck
// Reflexive verbs and prepositional objects for the offline dictionary (scripts/dict/build.mjs),
// read from a kaikki.org (de-edition Wiktionary) verb entry. Pure, no I/O.
//
// A sense is reflexive when kaikki tags it `reflexive`, a usage label says "reflexiv" or starts
// with "sich" ("sich auf etwas freuen", gloss label "sich ärgern: …"), a header sense before it
// says "reflexiv:", or a translation of it is labelled "reflexiv: …". It is mixed (counts as
// both) when tagged `reflexive` and `transitive`, or labelled "auch" / "auch reflexiv" /
// "transitiv oder reflexiv" / "(sich)" (waschen: "jemanden/sich waschen").
import { formatMeanings, marginalSenses, translationsOf } from '../levels/lib/extract.mjs';

/** Prepositions that always take one case. */
const FIXED_CASE = {
  für: 'Akk', um: 'Akk', durch: 'Akk', gegen: 'Akk', ohne: 'Akk', wider: 'Akk',
  mit: 'Dat', von: 'Dat', zu: 'Dat', bei: 'Dat', aus: 'Dat', nach: 'Dat', seit: 'Dat', gegenüber: 'Dat',
  wegen: 'Gen', während: 'Gen', trotz: 'Gen', statt: 'Gen',
};
/** Two-way prepositions: Akk or Dat, by the pattern or the examples. */
const TWO_WAY = new Set(['an', 'auf', 'in', 'über', 'unter', 'vor', 'hinter', 'neben', 'zwischen']);
const isPrep = (w) => w in FIXED_CASE || TWO_WAY.has(w);

/** Object placeholders in usage patterns and the case they show ('' = either). */
const PLACEHOLDER = {
  etwas: '', etw: '', jemand: '', jmd: '', was: '',
  jemanden: 'Akk', jmdn: 'Akk', jdn: 'Akk', wen: 'Akk',
  jemandem: 'Dat', jmdm: 'Dat', jdm: 'Dat', wem: 'Dat',
  jemandes: 'Gen', jmds: 'Gen',
};
/**
 * Articles as placeholders: "einer Sache", "eine Person"; another noun only next to a case mark
 * ("auf das Ereignis (Akkusativ)"), as "in der Wendung …" is a note, not an object.
 */
const ARTICLE = { einer: 'Dat', eine: 'Akk', einen: 'Akk', einem: 'Dat', das: 'Akk', den: 'Akk', dem: 'Dat', der: 'Dat', die: 'Akk' };

/** The case a word right after a two-way preposition shows in a sentence, or '' when unclear. */
function caseAfterPrep(word, next = '') {
  const w = word.toLowerCase();
  if (['dem', 'einem', 'der', 'einer', 'mir', 'dir', 'ihm', 'diesem', 'dieser', 'jedem', 'jeder'].includes(w)) return 'Dat';
  if (['die', 'das', 'eine', 'einen', 'mich', 'dich', 'ihn', 'diesen', 'diese', 'dieses', 'jeden', 'jede'].includes(w)) return 'Akk';
  // "den Regen" (Akk) but "den Kindern" (Dat plural): only without the plural -n.
  if (w === 'den') return /n$/.test(next) ? '' : 'Akk';
  // Possessives: -em/-er are Dat; the bare form (mein, sein, unser) can't be Nom after a preposition.
  const poss = w.match(/^(mein|dein|sein|unser|euer|eur|kein)(e|en|em|er)?$/);
  if (poss) {
    if (poss[2] === 'em' || poss[2] === 'er') return 'Dat';
    if (poss[2] === 'en') return /n$/.test(next) ? '' : 'Akk';
    return poss[1] === 'eur' ? '' : 'Akk';
  }
  return '';
}

/** Contractions after which the case is known: "aufs" = auf das, "am" = an dem. */
const CONTRACTION = {
  ans: ['an', 'Akk'], aufs: ['auf', 'Akk'], ins: ['in', 'Akk'], übers: ['über', 'Akk'], unters: ['unter', 'Akk'],
  vors: ['vor', 'Akk'], hinters: ['hinter', 'Akk'], am: ['an', 'Dat'], im: ['in', 'Dat'], überm: ['über', 'Dat'],
  unterm: ['unter', 'Dat'], vorm: ['vor', 'Dat'], hinterm: ['hinter', 'Dat'],
};

const words = (text) => String(text ?? '').toLowerCase().match(/[\p{L}]+/gu) ?? [];

/**
 * Prepositions of a usage pattern: [{prep, case}] ('' when the pattern doesn't show it). Only a
 * preposition followed by an object ("auf etwas", "für jemanden", "auf das Ereignis") counts, so
 * "um (gleich, …) etwas zu machen" and "mit einem abhängigen Infinitiv" give nothing.
 *   "sich auf etwas freuen" → auf ''; "warten auf das Ereignis (Akkusativ)" → auf Akk;
 *   "sich für etwas/jemanden interessieren" → für Akk; "jemandem (bei etwas) helfen" → bei Dat.
 * A quoted preposition in a label ("reflexiv, mit „um“") is taken as is.
 */
export function prepsOfPattern(pattern) {
  const text = String(pattern ?? '');
  const out = [];
  const add = (prep, c) => {
    const kase = FIXED_CASE[prep] ?? c;
    const same = out.find((x) => x.prep === prep);
    if (!same) out.push({ prep, case: kase });
    else if (!same.case) same.case = kase;
  };
  for (const m of text.matchAll(/mit\s+(?:Präposition\s+)?[„"‚']([\p{L}]+)[“"‘']/gu)) if (isPrep(m[1].toLowerCase())) add(m[1].toLowerCase(), '');
  const ws = words(text);
  const marked = /\bAkk(?:usativ\b|\.|\b)/.test(text) ? 'Akk' : /\bDat(?:iv\b|\.|\b)/.test(text) ? 'Dat' : '';
  ws.forEach((w, i) => {
    // A list of prepositions ("an/auf/in etwas tippen") names none in particular.
    if (!isPrep(w) || isPrep(ws[i - 1] ?? '') || isPrep(ws[i + 1] ?? '')) return;
    const next = ws[i + 1] ?? '';
    if (next in ARTICLE) {
      if (/^(sache|person)$/.test(ws[i + 2] ?? '')) add(w, ARTICLE[next]);
      else if (marked) add(w, marked);
      return;
    }
    if (!(next in PLACEHOLDER)) return;
    let c = '';
    // "etwas/jemanden": the first placeholder that shows a case.
    for (let j = i + 1; j < ws.length && ws[j] in PLACEHOLDER && !c; j++) c = PLACEHOLDER[ws[j]];
    add(w, c || marked);
  });
  return out;
}

/**
 * Case of a two-way preposition in example sentences: unanimous votes, else ''. A preposition
 * right after a noun ("die Händler auf dem Markt") belongs to the noun and doesn't vote.
 */
export function caseFromExamples(prep, texts) {
  const votes = new Set();
  for (const t of texts) {
    const ws = String(t ?? '').match(/[\p{L}]+/gu) ?? [];
    ws.forEach((w, i) => {
      const lw = w.toLowerCase();
      if (i > 1 && /^\p{Lu}/u.test(ws[i - 1])) return;
      if (CONTRACTION[lw]?.[0] === prep) votes.add(CONTRACTION[lw][1]);
      if (lw !== prep || !ws[i + 1]) return;
      const c = caseAfterPrep(ws[i + 1], (ws[i + 2] ?? '').toLowerCase());
      if (c) votes.add(c);
    });
  }
  return votes.size === 1 ? [...votes][0] : '';
}

/** da-/wo-compounds → preposition ("daran" → an, "worüber" → über). */
const COMPOUND = /^(?:da|wo)r?(an|auf|aus|bei|durch|für|gegen|hinter|in|mit|nach|neben|über|um|unter|von|vor|zu|zwischen)$/;
const REFL_PRONOUN = new Set(['mich', 'dich', 'sich', 'uns', 'euch', 'mir', 'dir']);

/**
 * The preposition of a sense labelled "mit Präpositionalobjekt" without naming it, from its
 * examples: da-compounds ("daran") and a preposition right after the reflexive pronoun ("mich an
 * dich"). Only when every example that shows one agrees.
 */
export function prepFromExamples(texts) {
  const found = new Set();
  for (const t of texts) {
    const ws = words(t);
    ws.forEach((w, i) => {
      const m = w.match(COMPOUND);
      if (m) found.add(m[1]);
      else if (isPrep(w) && REFL_PRONOUN.has(ws[i - 1]) && ws[i + 1]) found.add(w);
    });
  }
  return found.size === 1 ? [...found][0] : '';
}

const senseNumber = (s) => {
  const m = String(s ?? '').match(/\d+/);
  return m ? Number(m[0]) : 99;
};

const REFL_LABEL = /\breflexiv\b/i;
/** Senses whose prepositions are left out: dated, regional or of a field (law, "Verhaltensforschung"). */
const SPECIAL_TAG = /^(archaic|obsolete|outdated|dated|historical|rare|regional|dialectal|poetic|literary|jargon|slang|vulgar|derogatory|law|physics|finance|geometry|geography|linguistics|Ecclesiastical)$|German$|Bavarian|Swabian|Alemannic|Erzgebirgisch|Vienna/;
const specialSense = (s) =>
  (s.tags ?? []).some((t) => SPECIAL_TAG.test(t)) ||
  // A field label: one capitalised word ("Spiel", "Verhaltensforschung"), or "(Computer) …" in the gloss.
  (s.raw_tags ?? []).some((t) => /^\p{Lu}[\p{Ll}-]+$/u.test(t)) ||
  /^\(\p{Lu}[\p{L}-]*\)\s/u.test((s.glosses ?? []).at(-1) ?? '');
const MIXED_LABEL = /\b(?:auch|meist|oft|meistens|häufig|selten|teils|teilweise|gelegentlich|oder)\s+reflexiv\b|\breflexiv\s+oder\b|\(sich\)/i;
const PREP_OBJECT = /Präpositionalobjekt|mit Präposition\b/i;

/** "reflexiv, mit „um“: für jemanden sorgen" → "reflexiv, mit „um“"; '' without a label. */
const labelOf = (gloss) => {
  const m = String(gloss ?? '').match(/^([^:]{1,100}):\s*\S/);
  return m ? m[1].trim() : '';
};

const hasWord = (text, word) => ` ${words(text).join(' ')} `.includes(` ${word.toLowerCase()} `);

/** 'refl' | 'mixed' | 'plain' from tags and usage labels. */
function kindOf(tags, labels, lemma) {
  const sich = labels.some((l) => /^\(?sich\)?\s/i.test(l) && (hasWord(l, lemma) || /^\(?sich\)?\s+~/.test(l)));
  const refl = tags.includes('reflexive') || sich || labels.some((l) => REFL_LABEL.test(l));
  if (!refl) return 'plain';
  const mixed = (tags.includes('reflexive') && tags.includes('transitive')) || labels.some((l) => l === 'auch' || MIXED_LABEL.test(l));
  return mixed ? 'mixed' : 'refl';
}

/**
 * Reflexive data of one kaikki verb entry:
 *   { reflexive: 'only' | 'also' | undefined, tr: { ru: string[][], en: string[][] }, preps: [{prep, case}] }
 * reflexive 'only' when every counted non-marginal sense is purely reflexive (sich beeilen),
 * 'also' when some sense is (sich treffen next to treffen). Counted: senses with a gloss, not
 * headers ("reflexiv:"); a parent sense counts too (melden: 1 report, 1a sich melden). tr:
 * translations of the purely reflexive senses (translationsOf's rules). preps: from patterns that name
 * the verb ("sich auf etwas freuen", "warten auf das Ereignis (Akkusativ)"), labels with a quoted
 * preposition ("reflexiv, mit „um“"), and "mit Präpositionalobjekt" senses' examples; a two-way
 * preposition's case from the pattern, else unanimous examples, else none ("auf").
 */
export function reflexiveOf(entry) {
  const lemma = String(entry.word ?? '');
  const senses = (entry.senses ?? []).filter((s) => !(s.tags ?? []).includes('form-of'));
  const marginal = marginalSenses(entry);
  const trLabels = new Map(); // sense_index → translation labels
  for (const t of entry.translations ?? []) {
    const label = labelOf(t.sense) || (REFL_LABEL.test(t.sense ?? '') ? t.sense : '');
    if (!t.sense_index || !label) continue;
    if (!trLabels.has(t.sense_index)) trLabels.set(t.sense_index, []);
    trLabels.get(t.sense_index).push(label);
  }
  let context = 'plain';
  const info = [];
  for (const s of senses) {
    const gloss = (s.glosses ?? []).at(-1) ?? '';
    // Header senses ("transitiv:", "reflexiv:") set the kind of the senses after them.
    if (!s.sense_index && /:\s*$/.test(gloss)) {
      context = kindOf([], [gloss.replace(/:\s*$/, '')], lemma);
      continue;
    }
    if (!s.sense_index) continue;
    const labels = [...(s.raw_tags ?? []), labelOf(gloss)].filter(Boolean);
    const trl = [...new Set(trLabels.get(s.sense_index) ?? [])];
    let kind = kindOf(s.tags ?? [], [...labels, ...trl], lemma);
    if (kind === 'plain') kind = context;
    const glossed = !!gloss.trim() || trl.length > 0;
    info.push({ s, kind, labels: [...labels, ...trl], counted: glossed && !marginal.has(senseNumber(s.sense_index)) });
  }
  const counted = info.filter((x) => x.counted);
  let reflexive;
  if (info.some((x) => x.kind !== 'plain')) reflexive = counted.length && counted.every((x) => x.kind === 'refl') ? 'only' : 'also';

  // Translations of the purely reflexive senses (a mixed sense's are mostly the transitive verb's).
  const refl = new Set(info.filter((x) => x.kind === 'refl').map((x) => x.s.sense_index));
  const sub = {
    word: lemma,
    senses: info.filter((x) => refl.has(x.s.sense_index)).map((x) => x.s),
    translations: (entry.translations ?? []).filter((t) => refl.has(t.sense_index)),
  };
  const tr = reflexive ? { ru: translationsOf(sub, 'ru'), en: translationsOf(sub, 'en') } : { ru: [], en: [] };

  const preps = [];
  for (const x of info) {
    if (marginal.has(senseNumber(x.s.sense_index)) || specialSense(x.s)) continue;
    const examples = (x.s.examples ?? []).map((e) => e.text);
    const found = [];
    for (const l of x.labels) {
      // A pattern names the verb; a label only counts with a quoted preposition ("mit „um“").
      const own = hasWord(l, lemma) ? l : (l.match(/mit\s+(?:Präposition\s+)?[„"‚'][\p{L}]+[“"‘']/u)?.[0] ?? '');
      found.push(...prepsOfPattern(own));
    }
    if (!found.length && x.kind !== 'plain' && x.labels.some((l) => PREP_OBJECT.test(l))) {
      const p = prepFromExamples(examples);
      if (p) found.push({ prep: p, case: FIXED_CASE[p] ?? '' });
    }
    for (const f of found) {
      if (TWO_WAY.has(f.prep)) {
        // The examples fill a missing case, and overrule a pattern they contradict ("fehlen an
        // etwas (Akkusativ)" next to "es fehlt am Nötigsten") by leaving it out.
        const c = caseFromExamples(f.prep, examples);
        if (!f.case) f.case = c;
        else if (c && c !== f.case) f.case = '';
      }
      preps.push(f);
    }
  }
  return { reflexive, tr, preps: mergePreps([preps]) };
}

/** Merge preposition lists (sense order): one per preposition, a known case wins, at most 3. */
export function mergePreps(lists) {
  const out = [];
  for (const p of lists.flat()) {
    const same = out.find((x) => x.prep === p.prep);
    if (!same) out.push({ ...p });
    else if (!same.case) same.case = p.case;
    else if (p.case && p.case !== same.case) same.conflict = true;
  }
  // Two cases for one preposition ("an etwas denken" / "an einem Ort"): say none.
  return out.map((p) => (p.conflict ? { prep: p.prep, case: '' } : p)).slice(0, 3);
}

/** [{prep:'auf', case:'Akk'}, {prep:'an', case:''}] → "auf + Akk; an" (Card.preps format). */
export const formatPreps = (preps) => preps.map((p) => (p.case ? `${p.prep} + ${p.case}` : p.prep)).join('; ');

/**
 * Reflexive fields of a dictionary verb from reflexiveOf of its kaikki entries (homonyms of one
 * word): the LexEntry fields { reflexive?, trRefl?, preps? }. `tr` is the entry's own
 * translations; a reflexive translation equal to it is left '' (the runtime falls back to tr).
 */
export function reflexiveFields(infos, tr) {
  const out = {};
  const kinds = infos.map((i) => i.reflexive).filter(Boolean);
  // 'only' when every homonym that has senses is reflexive-only.
  if (kinds.length) out.reflexive = kinds.length === infos.length && kinds.every((k) => k === 'only') ? 'only' : 'also';
  if (out.reflexive) {
    const trRefl = {};
    for (const lang of ['ru', 'en']) {
      const text = formatMeanings(infos.flatMap((i) => i.tr[lang]));
      trRefl[lang] = text && text !== tr[lang] ? text : '';
    }
    if (trRefl.ru || trRefl.en) out.trRefl = trRefl;
  }
  const preps = formatPreps(mergePreps(infos.map((i) => i.preps)));
  if (preps) out.preps = preps;
  return out;
}
