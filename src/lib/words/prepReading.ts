// A word read with one of its prepositions: "bestehen auf" (insist) is not "bestehen aus"
// (consist of). Pure: the lookup's per-meaning prepositions pick the meanings that go with it.
import { joinMeanings, splitMeanings } from '../german/meanings';
import { formatPrep, mergePrepEntry, parsePrepEntry, type PrepPart } from '../german/prepositions';
import type { LookupResult } from '../types';

/**
 * Which meanings go with this preposition (aligned with meaningPreps); null when none or all of
 * them do (nothing to choose) or there is no per-meaning information.
 */
export function picksForPrep(meaningPreps: string[][] | undefined, word: string): boolean[] | null {
  if (!meaningPreps?.length) return null;
  const picks = meaningPreps.map((l) => l.some((e) => parsePrepEntry(e)?.word === word));
  if (!picks.some(Boolean) || picks.every(Boolean)) return null;
  return picks;
}

/**
 * The lookup as the word with this preposition: only the meanings that go with it (and their
 * examples), and the preposition with its case as `preps` (the lookup's case when it has one).
 */
export function narrowToPrep(r: LookupResult, p: PrepPart): LookupResult {
  const known = (r.preps ?? '')
    .split(';')
    .map(parsePrepEntry)
    .find((e) => e?.word === p.word);
  const part: PrepPart = p.case ? p : known?.case ? { word: p.word, case: known.case } : p;
  const preps = r.preps ? mergePrepEntry(r.preps, part) : formatPrep(part);
  const meanings = splitMeanings(r.translation);
  const picks = picksForPrep(r.meaningPreps, p.word);
  if (!picks || picks.length !== meanings.length) return { ...r, preps };
  const keep = <T>(list: T[]) => list.filter((_, i) => picks[i]);
  const out: LookupResult = { ...r, translation: joinMeanings(keep(meanings)), preps, meaningPreps: keep(r.meaningPreps!) };
  if (r.meaningExamples && r.meaningExamples.length === meanings.length) {
    out.meaningExamples = keep(r.meaningExamples);
    const first = out.meaningExamples.find((l) => l.length);
    if (first) out.examples = first.slice(0, Math.max(1, r.examples.length));
  }
  return out;
}

/**
 * Prepositions the dictionary's meanings tie a meaning to, next to a meaning without any: the
 * word means something else with them, so they are part of the word (see prepositions.ts).
 */
export function joiningByMeaning(meaningPreps: string[][] | undefined): string[] {
  if (!meaningPreps?.some((l) => !l.length)) return [];
  const out = new Set<string>();
  for (const l of meaningPreps) {
    const words = new Set(l.map((e) => parsePrepEntry(e)?.word).filter((w): w is string => !!w));
    if (words.size === 1) out.add([...words][0]);
  }
  return [...out];
}
