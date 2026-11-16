import { describe, expect, it, vi } from 'vitest';
import type { Card, Review } from './types';

// In-memory reviews table for newlyHard (node has no IndexedDB).
const reviews = new Map<number, Review>();
vi.mock('./db/schema', () => ({
  db: { reviews: { bulkGet: async (ids: number[]) => ids.map((id) => reviews.get(id)) } },
}));

const { HARD_MISSES, PAUSE_SUGGEST_DAYS, isHard, isPaused, newlyHard, resumeSuggestions } = await import('./progress');

function review(cardId: number, mistakes: number, stability: number): Review {
  return {
    cardId,
    due: 0,
    mistakes,
    lastWrong: 0,
    fsrs: {
      due: new Date(0),
      stability,
      difficulty: 5,
      elapsed_days: 0,
      scheduled_days: 0,
      learning_steps: 0,
      reps: 3,
      lapses: 0,
      state: 2,
    },
  };
}

const card = (id: number, known = 0) => ({ id, known }) as Card;

describe('isHard', () => {
  it(`needs ${HARD_MISSES}+ misses`, () => {
    expect(isHard(card(1), review(1, HARD_MISSES - 1, 2))).toBe(false);
    expect(isHard(card(1), review(1, HARD_MISSES, 2))).toBe(true);
    expect(isHard(card(1), undefined)).toBe(false);
  });

  it('stops being hard once learned or known', () => {
    expect(isHard(card(1), review(1, 9, 30))).toBe(false);
    expect(isHard(card(1, 1), review(1, 9, 2))).toBe(false);
  });
});

describe('paused words', () => {
  const DAY = 24 * 3600 * 1000;
  const NOW = 100 * DAY;

  it('reads cards saved before pausing existed as not paused', () => {
    expect(isPaused({})).toBe(false);
    expect(isPaused({ paused: 0 })).toBe(false);
    expect(isPaused({ paused: NOW })).toBe(true);
  });

  it(`suggests bringing back words paused ${PAUSE_SUGGEST_DAYS}+ days ago`, () => {
    const cards = [
      { id: 1, paused: NOW - PAUSE_SUGGEST_DAYS * DAY },
      { id: 2, paused: NOW - PAUSE_SUGGEST_DAYS * DAY + 1 },
      { id: 3, paused: 0 },
      { id: 4 },
    ];
    expect(resumeSuggestions(cards, NOW).map((c) => c.id)).toEqual([1]);
  });

  it('a paused word is not listed as hard', () => {
    expect(isHard({ known: 0, paused: NOW }, review(1, 9, 2))).toBe(false);
  });
});

describe('newlyHard', () => {
  it('returns only cards that crossed the line during the session', async () => {
    reviews.clear();
    reviews.set(1, review(1, HARD_MISSES, 2)); // was 4 → now hard
    reviews.set(2, review(2, HARD_MISSES + 2, 2)); // was already hard
    reviews.set(3, review(3, 2, 2)); // still easy
    const before = new Map([
      [1, HARD_MISSES - 1],
      [2, HARD_MISSES + 1],
      [3, 1],
    ]);
    const result = await newlyHard([card(1), card(2), card(3)], before);
    expect(result.map((c) => c.id)).toEqual([1]);
  });
});
