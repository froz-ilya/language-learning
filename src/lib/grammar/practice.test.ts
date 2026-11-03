import { describe, expect, it } from 'vitest';
import {
  checkBuild,
  checkEnding,
  endingMarks,
  fillGaps,
  fullSentence,
  gapOptions,
  GrammarSession,
  INTERVALS_DAYS,
  isDue,
  isLearned,
  modelAnswer,
  nextProgress,
  pickExercises,
  shuffledTiles,
  tilesOf,
  topicStats,
} from './practice';
import type { BuildExercise, EndingExercise, GrammarExercise, GrammarProgress, PickExercise } from './types';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_000 * DAY;
const tr = { ru: 'перевод', en: 'translation' };

function build(id: string, answers: string[], extra: Partial<BuildExercise> = {}): BuildExercise {
  return { kind: 'build', id, connector: 'weil', level: 1, tr, answers, ...extra };
}
function pick(id: string, extra: Partial<PickExercise> = {}): PickExercise {
  return { kind: 'pick', id, connector: 'weil', level: 1, tr, before: 'Ich bleibe,', after: 'es regnet.', answer: 'weil', options: ['weil', 'denn', 'und'], ...extra };
}
function row(id: string, box: number, due: number): GrammarProgress {
  return { id, box, due, lastAt: 0, right: 0, wrong: 0 };
}
const progressOf = (...rows: GrammarProgress[]) => new Map(rows.map((r) => [r.id, r]));
const ids = (list: GrammarExercise[]) => list.map((e) => e.id);
/** A repeatable rng. */
function seeded(seed = 1) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
}

function ending(id: string, extra: Partial<EndingExercise> = {}): EndingExercise {
  return {
    kind: 'ending',
    id,
    connector: 'ein-akk',
    level: 1,
    tr,
    text: 'Ich kaufe {0} {1} Tisch.',
    gaps: [
      { stem: 'ein', answer: 'en', role: 'det' },
      { stem: 'neu', answer: 'en', role: 'adj' },
    ],
    phrase: { det: 'ein', case: 'akk', gender: 'm' },
    ...extra,
  };
}

const twoOrders = build('two', ['Heute gehe ich nach Hause.', 'Ich gehe heute nach Hause.']);

describe('tiles', () => {
  it('are the words of the first answer without punctuation, first word lower-cased', () => {
    expect(tilesOf(build('a', ['Weil es regnet, bleibe ich, oder?']))).toEqual(['weil', 'es', 'regnet', 'bleibe', 'ich', 'oder']);
    expect(tilesOf(twoOrders)).toEqual(['heute', 'gehe', 'ich', 'nach', 'Hause']);
  });

  it('keep a noun, name or "Sie" capital with keepFirstCap', () => {
    expect(tilesOf(build('a', ['Sie kommt, weil Anna wartet.'], { keepFirstCap: true }))).toEqual(['Sie', 'kommt', 'weil', 'Anna', 'wartet']);
  });

  it('lower-case an umlaut and keep words with a hyphen whole', () => {
    expect(tilesOf(build('a', ['Über die E-Mail freut sie sich!']))).toEqual(['über', 'die', 'E-Mail', 'freut', 'sie', 'sich']);
  });

  it('never start out solved', () => {
    const ex = build('a', ['Ich komme morgen.', 'Morgen komme ich.']);
    for (let seed = 1; seed < 200; seed++) expect(checkBuild(ex, shuffledTiles(ex, seeded(seed)))).toBe(false);
    // Rngs that would leave the tiles as they are, or always give the same order.
    for (const rng of [() => 0.999, () => 0, () => 0.5]) {
      for (const ex of [twoOrders, build('r', ['ich sehe, ich komme.', 'ich komme, ich sehe.'])]) {
        const tiles = shuffledTiles(ex, rng);
        expect(checkBuild(ex, tiles)).toBe(false);
        expect(tiles.slice().sort()).toEqual(tilesOf(ex).sort());
      }
    }
  });

  it('are returned as they are when every order is accepted', () => {
    const ex = build('a', ['Komm her.', 'Her komm.']);
    expect(shuffledTiles(ex, () => 0.999).slice().sort()).toEqual(['her', 'komm']);
    expect(shuffledTiles(build('b', ['Ja.']))).toEqual(['ja']);
  });
});

describe('checkBuild', () => {
  it('accepts every accepted order', () => {
    expect(checkBuild(twoOrders, ['heute', 'gehe', 'ich', 'nach', 'Hause'])).toBe(true);
    expect(checkBuild(twoOrders, ['ich', 'gehe', 'heute', 'nach', 'Hause'])).toBe(true);
  });

  it('rejects another order, missing words and extra words', () => {
    expect(checkBuild(twoOrders, ['heute', 'ich', 'gehe', 'nach', 'Hause'])).toBe(false);
    expect(checkBuild(twoOrders, ['heute', 'gehe', 'ich', 'nach'])).toBe(false);
    expect(checkBuild(twoOrders, ['heute', 'gehe', 'ich', 'nach', 'Hause', 'Hause'])).toBe(false);
    expect(checkBuild(twoOrders, [])).toBe(false);
  });

  it('copes with repeated words', () => {
    const ex = build('a', ['Ich weiß, dass ich komme.']);
    expect(tilesOf(ex)).toEqual(['ich', 'weiß', 'dass', 'ich', 'komme']);
    expect(checkBuild(ex, ['ich', 'weiß', 'dass', 'ich', 'komme'])).toBe(true);
    expect(checkBuild(ex, ['ich', 'ich', 'weiß', 'dass', 'komme'])).toBe(false);
  });

  it('accepts a keepFirstCap tile', () => {
    const ex = build('a', ['Sie kommt.'], { keepFirstCap: true });
    expect(checkBuild(ex, ['Sie', 'kommt'])).toBe(true);
    expect(checkBuild(ex, ['kommt', 'Sie'])).toBe(false);
  });

  it('ignores case and punctuation, umlauts included', () => {
    const ex = build('a', ['Äpfel, Öl und Übung!']);
    expect(checkBuild(ex, ['äpfel', 'öl', 'und', 'übung'])).toBe(true);
    expect(checkBuild(ex, ['ÄPFEL,', 'ÖL', 'UND', 'ÜBUNG.'])).toBe(true);
    expect(checkBuild(ex, ['apfel', 'ol', 'und', 'ubung'])).toBe(false);
  });
});

describe('sentences', () => {
  it('modelAnswer puts `given` first and keeps the order the learner built', () => {
    const ex = build('a', ['Heute komme ich.', 'Ich komme heute.'], { given: 'Es regnet nicht.' });
    expect(modelAnswer(ex)).toBe('Es regnet nicht. Heute komme ich.');
    expect(modelAnswer(ex, ['ich', 'komme', 'heute'])).toBe('Es regnet nicht. Ich komme heute.');
    expect(modelAnswer(ex, ['komme', 'heute', 'ich'])).toBe('Es regnet nicht. Heute komme ich.');
    expect(modelAnswer(build('b', ['Ich komme.']))).toBe('Ich komme.');
  });

  it('fullSentence reads both kinds', () => {
    expect(fullSentence(build('a', ['es regnet.'], { given: 'Ich bleibe, weil' }))).toBe('Ich bleibe, weil es regnet.');
    expect(fullSentence(pick('p'))).toBe('Ich bleibe, weil es regnet.');
  });

  it('fullSentence capitalises an answer at the start and tidies the joins', () => {
    expect(fullSentence(pick('p', { before: '', after: 'es regnet, bleibe ich.', answer: 'weil' }))).toBe('Weil es regnet, bleibe ich.');
    expect(fullSentence(pick('p', { before: '', after: 'ich komme.', answer: 'übermorgen' }))).toBe('Übermorgen ich komme.');
    expect(fullSentence(pick('p', { before: 'Ich komme ', after: ' .', answer: 'heute' }))).toBe('Ich komme heute.');
    expect(fullSentence(pick('p', { before: 'Ich sehe', after: ', dass es regnet.', answer: 'dich' }))).toBe('Ich sehe dich, dass es regnet.');
  });
});

describe('ending exercises', () => {
  const noEnding = ending('n', {
    connector: 'ein-nom',
    text: '{0} {1} Hund bellt, und {2} Kind lacht.',
    gaps: [
      { stem: 'Ein', answer: '', role: 'det' },
      { stem: 'groß', answer: 'er', role: 'adj' },
      { stem: 'ein', answer: '', role: 'det' },
    ],
    phrase: { det: 'ein', case: 'nom', gender: 'm' },
  });

  it('fullSentence fills every gap with stem and ending', () => {
    expect(fullSentence(ending('a'))).toBe('Ich kaufe einen neuen Tisch.');
    expect(fullSentence(noEnding)).toBe('Ein großer Hund bellt, und ein Kind lacht.');
    expect(fullSentence(ending('s', { text: '{0} Kaffee ist heiß.', gaps: [{ stem: 'Heiß', answer: 'er', role: 'adj' }], phrase: { det: '', case: 'nom', gender: 'm' } }))).toBe('Heißer Kaffee ist heiß.');
  });

  it('fillGaps leaves a placeholder without a gap alone', () => {
    expect(fillGaps(ending('a'), (i) => `[${i}]`)).toBe('Ich kaufe [0] [1] Tisch.');
    expect(fillGaps(ending('a', { text: '{0} {5}' }), () => 'x')).toBe('x {5}');
  });

  it('endingMarks splits each gap off its stem, in gap order', () => {
    expect(endingMarks(ending('a'))).toEqual(['ein|en', 'neu|en']);
    expect(endingMarks(noEnding)).toEqual(['Ein|', 'groß|er', 'ein|']);
  });

  it('checkEnding wants every gap right, and "" means no ending', () => {
    expect(checkEnding(ending('a'), ['en', 'en'])).toBe(true);
    expect(checkEnding(ending('a'), ['en', 'es'])).toBe(false);
    expect(checkEnding(ending('a'), ['', 'en'])).toBe(false);
    expect(checkEnding(ending('a'), ['en'])).toBe(false);
    expect(checkEnding(ending('a'), ['en', null])).toBe(false);
    expect(checkEnding(noEnding, ['', 'er', ''])).toBe(true);
    expect(checkEnding(noEnding, ['', 'er', 'e'])).toBe(false);
  });

  it('gapOptions offers what the word could take, the answer always among them', () => {
    const ex = ending('a');
    expect(gapOptions(ex, 0)).toEqual(['', 'e', 'en', 'er', 'es', 'em']);
    expect(gapOptions(ex, 1)).toEqual(['e', 'en', 'er', 'es', 'em']);
    expect(gapOptions(ex, 2)).toEqual([]);
    const der = ending('d', { gaps: [{ stem: 'd', answer: 'en', role: 'det' }], phrase: { det: 'der', case: 'akk', gender: 'm' } });
    expect(gapOptions(der, 0)).toContain('en');
    expect(gapOptions(der, 0)).toContain('ie');
    // An answer the table doesn't offer still gets its chip, so the exercise can be solved.
    const odd = ending('o', { gaps: [{ stem: 'neu', answer: 'ere', role: 'adj' }] });
    expect(gapOptions(odd, 0)).toContain('ere');
  });

  it('a session takes ending exercises like the others', () => {
    const s = new GrammarSession([ending('a'), pick('p')]);
    s.answer(false);
    s.answer(true);
    expect(s.current?.id).toBe('a');
    expect(ids(s.missed)).toEqual(['a']);
  });
});

describe('spacing', () => {
  it('the first right answer goes to box 1, a day away', () => {
    expect(nextProgress(undefined, 'a', true, NOW)).toEqual({ id: 'a', box: 1, due: NOW + DAY, lastAt: NOW, right: 1, wrong: 0 });
  });

  it('a first mistake stays in box 0 and comes back in 10 minutes', () => {
    expect(nextProgress(undefined, 'a', false, NOW)).toEqual({ id: 'a', box: 0, due: NOW + 10 * 60 * 1000, lastAt: NOW, right: 0, wrong: 1 });
  });

  it('moves up through every interval, answered when due, and stays on the last', () => {
    let p: GrammarProgress | undefined;
    let at = NOW;
    INTERVALS_DAYS.forEach((days, i) => {
      p = nextProgress(p, 'a', true, at);
      expect(p).toMatchObject({ box: i + 1, due: at + days * DAY });
      at = p.due;
    });
    expect(INTERVALS_DAYS).toEqual([1, 3, 7, 21, 60]);
    p = nextProgress(p, 'a', true, at);
    expect(p).toMatchObject({ box: 5, due: at + 60 * DAY, right: 6 });
  });

  it('a right answer before the due date only counts: same box, same due', () => {
    const prev = { ...row('a', 2, NOW + 1), lastAt: 5, right: 3, wrong: 1 };
    expect(nextProgress(prev, 'a', true, NOW)).toEqual({ id: 'a', box: 2, due: NOW + 1, lastAt: NOW, right: 4, wrong: 1 });
  });

  it('a right answer exactly at the due date moves up', () => {
    expect(nextProgress(row('a', 2, NOW), 'a', true, NOW)).toMatchObject({ box: 3, due: NOW + 7 * DAY });
  });

  it('learned takes right answers on two different days', () => {
    const first = nextProgress(undefined, 'a', true, NOW);
    const sameDay = nextProgress(first, 'a', true, NOW + 60 * 60 * 1000);
    expect(isLearned(sameDay)).toBe(false);
    expect(sameDay).toMatchObject({ box: 1, due: NOW + DAY, right: 2 });
    expect(isLearned(nextProgress(sameDay, 'a', true, NOW + DAY))).toBe(true);
  });

  it('a wrong answer resets a row that is not due yet', () => {
    expect(nextProgress(row('a', 3, NOW + DAY), 'a', false, NOW)).toMatchObject({ box: 0, due: NOW + 10 * 60 * 1000, wrong: 1 });
  });

  it('a mistake resets the box and keeps the counts', () => {
    const p = nextProgress({ ...row('a', 4, 0), right: 4, wrong: 1 }, 'a', false, NOW);
    expect(p).toMatchObject({ box: 0, right: 4, wrong: 2, due: NOW + 10 * 60 * 1000 });
    expect(nextProgress(p, 'a', true, NOW + 10 * 60 * 1000)).toMatchObject({ box: 1, right: 5, wrong: 2 });
  });

  it('isDue and isLearned', () => {
    expect(isDue(row('a', 1, NOW), NOW)).toBe(true);
    expect(isDue(row('a', 1, NOW + 1), NOW)).toBe(false);
    expect(isLearned(row('a', 1, 0))).toBe(false);
    expect(isLearned(row('a', 2, 0))).toBe(true);
  });
});

describe('topicStats', () => {
  it('counts only this topic’s exercises, and due only practised ones', () => {
    const exercises = [build('a', ['Ja.']), build('b', ['Ja.']), pick('c'), pick('d')];
    const progress = progressOf(row('a', 2, NOW - 1), row('b', 0, NOW + 1), row('c', 3, NOW + 1), row('other', 3, 0));
    expect(topicStats(exercises, progress, NOW)).toEqual({ total: 4, learned: 2, due: 1, fresh: 1, ratio: 0.5 });
  });

  it('counts a first right answer for half', () => {
    const exercises = [build('a', ['Ja.']), pick('b')];
    const progress = progressOf(row('a', 1, NOW + 1));
    expect(topicStats(exercises, progress, NOW)).toMatchObject({ learned: 0, ratio: 0.25 });
  });

  it('is all zeros without exercises', () => {
    expect(topicStats([], new Map(), NOW)).toEqual({ total: 0, learned: 0, due: 0, fresh: 0, ratio: 0 });
  });
});

describe('pickExercises', () => {
  const b = (id: string, level: 1 | 2 = 1) => build(id, ['Ich komme.'], { level });

  it('takes due ones first, oldest first, then new ones, level 1 before level 2', () => {
    const pool = [b('new2', 2), b('later'), b('due2'), b('new1'), b('due1')];
    const progress = progressOf(row('due1', 1, NOW - 2 * DAY), row('due2', 1, NOW - DAY), row('later', 3, NOW + DAY));
    expect(ids(pickExercises(pool, progress, NOW, 4))).toEqual(['due1', 'due2', 'new1', 'new2']);
  });

  it('never gives more than n, nor changes the pool', () => {
    const pool = Array.from({ length: 30 }, (_, i) => b(`e${i}`));
    const before = ids(pool);
    expect(pickExercises(pool, new Map(), NOW)).toHaveLength(10);
    expect(pickExercises(pool, new Map(), NOW, 3)).toHaveLength(3);
    expect(pickExercises(pool, new Map(), NOW, 0)).toEqual([]);
    expect(ids(pool)).toEqual(before);
    expect(new Set(ids(pickExercises(pool, new Map(), NOW))).size).toBe(10);
  });

  it('shuffles within a level', () => {
    const pool = Array.from({ length: 20 }, (_, i) => b(`e${i}`, i < 10 ? 2 : 1));
    const list = ids(pickExercises(pool, new Map(), NOW, 20, seeded(7)));
    expect(list).not.toEqual(ids(pool.slice(10).concat(pool.slice(0, 10))));
    expect(list.slice(0, 10).sort()).toEqual(ids(pool.slice(10)).sort());
  });

  it('tops up with not yet due exercises, soonest first', () => {
    const pool = [b('far'), b('soon'), b('mid'), b('due')];
    const progress = progressOf(row('far', 3, NOW + 9 * DAY), row('soon', 3, NOW + DAY), row('mid', 3, NOW + 5 * DAY), row('due', 1, NOW));
    expect(ids(pickExercises(pool, progress, NOW, 3))).toEqual(['due', 'soon', 'mid']);
    expect(ids(pickExercises(pool, progress, NOW, 10))).toEqual(['due', 'soon', 'mid', 'far']);
  });

  it('makes practice possible when nothing is due or new', () => {
    const pool = [b('a'), b('b')];
    expect(pickExercises(pool, progressOf(row('a', 5, NOW + DAY), row('b', 5, NOW + 2 * DAY)), NOW)).toHaveLength(2);
  });

  it('is not all of one kind when both exist', () => {
    const builds = Array.from({ length: 12 }, (_, i) => b(`b${i}`));
    const dueRows = builds.map((e, i) => row(e.id, 1, NOW - i));
    const list = pickExercises([...builds, pick('p')], progressOf(...dueRows), NOW, 5);
    expect(list).toHaveLength(5);
    expect(list.at(-1)?.id).toBe('p');
    expect(ids(list).slice(0, 4)).toEqual(['b11', 'b10', 'b9', 'b8']); // the oldest due keep their places

    const picks = Array.from({ length: 12 }, (_, i) => pick(`p${i}`));
    expect(pickExercises([...picks, b('b')], new Map(), NOW, 5).map((e) => e.kind)).toContain('build');
  });

  it('gives up mixing for a single place or a single kind', () => {
    expect(pickExercises([b('a'), pick('p')], progressOf(row('a', 1, NOW)), NOW, 1).map((e) => e.id)).toEqual(['a']);
    expect(pickExercises([b('a'), b('b'), b('c')], new Map(), NOW, 2).every((e) => e.kind === 'build')).toBe(true);
  });
});

describe('GrammarSession', () => {
  const list = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => build(id, ['Ich komme.']));

  it('asks each exercise once when all are right', () => {
    const s = new GrammarSession(list);
    expect(s.total).toBe(6);
    const asked: string[] = [];
    while (!s.finished) {
      asked.push(s.current!.id);
      expect(s.answer(true)).toEqual({ first: true });
    }
    expect(asked).toEqual(ids(list));
    expect(s).toMatchObject({ doneCount: 6, firstTryCorrect: 6, missed: [], current: undefined });
  });

  it('asks a wrong answer again three positions on, until it is right', () => {
    const s = new GrammarSession(list);
    const asked: string[] = [];
    const firsts: boolean[] = [];
    while (!s.finished) {
      const id = s.current!.id;
      asked.push(id);
      firsts.push(s.answer(id !== 'a' || asked.filter((x) => x === 'a').length > 1).first);
    }
    expect(asked).toEqual(['a', 'b', 'c', 'd', 'a', 'e', 'f']);
    expect(firsts).toEqual([true, true, true, true, false, true, true]);
    expect(s.total).toBe(6);
    expect(s.doneCount).toBe(6);
    expect(s.firstTryCorrect).toBe(5);
    expect(ids(s.missed)).toEqual(['a']);
  });

  it('puts it at the end when fewer are left', () => {
    const s = new GrammarSession(list.slice(0, 2));
    s.answer(false);
    expect(s.current?.id).toBe('b');
    s.answer(true);
    expect(s.current?.id).toBe('a');
    expect(s.finished).toBe(false);
    expect(s.doneCount).toBe(1);
    s.answer(false);
    expect(s.current?.id).toBe('a');
    s.answer(true);
    expect(s.finished).toBe(true);
    expect(s.firstTryCorrect).toBe(1);
  });

  it('gives each question its own seq', () => {
    const s = new GrammarSession(list.slice(0, 1));
    const seen = [s.seq];
    s.answer(false);
    seen.push(s.seq);
    s.answer(true);
    seen.push(s.seq);
    expect(seen).toEqual([0, 1, 2]);
  });

  it('handles an empty list and refuses answers once finished', () => {
    const s = new GrammarSession([]);
    expect(s.finished).toBe(true);
    expect(s.total).toBe(0);
    expect(() => s.answer(true)).toThrow();
  });

  it('leaves the list it was given alone', () => {
    const given = list.slice(0, 2);
    new GrammarSession(given).answer(false);
    expect(given).toHaveLength(2);
  });
});
