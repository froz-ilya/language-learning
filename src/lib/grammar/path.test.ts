import { describe, expect, it } from 'vitest';
import {
  anywaySession,
  currentStage,
  DONE_RATIO,
  reviewSession,
  STAGE_SESSION,
  stageExercises,
  stageSession,
  stageStats,
  WORD_SESSION,
  wordExercises,
  wordSession,
  wordStats,
} from './path';
import type { BuildExercise, GrammarExercise, GrammarProgress, GrammarStage, PickExercise, RuleText } from './types';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_000 * DAY;
const tr = { ru: 'перевод', en: 'translation' };
const contrast: RuleText = { ru: 'контраст', en: 'contrast', de: 'Kontrast' };

function build(connector: string, id: string, level: 1 | 2 = 1): BuildExercise {
  return { kind: 'build', id, connector, level, tr, answers: ['Ich komme morgen.'] };
}
function pick(connector: string, id: string, level: 1 | 2 = 1): PickExercise {
  return { kind: 'pick', id, connector, level, tr, before: 'Ich bleibe,', after: 'es regnet.', answer: connector, options: [connector, 'und', 'oder'] };
}
function row(id: string, box: number, due: number): GrammarProgress {
  return { id, box, due, lastAt: 0, right: 0, wrong: 0 };
}
const progressOf = (...rows: GrammarProgress[]) => new Map(rows.map((r) => [r.id, r]));
const ids = (list: GrammarExercise[]) => list.map((e) => e.id);
const stage = (id: number, words: string[], partners: string[] = []): GrammarStage => ({ id, topic: 'verb-end', words, partners, contrast });
/** `builds` builds and `picks` picks of a word: "weil-b0", "weil-p0"… */
function exercisesOf(word: string, builds: number, picks: number): GrammarExercise[] {
  return [
    ...Array.from({ length: builds }, (_, i) => build(word, `${word}-b${i}`)),
    ...Array.from({ length: picks }, (_, i) => pick(word, `${word}-p${i}`)),
  ];
}
/** A repeatable rng. */
function seeded(seed = 1) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
}
const longestRun = (list: GrammarExercise[]) => {
  let best = 0;
  let run = 0;
  list.forEach((ex, i) => {
    run = i && list[i - 1].connector === ex.connector ? run + 1 : 1;
    best = Math.max(best, run);
  });
  return best;
};
/** Can this many exercises per connector be ordered with no three of one in a row? */
function canAvoidTriples(counts: number[], last = -1, run = 0): boolean {
  if (counts.every((c) => c === 0)) return true;
  return counts.some((c, i) => {
    if (!c || (i === last && run === 2)) return false;
    const rest = counts.slice();
    rest[i]--;
    return canAvoidTriples(rest, i, i === last ? run + 1 : 1);
  });
}

describe('wordExercises and stageExercises', () => {
  const all = [...exercisesOf('weil', 2, 1), ...exercisesOf('dass', 1, 1), ...exercisesOf('denn', 1, 0)];

  it('take the exercises of a word', () => {
    expect(ids(wordExercises('dass', all))).toEqual(['dass-b0', 'dass-p0']);
    expect(wordExercises('nie', all)).toEqual([]);
  });

  it('take the exercises of a stage’s own words, not its partners', () => {
    expect(ids(stageExercises(stage(1, ['weil', 'denn'], ['dass']), all))).toEqual(['weil-b0', 'weil-b1', 'weil-p0', 'denn-b0']);
  });
});

describe('wordSession', () => {
  it('holds builds only, at most WORD_SESSION', () => {
    const all = [...exercisesOf('weil', 12, 6), ...exercisesOf('dass', 5, 2)];
    const list = wordSession('weil', all, new Map(), NOW, seeded());
    expect(WORD_SESSION).toBe(7);
    expect(list).toHaveLength(7);
    expect(list.every((e) => e.kind === 'build' && e.connector === 'weil')).toBe(true);
    expect(new Set(ids(list)).size).toBe(7);
  });

  it('goes due oldest first, then new with level 1 first, then not yet due soonest first', () => {
    const all = [
      build('weil', 'later2'),
      build('weil', 'new2', 2),
      build('weil', 'due2'),
      build('weil', 'new1'),
      build('weil', 'later1'),
      build('weil', 'due1'),
    ];
    const progress = progressOf(row('due1', 1, NOW - 2 * DAY), row('due2', 1, NOW), row('later1', 2, NOW + DAY), row('later2', 2, NOW + 3 * DAY));
    expect(ids(wordSession('weil', all, progress, NOW, seeded()))).toEqual(['due1', 'due2', 'new1', 'new2', 'later1', 'later2']);
  });

  it('is empty for a word without builds', () => {
    expect(wordSession('weil', exercisesOf('weil', 0, 3), new Map(), NOW, seeded())).toEqual([]);
  });
});

describe('stageSession', () => {
  const s1 = stage(1, ['und', 'aber']);
  const s2 = stage(2, ['weil', 'dass'], ['und', 'aber']);
  const all = [...exercisesOf('und', 6, 3), ...exercisesOf('aber', 6, 3), ...exercisesOf('weil', 6, 3), ...exercisesOf('dass', 6, 3)];
  const session = (progress = new Map<string, GrammarProgress>(), seed = 1, s = s2, pool = all) => stageSession(s, pool, progress, NOW, seeded(seed));

  it('opens a first session with 6 new builds, word by word and fairly shared', () => {
    const list = session();
    expect(list.slice(0, 6).map((e) => `${e.connector}/${e.kind}`)).toEqual([
      'weil/build', 'weil/build', 'weil/build', 'dass/build', 'dass/build', 'dass/build',
    ]);
  });

  it('puts level 1 first within a word', () => {
    const pool = [build('weil', 'l2a', 2), build('weil', 'l2b', 2), build('weil', 'l1a'), build('weil', 'l1b')];
    expect(ids(session(new Map(), 3, stage(1, ['weil']), pool)).slice(0, 2).sort()).toEqual(['l1a', 'l1b']);
  });

  it('is full, without duplicates, whatever the seed', () => {
    for (let seed = 1; seed < 50; seed++) {
      const list = session(new Map(), seed);
      expect(list).toHaveLength(STAGE_SESSION);
      expect(new Set(ids(list)).size).toBe(STAGE_SESSION);
    }
  });

  it('keeps to n, also a small one', () => {
    expect(STAGE_SESSION).toBe(12);
    expect(stageSession(s2, all, new Map(), NOW, seeded(), 5)).toHaveLength(5);
    expect(stageSession(s2, all, new Map(), NOW, seeded(), 1)).toHaveLength(1);
    expect(stageSession(s2, all, new Map(), NOW, seeded(), 0)).toEqual([]);
  });

  it('puts due exercises first, oldest first, and only the stage’s own', () => {
    const progress = progressOf(row('weil-b2', 1, NOW), row('dass-p1', 2, NOW - 3 * DAY), row('weil-p0', 1, NOW - DAY), row('und-b0', 1, NOW - 9 * DAY));
    expect(ids(session(progress)).slice(0, 3)).toEqual(['dass-p1', 'weil-p0', 'weil-b2']);
  });

  it('lets due exercises fill the session', () => {
    const rows = stageExercises(s2, all).map((e, i) => row(e.id, 1, NOW - DAY * (i + 1)));
    const list = session(progressOf(...rows));
    expect(list).toHaveLength(12);
    expect(ids(list)).toEqual(rows.slice().reverse().slice(0, 12).map((r) => r.id));
  });

  it('has no new builds when the words have been seen', () => {
    const rows = stageExercises(s2, all).filter((e) => e.kind === 'build').map((e) => row(e.id, 3, NOW + 5 * DAY));
    const list = session(progressOf(...rows));
    expect(list).toHaveLength(12);
    expect(list.filter((e) => e.kind === 'pick').length).toBeGreaterThanOrEqual(6);
  });

  it('gives partners up to 3 places, picks preferred, shared between them', () => {
    for (let seed = 1; seed < 30; seed++) {
      const fromPartners = session(new Map(), seed).filter((e) => s2.partners.includes(e.connector));
      expect(fromPartners).toHaveLength(3);
      expect(fromPartners.every((e) => e.kind === 'pick')).toBe(true);
      expect(new Set(fromPartners.map((e) => e.connector)).size).toBe(2);
    }
  });

  it('takes a partner’s builds when it has no picks, and its practised exercises too', () => {
    const pool = [...exercisesOf('weil', 6, 3), ...exercisesOf('und', 2, 0)];
    const progress = progressOf(row('und-b0', 3, NOW + 40 * DAY));
    const list = stageSession(stage(2, ['weil'], ['und']), pool, progress, NOW, seeded());
    expect(ids(list)).toEqual(expect.arrayContaining(['und-b0', 'und-b1']));
  });

  it('mixes the partners in rather than leaving them last', () => {
    for (let seed = 1; seed < 30; seed++) {
      const tail = session(new Map(), seed).slice(6);
      expect(s2.partners).toContain(tail[0].connector);
      expect(s2.partners).not.toContain(tail.at(-1)?.connector);
    }
  });

  it('doesn’t take a word twice when it is also listed as a partner', () => {
    const list = stageSession(stage(1, ['weil'], ['weil']), exercisesOf('weil', 8, 8), new Map(), NOW, seeded());
    expect(new Set(ids(list)).size).toBe(list.length);
  });

  it('shows contrast picks in a first session', () => {
    expect(session().filter((e) => e.kind === 'pick' && s2.words.includes(e.connector)).length).toBe(3);
    // Words from one stage all get a pick, when there are enough places.
    expect(new Set(session().filter((e) => e.kind === 'pick' && s2.words.includes(e.connector)).map((e) => e.connector)).size).toBe(2);
    // A short session too.
    expect(stageSession(s1, all, new Map(), NOW, seeded(), 4).some((e) => e.kind === 'pick')).toBe(true);
    // A stage without picks of its own gets them from its partners.
    const pool = [...exercisesOf('weil', 8, 0), ...exercisesOf('und', 2, 2)];
    expect(stageSession(stage(2, ['weil'], ['und']), pool, new Map(), NOW, seeded()).some((e) => e.kind === 'pick')).toBe(true);
  });

  it('tops up with new builds when nothing else is left', () => {
    const list = stageSession(stage(1, ['weil']), exercisesOf('weil', 20, 0), new Map(), NOW, seeded());
    expect(list).toHaveLength(12);
  });

  it('fills up with not yet due exercises, soonest first within a word', () => {
    const pool = exercisesOf('weil', 3, 0);
    const progress = progressOf(row('weil-b0', 3, NOW + 9 * DAY), row('weil-b1', 3, NOW + DAY), row('weil-b2', 3, NOW + 5 * DAY));
    expect(ids(stageSession(stage(1, ['weil']), pool, progress, NOW, seeded()))).toEqual(['weil-b1', 'weil-b2', 'weil-b0']);
  });

  it('is empty only when the stage has no exercises', () => {
    expect(stageSession(stage(1, ['nie'], ['und']), all, new Map(), NOW, seeded())).toEqual([]);
    const learned = stageExercises(s2, all).map((e) => row(e.id, 5, NOW + 50 * DAY));
    expect(session(progressOf(...learned)).length).toBeGreaterThan(0);
    expect(stageSession(s1, exercisesOf('und', 1, 0), new Map(), NOW, seeded())).toHaveLength(1);
  });

  it('has no three of a connector in a row in the mixed part, also where it starts', () => {
    const words = ['a', 'b', 'c', 'd'];
    for (let seed = 1; seed < 200; seed++) {
      const r = seeded(seed);
      const rand = (n: number) => Math.floor(r() * n);
      const pool = words.flatMap((w) => exercisesOf(w, rand(3), rand(5)));
      const stg = stage(2, ['a', 'b'], ['c', 'd']);
      // Everything seen and not due: the whole session is the mixed part.
      const progress = progressOf(...pool.map((e, i) => row(e.id, 3, NOW + (i + 1) * DAY)));
      const list = stageSession(stg, pool, progress, NOW, seeded(seed));
      if (!list.length) continue;
      const counts = [...new Set(list.map((e) => e.connector))].map((w) => list.filter((e) => e.connector === w).length);
      if (canAvoidTriples(counts)) expect(longestRun(list), ids(list).join(' ')).toBeLessThanOrEqual(2);
    }
  });

  it('keeps the first mixed exercises from running on from the opening', () => {
    // One due exercise of each of two words would allow it only if the mix looked back.
    const pool = [...exercisesOf('a', 0, 6), ...exercisesOf('b', 0, 2)];
    const progress = progressOf(row('a-p0', 1, NOW - 2), row('a-p1', 1, NOW - 1));
    for (let seed = 1; seed < 30; seed++) {
      expect(longestRun(stageSession(stage(1, ['a', 'b']), pool, progress, NOW, seeded(seed)))).toBeLessThanOrEqual(2);
    }
  });

  it('accepts a run when there is no other order', () => {
    const list = stageSession(stage(1, ['weil', 'dass']), [...exercisesOf('weil', 0, 8), ...exercisesOf('dass', 0, 1)], new Map(), NOW, seeded());
    expect(list).toHaveLength(9);
    expect(longestRun(list)).toBeLessThanOrEqual(4);
  });

  it('leaves the list it was given alone', () => {
    const before = ids(all);
    session();
    expect(ids(all)).toEqual(before);
  });
});

describe('reviewSession', () => {
  const all = exercisesOf('weil', 8, 8);

  it('gives exactly what is due, oldest first, no new ones', () => {
    const progress = progressOf(row('weil-b1', 1, NOW - 1), row('weil-p1', 1, NOW - DAY), row('weil-b2', 2, NOW + 1));
    expect(ids(reviewSession(all, progress, NOW))).toEqual(['weil-p1', 'weil-b1']);
  });

  it('is empty when nothing is due', () => {
    expect(reviewSession(all, new Map(), NOW)).toEqual([]);
    expect(reviewSession(all, progressOf(row('weil-b1', 1, NOW + 1)), NOW)).toEqual([]);
  });

  it('keeps to n', () => {
    const progress = progressOf(...all.map((e) => row(e.id, 1, NOW)));
    expect(reviewSession(all, progress, NOW)).toHaveLength(12);
    expect(reviewSession(all, progress, NOW, 3)).toHaveLength(3);
  });

  it('ignores rows of exercises no longer there', () => {
    expect(reviewSession(all, progressOf(row('gone-1', 1, 0)), NOW)).toEqual([]);
  });
});

describe('anywaySession', () => {
  const stages = [stage(1, ['und']), stage(2, ['weil'], ['und']), stage(3, ['dass'])];
  const all = [...exercisesOf('und', 8, 2), ...exercisesOf('weil', 8, 2), ...exercisesOf('dass', 8, 2)];

  it('is the first stage’s session before anything is started', () => {
    const list = anywaySession(all, stages, new Map(), NOW, seeded());
    expect(ids(list)).toEqual(ids(stageSession(stages[0], all, new Map(), NOW, seeded())));
    expect(anywaySession(all, [], new Map(), NOW, seeded())).toEqual([]);
  });

  it('takes exercises of started stages only, soonest due first', () => {
    const progress = progressOf(row('weil-b0', 2, NOW + 9 * DAY), row('und-b0', 2, NOW + DAY), row('weil-b1', 3, NOW + 3 * DAY));
    const list = anywaySession(all, stages, progress, NOW, seeded());
    expect(ids(list).slice(0, 3)).toEqual(['und-b0', 'weil-b1', 'weil-b0']);
    expect(list).toHaveLength(12);
    expect(list.some((e) => e.connector === 'dass')).toBe(false);
  });

  it('keeps to n', () => {
    expect(anywaySession(all, stages, progressOf(row('und-b0', 2, NOW + DAY)), NOW, seeded(), 2)).toHaveLength(2);
  });
});

describe('wordStats', () => {
  const list = exercisesOf('weil', 7, 3);
  const learned = (n: number) => list.slice(0, n).map((e) => row(e.id, 2, NOW + DAY));

  it('is done at exactly 70% and not below', () => {
    expect(DONE_RATIO).toBe(0.7);
    expect(wordStats(list, progressOf(...learned(6)), NOW).done).toBe(false);
    expect(wordStats(list, progressOf(...learned(7)), NOW)).toMatchObject({ total: 10, learned: 7, done: true });
    expect(wordStats(exercisesOf('w', 21, 9), progressOf(...exercisesOf('w', 21, 0).map((e) => row(e.id, 2, NOW))), NOW).done).toBe(true);
  });

  it('counts only learned ones, not the half points of the ring', () => {
    const rows = list.map((e) => row(e.id, 1, NOW + DAY));
    expect(wordStats(list, progressOf(...rows), NOW)).toMatchObject({ ratio: 0.5, learned: 0, done: false });
  });

  it('is never done without exercises', () => {
    expect(wordStats([], new Map(), NOW)).toEqual({ total: 0, learned: 0, due: 0, fresh: 0, ratio: 0, done: false });
  });

  it('reads old rows with boxes as they are', () => {
    // Stored before stages existed: right, wrong and a box from same-day answers stay valid.
    const old = { id: 'weil-b0', box: 3, due: NOW - DAY, lastAt: NOW - 8 * DAY, right: 3, wrong: 1 };
    expect(wordStats(list.slice(0, 1), progressOf(old), NOW)).toMatchObject({ learned: 1, due: 1, done: true });
  });
});

describe('stageStats', () => {
  const a = exercisesOf('a', 7, 3);
  const b = exercisesOf('b', 7, 3);
  const all = [...a, ...b];
  const s = stage(1, ['a', 'b']);
  const learned = (list: GrammarExercise[]) => list.slice(0, 7).map((e) => row(e.id, 2, NOW + DAY));

  it('counts the stage’s own exercises, word by word too', () => {
    const stats = stageStats(stage(1, ['a', 'b'], ['c']), [...all, ...exercisesOf('c', 3, 0)], progressOf(...learned(a)), NOW);
    expect(stats).toMatchObject({ total: 20, learned: 7, fresh: 13 });
    expect(stats.words.map((w) => w.word)).toEqual(['a', 'b']);
    expect(stats.words[0].stats).toMatchObject({ total: 10, learned: 7, done: true });
    expect(stats.words[1].stats).toMatchObject({ total: 10, learned: 0, done: false });
  });

  it('needs every word, however far the stage is overall', () => {
    const lopsided = [...a, ...b].filter((e) => e.connector === 'a' || e.id === 'b-b0');
    const rows = [...a.map((e) => row(e.id, 2, NOW + DAY)), row('b-b1', 1, NOW + DAY)];
    expect(stageStats(s, lopsided, progressOf(...rows), NOW).done).toBe(false);
    expect(stageStats(s, all, progressOf(...learned(a)), NOW).done).toBe(false);
    expect(stageStats(s, all, progressOf(...learned(a), ...learned(b)), NOW).done).toBe(true);
  });

  it('is not held up by a word without exercises', () => {
    expect(stageStats(stage(1, ['a', 'gone']), all, progressOf(...learned(a)), NOW).done).toBe(true);
  });
});

describe('currentStage', () => {
  const stages = [stage(1, ['a']), stage(2, ['b']), stage(3, ['nothing'])];
  const a = exercisesOf('a', 3, 0);
  const b = exercisesOf('b', 3, 0);
  const all = [...a, ...b];

  it('is the first stage that isn’t done', () => {
    expect(currentStage(stages, all, new Map(), NOW)).toBe(stages[0]);
    expect(currentStage(stages, all, progressOf(...a.map((e) => row(e.id, 2, NOW))), NOW)).toBe(stages[1]);
  });

  it('skips nothing: a done stage later on doesn’t count', () => {
    expect(currentStage(stages, all, progressOf(...b.map((e) => row(e.id, 2, NOW))), NOW)).toBe(stages[0]);
  });

  it('is undefined when all are done', () => {
    expect(currentStage(stages, all, progressOf(...all.map((e) => row(e.id, 2, NOW))), NOW)).toBeUndefined();
    expect(currentStage([], all, new Map(), NOW)).toBeUndefined();
  });
});
