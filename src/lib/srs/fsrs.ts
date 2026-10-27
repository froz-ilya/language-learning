import { createEmptyCard, fsrs, Rating, type Card as FsrsCard, type Grade } from 'ts-fsrs';
import { db } from '../db/schema';
import type { Verdict } from '../german/answer';
import type { Review } from '../types';

export { Rating, type Grade };

/** One shared scheduler; fuzz spreads reviews of words learned together over nearby days. */
export const scheduler = fsrs({ enable_fuzz: true });

/** Non-flashcard modes: correct → Good, typo → Hard, wrong → Again. */
export function gradeForVerdict(verdict: Verdict): Grade {
  if (verdict === 'correct') return Rating.Good;
  if (verdict === 'typo') return Rating.Hard;
  return Rating.Again;
}

/** Right/wrong-only modes (choice, articles, verbs). */
export function gradeForResult(correct: boolean): Grade {
  return correct ? Rating.Good : Rating.Again;
}

/** Pure: the Review a card gets after answering with `grade` at `now`. */
export function applyGrade(prev: Review | undefined, cardId: number, grade: Grade, now = new Date()): Review {
  const base: FsrsCard = prev?.fsrs ?? createEmptyCard(now);
  const { card } = scheduler.next(base, now, grade);
  const wrong = grade === Rating.Again;
  return {
    cardId,
    due: card.due.getTime(),
    fsrs: card,
    mistakes: (prev?.mistakes ?? 0) + (wrong ? 1 : 0),
    lastWrong: wrong ? now.getTime() : (prev?.lastWrong ?? 0),
  };
}

/** Schedule the card's next review and persist it. */
export function recordAnswer(cardId: number, grade: Grade, now = new Date()): Promise<Review> {
  return db.transaction('rw', db.reviews, async () => {
    const next = applyGrade(await db.reviews.get(cardId), cardId, grade, now);
    await db.reviews.put(next);
    return next;
  });
}

/**
 * Count a mistake without touching the schedule (match mode). A never-reviewed card gets a
 * fresh FSRS state that is due immediately, so it also shows up under "Mistakes".
 */
export function recordMistake(cardId: number, now = new Date()): Promise<void> {
  return db.transaction('rw', db.reviews, async () => {
    const prev = await db.reviews.get(cardId);
    if (prev) {
      await db.reviews.put({ ...prev, mistakes: prev.mistakes + 1, lastWrong: now.getTime() });
    } else {
      const fresh = createEmptyCard(now);
      await db.reviews.put({ cardId, due: fresh.due.getTime(), fsrs: fresh, mistakes: 1, lastWrong: now.getTime() });
    }
  });
}

/** Forget all progress: the cards become "new" again. */
export function resetProgress(cardIds: number[]): Promise<void> {
  return db.reviews.bulkDelete(cardIds);
}
