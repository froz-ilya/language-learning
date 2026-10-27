import type { Gender } from '../../types';
import type { LexEntry, LocalHit } from '../../dict/types';
import { lookupLocal, prefixLocal } from '../../dict/local';
import type { Provider } from '../chain';

export interface LocalQuery {
  /** Word without article. */
  term: string;
  /** Gender hint from a typed article ("die See"), used to pick among homographs. */
  genders?: Gender[];
}

/** Offline dictionary entry for a word (lemma or inflected form). */
export const localWord: Provider<LocalQuery, LocalHit> = {
  id: 'local',
  timeoutMs: 10_000,
  async run({ term, genders }) {
    const hits = await lookupLocal(term);
    if (!hits.length) return null;
    if (genders?.length) {
      const match = hits.find((h) => h.entry.genders.some((g) => genders.includes(g)));
      if (match) return match;
    }
    return hits[0];
  },
};

/** Offline prefix search, most frequent first. */
export const localPrefix: Provider<{ prefix: string; limit: number }, LexEntry[]> = {
  id: 'local',
  timeoutMs: 10_000,
  async run({ prefix, limit }) {
    const entries = await prefixLocal(prefix, limit);
    return entries.length ? entries : null;
  },
};
