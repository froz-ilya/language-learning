/**
 * Reflexive verbs ("sich treffen", "sich beeilen"): a card's term carries "sich " in front of the
 * verb (the convention highlight.ts already follows); level presets keep the bare verb.
 */
import type { LexEntry } from '../dict/types';

/** Reflexive pronouns and the case(s) they stand in ("uns" is both). */
export const REFLEXIVE_PRONOUNS: Record<string, 'akk' | 'dat' | 'both'> = {
  mich: 'akk',
  dich: 'akk',
  mir: 'dat',
  dir: 'dat',
  sich: 'both',
  uns: 'both',
  euch: 'both',
};

const SICH = /^sich\s+(?=\S)/i;

/** "sich treffen" → true. */
export const isReflexiveTerm = (term: string): boolean => SICH.test(term.trim());

/** "sich treffen" → "treffen"; other terms unchanged. */
export const baseOfReflexive = (term: string): string => term.trim().replace(SICH, '');

/** "treffen" → "sich treffen" (unchanged when it has "sich" already). */
export const withSich = (term: string): string => (isReflexiveTerm(term) ? term.trim() : `sich ${term.trim()}`);

/**
 * The entry read as its reflexive verb: term "sich treffen" and the reflexive meanings'
 * translations. A reflexive-only verb's own translations are its reflexive ones, and so is an
 * empty `trRefl` language (the build stores '' when it equals `tr`). A verb that is also used
 * without "sich" but has no `trRefl` gets no translation: its own ones mean the other verb
 * (treffen "встретить" ≠ sich treffen "встречаться"), so callers ask an online source instead.
 */
export function asReflexive(e: LexEntry): LexEntry {
  const unknown = e.reflexive === 'also' && !e.trRefl;
  const tr = unknown ? { ru: '', en: '' } : { ru: e.trRefl?.ru || e.tr.ru, en: e.trRefl?.en || e.tr.en };
  return { ...e, term: withSich(e.term), tr };
}
