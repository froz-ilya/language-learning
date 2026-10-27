/**
 * Translation strings group synonyms by meaning: meanings are separated by ";", synonyms within
 * a meaning by ",". E.g. Folge → "последствие, результат; серия, эпизод; ряд".
 * Answer checking (answer.ts) accepts any synonym of any meaning.
 */

export const MEANING_SEP = '; ';

/** "последствие, результат; серия" → [["последствие", "результат"], ["серия"]] */
export function splitMeanings(translation: string): string[][] {
  return translation
    .split(';')
    .map((m) =>
      m
        .split(',')
        .map((w) => w.trim())
        .filter(Boolean),
    )
    .filter((m) => m.length > 0);
}

/** [["последствие", "результат"], ["серия"]] → "последствие, результат; серия" */
export function joinMeanings(meanings: string[][]): string {
  return meanings
    .map((m) => m.filter(Boolean).join(', '))
    .filter(Boolean)
    .join(MEANING_SEP);
}
