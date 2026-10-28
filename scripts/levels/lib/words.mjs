// @ts-nocheck
// Stage 3: turn ranked lemma groups into level words (before translation and topics).
import { parseMeanings } from './extract.mjs';
import { articleKey, groupTranslations, tieRank } from './rank.mjs';

export const BANDS = [
  ['A1', 600],
  ['A2', 1300],
  ['B1', 2500],
  ['B2', 4000],
  ['C1', 6000],
  ['C2', 8000],
];

/** Level code for a 1-based rank. */
export function levelOf(rank) {
  for (const [code, upTo] of BANDS) if (rank <= upTo) return code;
  return null;
}

/** Base word records (no topic yet) from ranked groups. */
export function baseWords(ranked, lemmas, trOverrides = {}) {
  return ranked.map((g, i) => {
    const rec = lemmas[g.key];
    const members = g.members.map((k) => lemmas[k]);
    const pick = (f) => members.map((m) => m[f]).find((v) => v && (!Array.isArray(v) || v.length)) ?? rec[f];
    const example = members.flatMap((m) => m.examples)[0] ?? '';
    return {
      key: g.key,
      rawPos: rec.rawPos,
      term: rec.word,
      pos: rec.pos,
      genders: rec.pos === 'noun' ? pick('genders') : [],
      plural: rec.pos === 'noun' ? pick('plural') : '',
      praeteritum: rec.pos === 'verb' ? pick('praeteritum') : '',
      partizip2: rec.pos === 'verb' ? pick('partizip2') : '',
      auxiliary: rec.pos === 'verb' ? pick('auxiliary') : '',
      tr: {
        // Meanings (string[][]); hand-fixed ones are written "a, b; c" like the output.
        ru: trOverrides[g.key]?.ru ? parseMeanings(trOverrides[g.key].ru) : groupTranslations(g.members, lemmas, 'ru'),
        en: trOverrides[g.key]?.en ? parseMeanings(trOverrides[g.key].en) : groupTranslations(g.members, lemmas, 'en'),
      },
      example,
      rank: i + 1,
      count: g.count,
    };
  });
}

/**
 * Preset words for the other articles of split nouns ("die See" next to "der See"), placed by
 * their estimated count (`counts` from articleCounts) without moving any ranked word: ties are
 * allowed, so every existing rank — and so every level id — stays. Kept only with both a Russian
 * and an English translation (hand-fixed ones in `trOverrides` under "See|noun#f"), not
 * excluded and not offensive. Each word has `key` "See|noun#f", `mainKey` and `article` (gender).
 */
export function articleWords(ranked, lemmas, counts, trOverrides = {}, exclude = new Set()) {
  const sorted = ranked.map((g) => g.count);
  const out = [];
  for (const g of ranked) {
    for (const key of g.members) {
      const rec = lemmas[key];
      (counts.get(key) ?? []).forEach((c, i) => {
        const a = rec.articles[i + 1];
        const k = articleKey(key, c.gender);
        if (!c.count || exclude.has(k) || a.offensive) return;
        const tr = {
          ru: trOverrides[k]?.ru ? parseMeanings(trOverrides[k].ru) : a.tr.ru,
          en: trOverrides[k]?.en ? parseMeanings(trOverrides[k].en) : a.tr.en,
        };
        if (!tr.ru.length || !tr.en.length) return;
        const rank = tieRank(sorted, c.count);
        if (!levelOf(rank)) return;
        out.push({
          key: k,
          mainKey: key,
          article: c.gender,
          rawPos: rec.rawPos,
          term: rec.word,
          pos: rec.pos,
          genders: a.genders.slice(0, 1),
          plural: a.plural,
          praeteritum: '',
          partizip2: '',
          auxiliary: '',
          tr,
          example: a.examples[0] ?? '',
          rank,
          count: c.count,
        });
      });
    }
  }
  return out.sort((a, b) => a.rank - b.rank || (a.key < b.key ? -1 : 1));
}
