// @ts-nocheck
// Stage 3: turn ranked lemma groups into level words (before translation and topics).
import { parseMeanings } from './extract.mjs';
import { groupTranslations } from './rank.mjs';

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
