// @ts-nocheck
// Levels A1–B1 follow the Goethe-Zertifikat word lists, read from DWDS (which offers no list above
// B1, and neither does Goethe). Only which word is at which level is taken from them; translations
// and examples stay ours. The lists' rows are matched to dictionary lemmas here (pure functions).
import { keysByWord, tieRank } from './rank.mjs';

export const GOETHE_LEVELS = ['A1', 'A2', 'B1'];
/** Rows that aren't words: "%", "cm" and word parts like "aller-". */
const NOT_WORDS = new Set(['Symbol', 'Affix']);

/** DWDS "Wortart" → dictionary parts of speech, best first. */
const NOUN = ['noun', 'name', 'abbrev', 'unknown'];
const ADJ = ['adj', 'adv', 'particle', 'unknown'];
const OTHER = ['pron', 'det', 'num', 'adv', 'prep', 'conj', 'particle', 'intj', 'adj', 'phrase', 'unknown'];
function wantedPos(wortart) {
  if (wortart === 'Substantiv' || wortart === 'Eigenname') return NOUN;
  if (wortart === 'Verb') return ['verb', 'phrase', 'unknown'];
  if (wortart === 'Mehrwortausdruck') return ['phrase', 'noun', ...OTHER];
  if (/Adjektiv|Komparativ|Superlativ/.test(wortart)) return ADJ;
  return OTHER;
}

/** DWDS CSV → [{lemma, wortart, gender}]; one row per list entry. */
export function parseGoethe(text) {
  return text
    .trim()
    .split('\n')
    .slice(1)
    .map((line) => {
      const [lemma, , wortart, genus] = [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1].replaceAll('""', '"'));
      // "neutr., mask." (Gehalt): the first is the listed word.
      return { lemma: lemma.normalize('NFC'), wortart, gender: { 'mask.': 'm', 'fem.': 'f', 'neutr.': 'n' }[genus.split(',')[0]] ?? '' };
    });
}

/**
 * Rows of all lists as the entries to place: [{lemma, wortart, gender, level}], lowest level first.
 * From the table in goethe.json: `skip` drops rows ("Lemma", or "Lemma|Wortart" for one reading),
 * `alias` turns a row into our lemma ("meine": "mein", "getrennt": "trennen|Verb" also changes
 * the part of speech), `extra` adds what the lists only imply. Non-words are dropped.
 * @param {Record<string, {lemma: string, wortart: string, gender: string}[]>} lists
 * @param {{skip?: string[], alias?: Record<string, string>, extra?: Record<string, string[]>}} table
 */
export function goetheEntries(lists, { skip = [], alias = {}, extra = {} } = {}) {
  const skipped = new Set(skip);
  const out = [];
  for (const level of GOETHE_LEVELS) {
    for (const row of lists[level] ?? []) {
      if (NOT_WORDS.has(row.wortart) || skipped.has(row.lemma) || skipped.has(`${row.lemma}|${row.wortart}`)) continue;
      const [lemma, wortart] = (alias[row.lemma] ?? row.lemma).split('|');
      out.push({ ...row, lemma, wortart: wortart ?? row.wortart, level });
    }
    for (const item of extra[level] ?? []) {
      const [lemma, wortart] = item.split('|');
      out.push({ lemma, wortart: wortart ?? (lemma[0] === lemma[0].toLowerCase() ? '' : 'Substantiv'), gender: '', level });
    }
  }
  return out;
}

/** Noun, verb or the rest: within these a term is one card, "gerade" adjective and adverb alike. */
const kindOfWortart = (wortart) => (wortart === 'Substantiv' || wortart === 'Eigenname' ? 'noun' : wortart === 'Verb' ? 'verb' : 'other');
const kindOfPos = (pos) => (pos === 'noun' || pos === 'verb' ? pos : 'other');

/** Dictionary key of an entry: right part of speech first, then one that has translations. */
function lemmaKey(entry, lemmas, byWord) {
  const wanted = wantedPos(entry.wortart);
  const score = (k) => {
    const i = wanted.indexOf(lemmas[k].rawPos);
    return (i < 0 ? wanted.length : i) * 2 + (lemmas[k].tr.ru.length || lemmas[k].tr.en.length ? 0 : 1);
  };
  const keys = (byWord.get(entry.lemma) ?? []).filter((k) => wanted.includes(lemmas[k].rawPos));
  return keys.sort((a, b) => score(a) - score(b))[0];
}

/**
 * Give each entry's word its `level`. Words missing from `words` are created at the rank their
 * frequency gives them, whatever kept them out of the top words: a listed word is wanted even when
 * the frequency list barely has it, or the dictionary flags a rare sense ("billig", "Koffer").
 * Returns { added, unmatched }; entries of the same word keep the lowest level.
 * @param rankedAll every ranked group by count, for the ranks of words beyond the top
 * @param make (group) → one word record, as baseWords builds them
 */
export function placeGoethe(entries, words, { lemmas, rankedAll, tokenCount, make }) {
  const byWord = keysByWord(lemmas);
  const byCard = new Map(words.filter((w) => !w.mainKey).map((w) => [`${w.term}|${kindOfPos(w.pos)}`, w]));
  const counts = rankedAll.map((g) => g.count);
  const rankOf = new Map();
  rankedAll.forEach((g, i) => g.members.forEach((k) => rankOf.set(k, i + 1)));
  const groupOf = new Map();
  for (const g of rankedAll) for (const k of g.members) groupOf.set(k, g);

  const added = [];
  const unmatched = [];
  for (const entry of entries) {
    const card = `${entry.lemma}|${kindOfWortart(entry.wortart)}`;
    let word = byCard.get(card);
    if (!word) {
      const key = lemmaKey(entry, lemmas, byWord);
      if (!key) {
        unmatched.push(entry);
        continue;
      }
      const g = groupOf.get(key) ?? { key, members: [key], count: tokenCount.get(lemmas[key].word.toLowerCase()) ?? 0 };
      word = make(g);
      word.rank = rankOf.get(key) ?? tieRank(counts, g.count);
      if (word.pos === 'noun' && !word.genders.length && entry.gender) word.genders = [entry.gender];
      byCard.set(card, word);
      added.push(word);
    }
    // "die See" listed, "der See" the main article: the level belongs to the added article.
    const articles = lemmas[word.key]?.articles;
    const isOther = entry.gender && articles?.[0] && !articles[0].genders.includes(entry.gender);
    const other = isOther && words.find((w) => w.mainKey === word.key && w.article === entry.gender);
    const target = other || word;
    target.level = !target.level || GOETHE_LEVELS.indexOf(entry.level) < GOETHE_LEVELS.indexOf(target.level) ? entry.level : target.level;
  }
  return { added, unmatched };
}
