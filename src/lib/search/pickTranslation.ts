// The translation a word gets when it was found by a Russian or English word (the add field
// takes all three): the word the user typed is what they mean, so it comes first.
import { revNormalize } from '../dict/reverse';
import type { Lang } from '../types';

export interface PickedTranslation {
  /** The meanings to offer as chips (the dictionary's, maybe with the typed word in front). */
  meanings: string[][];
  /** Which of them are selected (aligned with `meanings`). */
  picked: boolean[];
  /** The typed word was added in front as a meaning of its own (not in the dictionary's). */
  prepended: boolean;
}

const norm = (s: string) => revNormalize(s).trim().replace(/\s+/g, ' ');

/**
 * `meanings`: the looked-up translation split into meanings (splitMeanings). `typed`: the word
 * the German word was found by, in `typedLang`. Only when that's the language words are
 * translated into (`settingsLang`) does it shape the translation: the meaning holding it is the
 * only one selected, or it becomes a meaning of its own in front when the dictionary lacks it.
 * Otherwise (an English word while translating into Russian) it says nothing: null.
 */
export function translationForPick(
  meanings: string[][],
  typed: string,
  typedLang: Lang,
  settingsLang: Lang,
): PickedTranslation | null {
  const word = norm(typed);
  if (typedLang !== settingsLang || !word) return null;
  const hit = meanings.findIndex((m) => m.some((syn) => norm(syn) === word));
  if (hit >= 0) return { meanings, picked: meanings.map((_, i) => i === hit), prepended: false };
  return {
    meanings: [[typed.trim()], ...meanings],
    picked: [true, ...meanings.map(() => false)],
    prepended: true,
  };
}
