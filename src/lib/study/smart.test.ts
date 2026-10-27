import { describe, expect, it } from 'vitest';
import type { Card, Review } from '../types';
import { placementPassed, placementSample, spreadSample } from './placement';
import { cardState, chooseMode, planSmartQueue, SmartSession, sourceOrder, type ModeContext } from './smart';

const DAY = 24 * 3600 * 1000;
const NOW = new Date(2026, 9, 27, 12, 0, 0).getTime();

function card(id: number, extra: Partial<Card> = {}): Card {
  return {
    id,
    setId: 1,
    term: `Wort${id}`,
    translation: `word${id}`,
    pos: 'other',
    genders: [],
    plural: '',
    praeteritum: '',
    partizip2: '',
    auxiliary: '',
    examples: [],
    notes: '',
    starred: 0,
    needsFill: 0,
    known: 0,
    presetId: '',
    createdAt: id,
    ...extra,
  };
}

function review(cardId: number, due: number, stability = 3, reps = 2): Review {
  return { cardId, due, fsrs: { stability, reps } as Review['fsrs'], mistakes: 0, lastWrong: 0 };
}

/** RNG returning the given values in turn (then repeating the last one). */
function seq(...values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

function ctx(values: number[], extra: Partial<ModeContext> = {}): ModeContext {
  let w = 0;
  return {
    rng: seq(...values),
    canChoice: true,
    canListen: true,
    nextWriteDir: () => (w++ % 2 === 0 ? 'de-x' : 'x-de'),
    ...extra,
  };
}

const noun = (id: number) => card(id, { pos: 'noun', genders: ['m'] });
const verb = (id: number) => card(id, { pos: 'verb', praeteritum: 'ging', partizip2: 'gegangen', auxiliary: 'sein' });

describe('cardState', () => {
  it('classifies by reps and stability', () => {
    expect(cardState(undefined)).toBe('new');
    expect(cardState(review(1, NOW, 0, 0))).toBe('new');
    expect(cardState(review(1, NOW, 3))).toBe('learning');
    expect(cardState(review(1, NOW, 7))).toBe('review');
  });
});

describe('planSmartQueue', () => {
  it('puts due cards first (most overdue first), then new cards in source order', () => {
    const cards = [card(1), card(2), card(3), card(4, { createdAt: 0 }), card(5)];
    const reviews = new Map([
      [1, review(1, NOW - DAY)],
      [2, review(2, NOW - 5 * DAY)],
      [3, review(3, NOW + 3 * DAY)], // not due
    ]);
    const plan = planSmartQueue(cards, reviews, { newPerSession: 10, now: NOW });
    expect(plan.due.map((c) => c.id)).toEqual([2, 1]);
    expect(plan.fresh.map((c) => c.id)).toEqual([4, 5]);
  });

  it('counts cards due later today as due', () => {
    const reviews = new Map([[1, review(1, NOW + 3600 * 1000)]]);
    expect(planSmartQueue([card(1)], reviews, { newPerSession: 0, now: NOW }).due).toHaveLength(1);
  });

  it('caps due cards at 30 and new cards at newPerSession', () => {
    const cards = Array.from({ length: 50 }, (_, i) => card(i + 1));
    const reviews = new Map(cards.slice(0, 40).map((c) => [c.id!, review(c.id!, NOW - c.id! * 1000)] as const));
    const plan = planSmartQueue(cards, reviews, { newPerSession: 4, now: NOW });
    expect(plan.due).toHaveLength(30);
    expect(plan.due[0].id).toBe(40); // most overdue
    expect(plan.moreDue).toBe(10);
    expect(plan.fresh.map((c) => c.id)).toEqual([41, 42, 43, 44]);
    expect(plan.moreNew).toBe(6);
  });

  it('excludes known cards and duplicates', () => {
    const cards = [card(1, { known: 1 }), card(2), card(2), card(3, { known: 1 })];
    const reviews = new Map([[3, review(3, NOW - DAY)]]);
    const plan = planSmartQueue(cards, reviews, { newPerSession: 10, now: NOW });
    expect(plan.due).toEqual([]);
    expect(plan.fresh.map((c) => c.id)).toEqual([2]);
  });

  it('orders level words by id (frequency order)', () => {
    const a = card(5, { presetId: 'A1:a', createdAt: 1 });
    const b = card(2, { presetId: 'A1:b', createdAt: 9 });
    expect([a, b].sort(sourceOrder).map((c) => c.id)).toEqual([2, 5]);
  });
});

describe('chooseMode', () => {
  it('new cards get an intro', () => {
    expect(chooseMode(card(1), undefined, ctx([0])).mode).toBe('intro');
  });

  it('learning cards: choice or write, translation → German', () => {
    expect(chooseMode(card(1), review(1, NOW), ctx([0.2]))).toEqual({ mode: 'choice', dir: 'x-de' });
    expect(chooseMode(card(1), review(1, NOW), ctx([0.7]))).toEqual({ mode: 'write', dir: 'x-de' });
  });

  it('review cards: write with alternating direction, or listen', () => {
    const c = ctx([0.9]);
    const r = review(1, NOW, 30);
    expect(chooseMode(card(1), r, c)).toEqual({ mode: 'write', dir: 'de-x' });
    expect(chooseMode(card(1), r, c)).toEqual({ mode: 'write', dir: 'x-de' });
    expect(chooseMode(card(1), r, ctx([0.1])).mode).toBe('listen');
    expect(chooseMode(card(1), r, ctx([0.1], { canListen: false })).mode).toBe('write');
  });

  it('nouns with a gender: 1 in 3 articles', () => {
    expect(chooseMode(noun(1), review(1, NOW), ctx([0.1])).mode).toBe('articles');
    expect(chooseMode(noun(1), review(1, NOW), ctx([0.5, 0.2])).mode).toBe('choice');
    // A noun without gender never gets articles.
    expect(chooseMode(card(1, { pos: 'noun' }), review(1, NOW), ctx([0.1])).mode).toBe('choice');
  });

  it('verbs with forms: 1 in 3 verbs', () => {
    expect(chooseMode(verb(1), review(1, NOW, 30), ctx([0.1])).mode).toBe('verbs');
    expect(chooseMode(verb(1), review(1, NOW, 30), ctx([0.5, 0.9])).mode).toBe('write');
  });

  it('only picks applicable modes', () => {
    const noTranslation = card(1, { translation: '' });
    expect(chooseMode(noTranslation, review(1, NOW), ctx([0.2])).mode).toBe('listen');
    expect(chooseMode(card(1), review(1, NOW), ctx([0.2], { canChoice: false })).mode).toBe('write');
  });
});

describe('SmartSession', () => {
  it('intro is not graded and the card comes back later as multiple choice', () => {
    const cards = [card(1), card(2), card(3), card(4), card(5)];
    const s = new SmartSession(cards, new Map(), { newPerSession: 10, now: NOW, rng: seq(0.5), introGap: 2 });
    expect(s.current?.mode).toBe('intro');
    expect(s.current?.card.id).toBe(1);
    expect(() => s.answer(true)).toThrow();
    s.seen();
    expect(s.progress).toBeCloseTo(0.1);
    expect(s.current?.card.id).toBe(2);
    const seenOrder: [number, string][] = [];
    while (!s.finished) {
      const it = s.current!;
      seenOrder.push([it.card.id!, it.mode]);
      if (it.mode === 'intro') s.seen();
      else expect(s.answer(true).first).toBe(true);
    }
    // Every card got exactly one choice question after its intro.
    for (const id of [1, 2, 3, 4, 5]) {
      expect(seenOrder.filter(([cid, m]) => cid === id && m === 'choice')).toHaveLength(1);
    }
    expect(s.firstTryCorrect).toBe(5);
    expect(s.progress).toBe(1);
  });

  it('places the follow-up introGap items after the intro', () => {
    const cards = [card(1), card(2), card(3), card(4), card(5)];
    const s = new SmartSession(cards, new Map(), { newPerSession: 10, now: NOW, introGap: 2 });
    s.seen(); // intro 1
    const order: string[] = [];
    while (!s.finished) {
      const it = s.current!;
      order.push(`${it.mode}${it.card.id}`);
      if (it.mode === 'intro') s.seen();
      else s.answer(true);
    }
    expect(order.slice(0, 3)).toEqual(['intro2', 'intro3', 'choice1']);
  });

  it('records SRS only on the first graded answer; wrong answers re-queue', () => {
    const r = new Map([[1, review(1, NOW - DAY, 30)]]);
    const s = new SmartSession([card(1), card(2, { createdAt: 0 })], r, {
      newPerSession: 0,
      now: NOW,
      rng: seq(0.9),
      requeueGap: 3,
    });
    expect(s.total).toBe(1);
    expect(s.current?.mode).toBe('write');
    expect(s.answer(false).first).toBe(true);
    expect(s.finished).toBe(false); // re-queued at the end
    expect(s.current?.card.id).toBe(1);
    expect(s.answer(true).first).toBe(false);
    expect(s.finished).toBe(true);
    expect(s.firstTryCorrect).toBe(0);
    expect(s.missed.map((c) => c.id)).toEqual([1]);
    expect(s.doneCount).toBe(1);
  });

  it('asks due cards before new ones and respects newPerSession', () => {
    const cards = [card(1), card(2), card(3), card(4)];
    const r = new Map([[4, review(4, NOW - DAY)]]);
    const s = new SmartSession(cards, r, { newPerSession: 2, now: NOW, rng: seq(0.9) });
    expect(s.cards.map((c) => c.id)).toEqual([4, 1, 2]);
    expect(s.current?.card.id).toBe(4);
    expect(s.current?.mode).not.toBe('intro');
  });

  it('is empty when nothing is due and there are no new words', () => {
    const r = new Map([[1, review(1, NOW + 5 * DAY)]]);
    const s = new SmartSession([card(1), card(2, { known: 1 })], r, { newPerSession: 10, now: NOW });
    expect(s.empty).toBe(true);
    expect(s.finished).toBe(true);
  });
});

describe('placement', () => {
  it('spreads the sample over the whole frequency range', () => {
    const items = Array.from({ length: 1000 }, (_, i) => i);
    const sample = spreadSample(items, 20, () => 0);
    expect(sample).toHaveLength(20);
    expect(sample[0]).toBe(0);
    expect(sample[19]).toBe(950);
    expect(spreadSample(items, 20, () => 0.999)[19]).toBe(999);
    expect(spreadSample([1, 2, 3], 20)).toEqual([1, 2, 3]);
  });

  it('samples level cards in frequency (id) order and skips untranslated ones', () => {
    const cards = Array.from({ length: 40 }, (_, i) => card(40 - i, { presetId: `A1:${i}`, translation: i === 0 ? '' : 'x' }));
    const sample = placementSample(cards, 4, () => 0);
    expect(sample.map((c) => c.id)).toEqual([1, 10, 20, 30]);
  });

  it('passes at 85%', () => {
    expect(placementPassed(17, 20)).toBe(true);
    expect(placementPassed(16, 20)).toBe(false);
    expect(placementPassed(0, 0)).toBe(false);
  });
});
