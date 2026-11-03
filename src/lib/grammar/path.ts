import type { Rng } from '../study/session';
import { isDue, shuffle, topicStats } from './practice';
import type { BuildExercise, GrammarExercise, GrammarProgress, GrammarStage } from './types';

/**
 * The staged learning path: which exercises a session holds and when a word or stage is done. Pure
 * like practice.ts (no DB, no DOM, no i18n): exercises are passed in, never imported.
 */

type Progress = Map<string, GrammarProgress>;

/** A word is done when this share of its exercises is learned. */
export const DONE_RATIO = 0.7;
export const STAGE_SESSION = 12;
export const WORD_SESSION = 7;
/** New builds in one stage session. */
const NEW_BUILDS = 6;
/** Places in one stage session for earlier words that get confused with this stage's. */
const PARTNER_PLACES = 3;
/** The longest run of one connector a mixed part of a session allows, when it can be avoided. */
const MAX_RUN = 2;

export type WordStats = ReturnType<typeof topicStats> & { done: boolean };
export type StageStats = WordStats & { words: { word: string; stats: WordStats }[] };

const ofWords = (words: string[], all: GrammarExercise[]) => all.filter((ex) => words.includes(ex.connector));

export function wordExercises(word: string, all: GrammarExercise[]): GrammarExercise[] {
  return ofWords([word], all);
}

export function stageExercises(stage: GrammarStage, all: GrammarExercise[]): GrammarExercise[] {
  return ofWords(stage.words, all);
}

/** The exercises by state: practised ones soonest due first, new ones level 1 first and shuffled. */
function byState<T extends GrammarExercise>(list: T[], progress: Progress, now: number, rng: Rng) {
  const rowOf = (ex: T) => progress.get(ex.id)!;
  const seen = list.filter((ex) => progress.has(ex.id)).sort((a, b) => rowOf(a).due - rowOf(b).due);
  const fresh = list.filter((ex) => !progress.has(ex.id));
  return {
    seen,
    due: seen.filter((ex) => isDue(rowOf(ex), now)),
    later: seen.filter((ex) => !isDue(rowOf(ex), now)),
    fresh: [...shuffle(fresh.filter((ex) => ex.level === 1), rng), ...shuffle(fresh.filter((ex) => ex.level !== 1), rng)],
  };
}

export function wordSession(word: string, all: GrammarExercise[], progress: Progress, now: number, rng: Rng = Math.random): BuildExercise[] {
  const builds = wordExercises(word, all).filter((ex): ex is BuildExercise => ex.kind === 'build');
  const { due, fresh, later } = byState(builds, progress, now, rng);
  return [...due, ...fresh, ...later].slice(0, WORD_SESSION);
}

/** One from each list in turn, so a cut anywhere leaves every list its share. */
function inTurn<T>(lists: T[][]): T[] {
  const longest = Math.max(0, ...lists.map((l) => l.length));
  return Array.from({ length: longest }, (_, i) => lists.flatMap((l) => (i < l.length ? [l[i]] : []))).flat();
}

const isPick = (ex: GrammarExercise) => ex.kind === 'pick';

/** Exercises of the earlier words a stage mixes in: picks first, each partner getting its turn. */
function partnerExercises(stage: GrammarStage, all: GrammarExercise[], progress: Progress, now: number, rng: Rng): GrammarExercise[] {
  const lists = stage.partners
    .filter((word) => !stage.words.includes(word))
    .map((word) => {
      const { seen, fresh } = byState(wordExercises(word, all), progress, now, rng);
      return [...seen, ...fresh];
    });
  return [...inTurn(lists.map((l) => l.filter(isPick))), ...inTurn(lists.map((l) => l.filter((ex) => !isPick(ex))))].slice(0, PARTNER_PLACES);
}

interface Queue {
  word: string;
  partner: boolean;
  items: GrammarExercise[];
  next: number;
}

/**
 * Lays out the queues into `out`, keeping each queue's order. Tries the most mixed order first
 * (another word, and stage after partner) and backtracks out of a run longer than `limit`.
 */
function layOut(queues: Queue[], limit: number, last: string | undefined, run: number, lastPartner: boolean, out: GrammarExercise[]): boolean {
  const open = queues.filter((q) => q.next < q.items.length);
  if (!open.length) return true;
  const left = (q: Queue) => q.items.length - q.next;
  open.sort(
    (a, b) =>
      Number(a.word === last) - Number(b.word === last) ||
      Number(a.partner === lastPartner) - Number(b.partner === lastPartner) ||
      left(b) - left(a),
  );
  for (const q of open) {
    const same = q.word === last;
    if (same && run >= limit) continue;
    out.push(q.items[q.next++]);
    if (layOut(queues, limit, q.word, same ? run + 1 : 1, q.partner, out)) return true;
    out.pop();
    q.next--;
  }
  return false;
}

/** Stage and partner exercises mixed, also where they meet the part of the session before them. */
function mixed(own: GrammarExercise[], partners: GrammarExercise[], before: GrammarExercise[], rng: Rng): GrammarExercise[] {
  const pool = [...own, ...partners];
  const queues = shuffle([...new Set(pool.map((ex) => ex.connector))], rng).map(
    (word): Queue => ({
      word,
      partner: partners.some((ex) => ex.connector === word),
      items: pool.filter((ex) => ex.connector === word),
      next: 0,
    }),
  );
  const last = before.at(-1)?.connector;
  let run = 0;
  while (run < before.length && before[before.length - 1 - run].connector === last) run++;
  for (let limit = MAX_RUN; ; limit++) {
    const out: GrammarExercise[] = [];
    if (layOut(queues, limit, last, run, false, out)) return out;
  }
}

/**
 * Up to n exercises of a stage: what is due, then new builds word by word, then the contrast part,
 * where new picks, not yet due exercises and the partners' exercises are mixed.
 */
export function stageSession(
  stage: GrammarStage,
  all: GrammarExercise[],
  progress: Progress,
  now: number,
  rng: Rng = Math.random,
  n = STAGE_SESSION,
): GrammarExercise[] {
  const exercises = stageExercises(stage, all);
  if (!exercises.length || n <= 0) return [];
  const { due, fresh, later } = byState(exercises, progress, now, rng);
  const byWord = (list: GrammarExercise[]) => stage.words.map((word) => list.filter((ex) => ex.connector === word));

  const dueNow = due.slice(0, n);
  const newBuilds = fresh.filter((ex) => !isPick(ex));
  // Half of a short session stays free, so that it still reaches the contrast picks.
  const firstBuilds = inTurn(byWord(newBuilds)).slice(0, Math.min(NEW_BUILDS, Math.ceil(n / 2), n - dueNow.length));
  const opening = [...dueNow, ...byWord(firstBuilds).flat()];

  const room = n - opening.length;
  const partners = partnerExercises(stage, all, progress, now, rng);
  const restOfStage = [...inTurn(byWord(fresh.filter(isPick))), ...later, ...newBuilds.filter((ex) => !firstBuilds.includes(ex))];
  // The partners take at most half of the room, or what the stage can't fill.
  const own = restOfStage.slice(0, room - Math.min(partners.length, Math.floor(room / 2)));
  return [...opening, ...mixed(own, partners.slice(0, room - own.length), opening, rng)];
}

/** Only what is due, oldest first. Nothing due: nothing to review. */
export function reviewSession(all: GrammarExercise[], progress: Progress, now: number, n = STAGE_SESSION): GrammarExercise[] {
  return byState(all, progress, now, Math.random).due.slice(0, Math.max(0, n));
}

/**
 * Practice when nothing is asked for: the stages begun so far, soonest due first and then their
 * new exercises. Before any stage is begun, the first one.
 */
export function anywaySession(
  all: GrammarExercise[],
  stages: GrammarStage[],
  progress: Progress,
  now: number,
  rng: Rng = Math.random,
  n = STAGE_SESSION,
): GrammarExercise[] {
  const begun = stages.filter((stage) => stageExercises(stage, all).some((ex) => progress.has(ex.id)));
  if (!begun.length) return stages.length ? stageSession(stages[0], all, progress, now, rng, n) : [];
  const { seen, fresh } = byState(ofWords(begun.flatMap((stage) => stage.words), all), progress, now, rng);
  return [...seen, ...fresh].slice(0, Math.max(0, n));
}

export function wordStats(exercises: GrammarExercise[], progress: Progress, now: number): WordStats {
  const stats = topicStats(exercises, progress, now);
  return { ...stats, done: stats.total > 0 && stats.learned / stats.total >= DONE_RATIO };
}

/** `done` means every word is: a word with no exercises doesn't count, so an empty stage is done. */
export function stageStats(stage: GrammarStage, all: GrammarExercise[], progress: Progress, now: number): StageStats {
  const words = stage.words.map((word) => ({ word, stats: wordStats(wordExercises(word, all), progress, now) }));
  return {
    ...wordStats(stageExercises(stage, all), progress, now),
    words,
    done: words.every(({ stats }) => stats.done || stats.total === 0),
  };
}

export function currentStage(stages: GrammarStage[], all: GrammarExercise[], progress: Progress, now: number): GrammarStage | undefined {
  return stages.find((stage) => !stageStats(stage, all, progress, now).done);
}
