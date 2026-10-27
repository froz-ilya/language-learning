// @ts-nocheck
// Stage 5: topics, per-level grouping and the LevelFile / LevelIndex output (pure functions).
import { formatMeanings } from './extract.mjs';
import { levelOf, BANDS } from './words.mjs';

export const TOPICS = [
  'Menschen & Familie', 'Körper & Gesundheit', 'Essen & Trinken', 'Wohnen & Haushalt', 'Stadt & Verkehr',
  'Reisen & Urlaub', 'Arbeit & Beruf', 'Schule & Lernen', 'Zeit & Kalender', 'Zahlen & Mengen', 'Natur & Wetter',
  'Tiere & Pflanzen', 'Kleidung & Aussehen', 'Einkaufen & Geld', 'Freizeit & Sport', 'Kommunikation & Medien',
  'Gefühle & Charakter', 'Gesellschaft & Politik', 'Wirtschaft & Recht', 'Wissenschaft & Technik', 'Kunst & Kultur',
  'Abstrakte Begriffe', 'Alltagsverben', 'Eigenschaften', 'Funktionswörter',
];
export const MIXED = 'Gemischt';
const FUNCTION_POS = new Set(['pron', 'det', 'article', 'prep', 'conj', 'particle', 'postp']);

/** Topic of a word: the committed classification, else a fallback by part of speech. */
export function topicOf(word, topics) {
  const t = topics[`${word.term}|${word.rawPos}`];
  if (t && TOPICS.includes(t)) return t;
  if (FUNCTION_POS.has(word.rawPos)) return 'Funktionswörter';
  if (word.rawPos === 'num') return 'Zahlen & Mengen';
  if (word.rawPos === 'verb') return 'Alltagsverben';
  if (word.rawPos === 'adj') return 'Eigenschaften';
  if (word.rawPos === 'adv') return 'Funktionswörter';
  if (word.rawPos === 'intj') return 'Kommunikation & Medien';
  return 'Abstrakte Begriffe';
}

/** Where a too-small topic goes before falling back to "Gemischt". */
export const RELATED = {
  'Tiere & Pflanzen': 'Natur & Wetter',
  'Natur & Wetter': 'Tiere & Pflanzen',
  'Kleidung & Aussehen': 'Menschen & Familie',
  'Essen & Trinken': 'Wohnen & Haushalt',
  'Wohnen & Haushalt': 'Essen & Trinken',
  'Stadt & Verkehr': 'Reisen & Urlaub',
  'Reisen & Urlaub': 'Stadt & Verkehr',
  'Arbeit & Beruf': 'Wirtschaft & Recht',
  'Schule & Lernen': 'Kommunikation & Medien',
  'Zeit & Kalender': 'Zahlen & Mengen',
  'Zahlen & Mengen': 'Zeit & Kalender',
  'Einkaufen & Geld': 'Wirtschaft & Recht',
  'Freizeit & Sport': 'Kunst & Kultur',
  'Kunst & Kultur': 'Freizeit & Sport',
  'Kommunikation & Medien': 'Schule & Lernen',
  'Gefühle & Charakter': 'Menschen & Familie',
  'Menschen & Familie': 'Gefühle & Charakter',
  'Körper & Gesundheit': 'Menschen & Familie',
  'Gesellschaft & Politik': 'Wirtschaft & Recht',
  'Wirtschaft & Recht': 'Gesellschaft & Politik',
  'Wissenschaft & Technik': 'Arbeit & Beruf',
  'Abstrakte Begriffe': 'Eigenschaften',
};

/**
 * Set names for one level's words (sorted by rank). A topic with fewer than `min` words joins
 * its related topic (set named "Bigger · Smaller"), else "Gemischt"; topics with more
 * than `max` are split by frequency into "Topic", "Topic 2", …. Returns a Map word → set name.
 */
export function groupTopics(words, { min = 5, max = 40 } = {}) {
  const groups = new Map();
  for (const w of words) {
    if (!groups.has(w.topic)) groups.set(w.topic, []);
    groups.get(w.topic).push(w);
  }
  for (let changed = true; changed; ) {
    changed = false;
    const small = [...groups].filter(([t, l]) => t !== MIXED && l.length < min).sort((a, b) => a[1].length - b[1].length)[0];
    if (!small) break;
    const [topic, list] = small;
    const partner = RELATED[topic];
    groups.delete(topic);
    if (partner && groups.has(partner)) {
      // "Natur & Wetter · Tiere & Pflanzen": both topics stay visible in the set name.
      const other = groups.get(partner);
      groups.delete(partner);
      const [big, little] = other.length >= list.length ? [partner, topic] : [topic, partner];
      groups.set(big.includes(' · ') ? big : `${big} · ${little}`, [...other, ...list]);
    } else {
      groups.set(MIXED, [...(groups.get(MIXED) ?? []), ...list]);
    }
    changed = true;
  }
  const out = new Map();
  for (const [name, list] of groups) {
    list.sort((a, b) => a.rank - b.rank);
    const parts = Math.ceil(list.length / max);
    const size = Math.ceil(list.length / parts);
    list.forEach((w, i) => {
      const part = Math.floor(i / size);
      out.set(w, part === 0 ? name : `${name} ${part + 1}`);
    });
  }
  return out;
}

/** Build LevelFiles + LevelIndex from enriched words ({term,rawPos,pos,…,tr (meanings),example,example_ru,example_en,topic,rank}). */
export function buildLevels(words, sources) {
  const seen = new Map();
  const files = [];
  const index = { version: 1, sources, levels: [] };
  for (const [code] of BANDS) {
    const list = words.filter((w) => levelOf(w.rank) === code).sort((a, b) => a.rank - b.rank);
    const sets = groupTopics(list);
    const out = list.map((w) => {
      const n = (seen.get(w.term) ?? 0) + 1;
      seen.set(w.term, n);
      const word = {
        id: n === 1 ? `${code}:${w.term}` : `${code}:${w.term}#${w.rawPos}`,
        term: w.term,
        pos: w.pos,
        genders: w.genders,
        plural: w.plural,
        praeteritum: w.praeteritum,
        partizip2: w.partizip2,
        auxiliary: w.auxiliary,
        // "последствие, результат; серия, эпизод": meanings by "; ", synonyms by ", ".
        tr: { ru: formatMeanings(w.tr.ru), en: formatMeanings(w.tr.en) },
        topic: sets.get(w),
        rank: w.rank,
      };
      if (w.example) {
        word.example = { de: w.example };
        if (w.example_ru) word.example.ru = w.example_ru;
        if (w.example_en) word.example.en = w.example_en;
      }
      return word;
    });
    files.push({ level: code, words: out });
    const counts = new Map();
    for (const w of out) counts.set(w.topic, (counts.get(w.topic) ?? 0) + 1);
    index.levels.push({ code, words: out.length, topics: [...counts].map(([name, count]) => ({ name, count })) });
  }
  return { files, index };
}
