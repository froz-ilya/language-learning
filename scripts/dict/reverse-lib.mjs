// @ts-check
// Reverse dictionary (Russian / English → German), shared by scripts/dict/reverse.mjs and its
// test. The runtime twin is src/lib/dict/reverse.ts: revNormalize and revKey must stay identical
// (src/lib/dict/reverse.test.ts checks this).

/** Lower-case, ё→е, accents (stress marks) removed. */
export function revNormalize(text) {
  return text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/ё/g, 'е').normalize('NFC');
}

/** Words of a translation ("мобильный телефон, сотовый" → мобильный, телефон, сотовый). */
export function revTokens(text) {
  return revNormalize(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** Shard of a token: its first two letters (one for a one-letter word). */
export const revKey = (token) => token.slice(0, 2);

/** Words that don't identify a meaning ("to go", "something", "кого-либо"). */
export const STOP = new Set([
  'to', 'a', 'an', 'the', 'of', 'or', 'and', 'be', 'one', "one's", 'oneself', 'someone', 'somebody',
  'something', 'sb', 'sth', 'smb', 'smth', 'with', 'for', 'in', 'on', 'at', 'by',
  'и', 'или', 'кого', 'кому', 'чего', 'чему', 'что', 'то', 'либо', 'нибудь', 'себя', 'себе', 'в', 'на', 'с', 'к', 'о', 'по', 'за', 'для',
]);

/**
 * Shards for one language from decoded dictionary entries [{ id, rank, tags, tr }]:
 * Map key → { w: { token: ids (most frequent first) }, e: { id: [rank, tags, tr] } }.
 */
export function buildShards(entries) {
  const shards = new Map();
  for (const e of [...entries].sort((a, b) => a.rank - b.rank)) {
    if (!e.tr) continue;
    const seen = new Set();
    for (const t of revTokens(e.tr)) {
      if (STOP.has(t) || seen.has(t)) continue;
      seen.add(t);
      const key = revKey(t);
      let s = shards.get(key);
      if (!s) shards.set(key, (s = { w: {}, e: {} }));
      (s.w[t] ??= []).push(e.id);
      s.e[e.id] = [e.rank, e.tags, e.tr];
    }
  }
  return shards;
}
