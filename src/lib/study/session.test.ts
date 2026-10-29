import { describe, expect, it } from 'vitest';
import type { Card, Review } from '../types';
import {
  endOfDay,
  filterByScope,
  isDueOrNew,
  isStudyMode,
  modeApplies,
  modeAvailability,
  resolveDirection,
  Session,
  shuffle,
  STUDY_MODES,
} from './session';
import { choiceOptions, matchRounds } from './quiz';

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
    createdAt: 0,
    ...extra,
  };
}

function review(cardId: number, due: number): Review {
  return { cardId, due, fsrs: {} as Review['fsrs'], mistakes: 0, lastWrong: 0 };
}

/** Deterministic PRNG. */
function seeded(seed = 1) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

const cards = (n: number) => Array.from({ length: n }, (_, i) => card(i + 1));
const ids = (s: Session) => {
  // Drain helper: answer everything right and record order.
  const out: number[] = [];
  while (!s.finished) {
    out.push(s.current!.card.id!);
    s.answer(true);
  }
  return out;
};

describe('shuffle', () => {
  it('keeps all items and does not mutate', () => {
    const a = [1, 2, 3, 4, 5];
    const b = shuffle(a, seeded(3));
    expect(a).toEqual([1, 2, 3, 4, 5]);
    expect([...b].sort()).toEqual(a);
  });
});

describe('scope', () => {
  const now = new Date(2026, 9, 27, 10, 0).getTime();
  const list = cards(4);
  const reviews = new Map<number, Review>([
    [1, review(1, now - 86400000)], // overdue
    [2, review(2, now + 3600000)], // later today
    [3, review(3, now + 3 * 86400000)], // in 3 days
    // 4: never reviewed
  ]);

  it('due = due by end of today or never reviewed', () => {
    expect(filterByScope(list, reviews, 'due', now).map((c) => c.id)).toEqual([1, 2, 4]);
  });
  it('all = everything', () => {
    expect(filterByScope(list, reviews, 'all', now)).toHaveLength(4);
  });
  it('end of day boundary', () => {
    expect(isDueOrNew(review(1, endOfDay(now)), now)).toBe(true);
    expect(isDueOrNew(review(1, endOfDay(now) + 1), now)).toBe(false);
    expect(isDueOrNew(undefined, now)).toBe(true);
  });
});

describe('mode applicability', () => {
  const noun = card(1, { pos: 'noun', genders: ['m'] });
  const verb = card(2, { pos: 'verb', praeteritum: 'ging' });
  const bareVerb = card(3, { pos: 'verb' });
  const noTr = card(4, { translation: '' });

  it('articles need gendered nouns, verbs need forms', () => {
    expect(modeApplies('articles', noun)).toBe(true);
    expect(modeApplies('articles', verb)).toBe(false);
    expect(modeApplies('verbs', verb)).toBe(true);
    expect(modeApplies('verbs', bareVerb)).toBe(false);
  });
  it('listen works without a translation, write does not', () => {
    expect(modeApplies('listen', noTr)).toBe(true);
    expect(modeApplies('write', noTr)).toBe(false);
  });
  it('availability reasons', () => {
    expect(modeAvailability('match', [noun]).reason).toBeTruthy();
    expect(modeAvailability('match', [noun, verb]).reason).toBeUndefined();
    expect(modeAvailability('choice', [noun], 1).reason).toBeTruthy();
    expect(modeAvailability('choice', [noun], 5).reason).toBeUndefined();
    expect(modeAvailability('articles', [verb]).reason).toBeTruthy();
    expect(modeAvailability('verbs', [noun, verb, bareVerb])).toEqual({ count: 1 });
    expect(modeAvailability('flashcards', []).reason).toBe('Nothing to study');
  });
});

describe('direction', () => {
  it('fixed directions pass through', () => {
    expect(resolveDirection('de-x')).toBe('de-x');
    expect(resolveDirection('x-de')).toBe('x-de');
  });
  it('mixed picks per card', () => {
    expect(resolveDirection('mixed', () => 0.1)).toBe('de-x');
    expect(resolveDirection('mixed', () => 0.9)).toBe('x-de');
    const s = new Session(cards(40), { direction: 'mixed', rng: seeded(7) });
    const dirs = new Set<string>();
    while (!s.finished) {
      dirs.add(s.current!.dir);
      s.answer(true);
    }
    expect(dirs).toEqual(new Set(['de-x', 'x-de']));
  });
  it('session uses the given direction for every card', () => {
    const s = new Session(cards(5), { direction: 'x-de' });
    while (!s.finished) {
      expect(s.current!.dir).toBe('x-de');
      s.answer(true);
    }
  });
});

describe('Session queue', () => {
  it('shuffles but contains every card once', () => {
    const s = new Session(cards(10), { rng: seeded(5) });
    const order = ids(s);
    expect([...order].sort((a, b) => a - b)).toEqual(cards(10).map((c) => c.id));
    expect(s.firstTryCorrect).toBe(10);
    expect(s.missed).toEqual([]);
  });

  it('re-inserts a wrong card 3 positions later', () => {
    const s = new Session(cards(6), { shuffle: false });
    expect(s.current!.card.id).toBe(1);
    s.answer(false); // card 1 wrong
    const order: number[] = [];
    while (!s.finished) {
      order.push(s.current!.card.id!);
      s.answer(true);
    }
    expect(order).toEqual([2, 3, 4, 1, 5, 6]);
    expect(s.total).toBe(6);
    expect(s.doneCount).toBe(6);
  });

  it('re-inserts at the end when the queue is short', () => {
    const s = new Session(cards(2), { shuffle: false });
    s.answer(true); // 1
    s.answer(false); // 2 wrong → comes right back
    expect(s.current!.card.id).toBe(2);
    expect(s.finished).toBe(false);
    s.answer(true);
    expect(s.finished).toBe(true);
  });

  it('keeps asking until answered right', () => {
    const s = new Session(cards(1), { shuffle: false });
    expect(s.answer(false).first).toBe(true);
    expect(s.answer(false).first).toBe(false);
    expect(s.doneCount).toBe(0);
    expect(s.answer(true).first).toBe(false);
    expect(s.finished).toBe(true);
    expect(s.doneCount).toBe(1);
  });

  it('records only the first answer per card', () => {
    const s = new Session(cards(3), { shuffle: false });
    const firsts: [number, boolean][] = [];
    while (!s.finished) {
      const id = s.current!.card.id!;
      const correct = !(id === 2 && s.firstResult(s.current!.card) === undefined); // card 2 wrong once
      firsts.push([id, s.answer(correct).first]);
    }
    expect(firsts).toEqual([
      [1, true],
      [2, true],
      [3, true],
      [2, false],
    ]);
    expect(s.firstTryCorrect).toBe(2);
    expect(s.missed.map((c) => c.id)).toEqual([2]);
    expect(s.firstResult(s.cards[1])).toBe(false);
  });

  it('gives re-queued items a new seq and keeps their direction', () => {
    const s = new Session(cards(1), { direction: 'mixed', rng: () => 0.9, shuffle: false });
    const a = s.current!;
    s.answer(false);
    const b = s.current!;
    expect(b.card).toBe(a.card);
    expect(b.dir).toBe(a.dir);
    expect(b.seq).not.toBe(a.seq);
  });

  it('throws when answering after the end', () => {
    const s = new Session([], {});
    expect(s.finished).toBe(true);
    expect(() => s.answer(true)).toThrow();
  });
});

describe('choiceOptions', () => {
  const nouns = [1, 2, 3, 4, 5].map((i) => card(i, { pos: 'noun', genders: ['m'] }));
  const verbs = [6, 7, 8].map((i) => card(i, { pos: 'verb' }));

  it('returns 4 unique options including the answer, same POS first', () => {
    const opts = choiceOptions(nouns[0], [...nouns, ...verbs], (c) => c.translation, 4, seeded(2));
    expect(opts).toHaveLength(4);
    expect(opts).toContain(nouns[0]);
    expect(new Set(opts.map((c) => c.translation)).size).toBe(4);
    expect(opts.every((c) => c.pos === 'noun')).toBe(true);
  });
  it('falls back to other POS and to fewer options', () => {
    const opts = choiceOptions(verbs[0], [verbs[0], nouns[0]], (c) => c.translation);
    expect(opts).toHaveLength(2);
  });
  it('skips duplicate answer texts', () => {
    const dup = card(9, { translation: 'WORD1' });
    const opts = choiceOptions(nouns[0], [nouns[0], dup], (c) => c.translation);
    expect(opts).toEqual([nouns[0]]);
  });
});

describe('matchRounds', () => {
  it('splits into rounds of 6 and merges a lone last card', () => {
    expect(matchRounds(cards(12)).map((r) => r.length)).toEqual([6, 6]);
    expect(matchRounds(cards(13)).map((r) => r.length)).toEqual([6, 7]);
    expect(matchRounds(cards(9)).map((r) => r.length)).toEqual([6, 3]);
    expect(matchRounds(cards(2)).map((r) => r.length)).toEqual([2]);
  });
});

describe('isStudyMode', () => {
  it('accepts every mode and rejects unknown saved values', () => {
    for (const m of STUDY_MODES) expect(isStudyMode(m)).toBe(true);
    expect(isStudyMode('pronouns')).toBe(true);
    expect(isStudyMode('dictation')).toBe(false);
    expect(isStudyMode(undefined)).toBe(false);
    expect(isStudyMode('')).toBe(false);
  });
});
