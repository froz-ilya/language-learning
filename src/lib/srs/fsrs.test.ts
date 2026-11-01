import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Review } from '../types';

// Node has no IndexedDB: replace the Dexie db with an in-memory reviews table.
const store = new Map<number, Review>();
vi.mock('../db/schema', () => ({
  db: {
    reviews: {
      get: async (id: number) => store.get(id),
      put: async (r: Review) => {
        store.set(r.cardId, r);
        return r.cardId;
      },
      bulkDelete: async (ids: number[]) => {
        ids.forEach((id) => store.delete(id));
      },
    },
    transaction: async (_mode: string, _table: unknown, fn: () => Promise<unknown>) => fn(),
  },
}));

const { applyGrade, gradeForResult, gradeForVerdict, Rating, recordAnswer, recordMistake, resetProgress } =
  await import('./fsrs');

const now = new Date(2026, 9, 27, 10, 0);
const DAY = 86400000;

beforeEach(() => store.clear());

describe('grade mapping', () => {
  it('maps verdicts', () => {
    expect(gradeForVerdict('correct')).toBe(Rating.Good);
    expect(gradeForVerdict('typo')).toBe(Rating.Hard);
    expect(gradeForVerdict('wrong')).toBe(Rating.Again);
  });
  it('maps right/wrong', () => {
    expect(gradeForResult(true)).toBe(Rating.Good);
    expect(gradeForResult(false)).toBe(Rating.Again);
  });
});

describe('applyGrade', () => {
  it('Again on a new card counts a mistake', () => {
    const r = applyGrade(undefined, 5, Rating.Again, now);
    expect(r.cardId).toBe(5);
    expect(r.mistakes).toBe(1);
    expect(r.lastWrong).toBe(now.getTime());
    expect(r.due).toBe(r.fsrs.due.getTime());
    expect(r.fsrs.due).toBeInstanceOf(Date);
    expect(r.due).toBeGreaterThanOrEqual(now.getTime());
  });
  it('Good keeps mistakes and lastWrong', () => {
    const prev = applyGrade(undefined, 5, Rating.Again, now);
    const later = new Date(now.getTime() + 600000);
    const r = applyGrade(prev, 5, Rating.Good, later);
    expect(r.mistakes).toBe(1);
    expect(r.lastWrong).toBe(now.getTime());
    expect(r.fsrs.reps).toBe(2);
  });
  it('Easy schedules further out than Again', () => {
    const easy = applyGrade(undefined, 1, Rating.Easy, now);
    const again = applyGrade(undefined, 1, Rating.Again, now);
    expect(easy.due).toBeGreaterThan(again.due);
    expect(easy.due - now.getTime()).toBeGreaterThanOrEqual(DAY);
    expect(easy.lastWrong).toBe(0);
  });
  it('remembers when a word was first studied', () => {
    const first = applyGrade(undefined, 5, Rating.Good, now);
    expect(first.firstAt).toBe(now.getTime());
    const later = applyGrade(first, 5, Rating.Good, new Date(now.getTime() + DAY));
    expect(later.firstAt).toBe(now.getTime());
  });
  it('a word studied before firstAt existed does not look new today', () => {
    const { firstAt: _, ...old } = applyGrade(undefined, 5, Rating.Good, now);
    expect(applyGrade(old, 5, Rating.Good, new Date(now.getTime() + DAY)).firstAt).toBeUndefined();
  });
  it('a match-mode mistake on a new word is not its first study', async () => {
    await recordMistake(6, now);
    expect(store.get(6)?.firstAt).toBeUndefined();
    const t = new Date(now.getTime() + 1000);
    expect((await recordAnswer(6, Rating.Good, t)).firstAt).toBe(t.getTime());
  });
});

describe('persistence', () => {
  it('recordAnswer writes and builds on the stored review', async () => {
    await recordAnswer(3, Rating.Good, now);
    expect(store.get(3)?.fsrs.reps).toBe(1);
    await recordAnswer(3, Rating.Again, new Date(now.getTime() + DAY));
    expect(store.get(3)?.fsrs.reps).toBe(2);
    expect(store.get(3)?.mistakes).toBe(1);
  });
  it('recordMistake only touches mistakes/lastWrong', async () => {
    await recordAnswer(4, Rating.Good, now);
    const before = store.get(4)!;
    const t = new Date(now.getTime() + 1000);
    await recordMistake(4, t);
    const after = store.get(4)!;
    expect(after.mistakes).toBe(1);
    expect(after.lastWrong).toBe(t.getTime());
    expect(after.due).toBe(before.due);
    await recordMistake(9, t);
    expect(store.get(9)?.mistakes).toBe(1);
  });
  it('resetProgress deletes reviews', async () => {
    await recordAnswer(1, Rating.Good, now);
    await recordAnswer(2, Rating.Good, now);
    await resetProgress([1]);
    expect([...store.keys()]).toEqual([2]);
  });
});
