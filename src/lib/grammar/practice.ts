import type { Rng } from '../study/session';
import type { BuildExercise, GrammarExercise, GrammarProgress } from './types';

/**
 * Pure grammar-practice logic (no DB, no DOM) so it can be unit tested. Imports only types:
 * study/session.ts loads i18n.svelte, hence the small shuffle of its own below.
 */

const DAY = 24 * 60 * 60 * 1000;
/** A mistake comes back this soon. */
const RETRY_MS = 10 * 60 * 1000;
/** A wrong answer comes back after this many other questions (or at the end). */
const REQUEUE_GAP = 3;

/** Days until the next review, by box: box 1 waits INTERVALS_DAYS[0]. */
export const INTERVALS_DAYS = [1, 3, 7, 21, 60];

export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const lower = (s: string) => s.toLocaleLowerCase('de');

/** The words of a text without punctuation; "E-Mail" and "geht's" stay one word. */
function wordsOf(text: string): string[] {
  return text.match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu) ?? [];
}

/** Two word lists are the same sentence when this matches. */
const sentenceKey = (words: string[]) => words.map(lower).join(' ');

function acceptedAnswer(ex: BuildExercise, picked: string[]): string | undefined {
  const key = sentenceKey(picked.flatMap(wordsOf));
  return ex.answers.find((a) => sentenceKey(wordsOf(a)) === key);
}

export function tilesOf(ex: BuildExercise): string[] {
  const words = wordsOf(ex.answers[0] ?? '');
  if (words.length && !ex.keepFirstCap) words[0] = lower(words[0]);
  return words;
}

export function checkBuild(ex: BuildExercise, picked: string[]): boolean {
  return acceptedAnswer(ex, picked) !== undefined;
}

/** Every distinct order of the tiles, one at a time. */
function* arrangements(tiles: string[]): Generator<string[]> {
  if (tiles.length < 2) {
    yield tiles;
    return;
  }
  const seen = new Set<string>();
  for (let i = 0; i < tiles.length; i++) {
    if (seen.has(tiles[i])) continue;
    seen.add(tiles[i]);
    const rest = [...tiles.slice(0, i), ...tiles.slice(i + 1)];
    for (const tail of arrangements(rest)) yield [tiles[i], ...tail];
  }
}

/**
 * The tiles in random order, never already solved unless every order is accepted. Few orders are
 * accepted, so reshuffling nearly always does it; walking the arrangements settles the rest.
 */
export function shuffledTiles(ex: BuildExercise, rng: Rng = Math.random): string[] {
  const tiles = tilesOf(ex);
  for (let i = 0; i < 8; i++) {
    const order = shuffle(tiles, rng);
    if (!checkBuild(ex, order)) return order;
  }
  for (const order of arrangements(tiles)) if (!checkBuild(ex, order)) return order;
  return tiles;
}

/** The whole sentence, in the order the learner built when that was accepted. */
export function modelAnswer(ex: BuildExercise, picked?: string[]): string {
  const answer = (picked && acceptedAnswer(ex, picked)) ?? ex.answers[0];
  return ex.given ? `${ex.given.trim()} ${answer}` : answer;
}

/** Full text of an exercise, for speech and feedback. */
export function fullSentence(ex: GrammarExercise): string {
  if (ex.kind === 'build') return modelAnswer(ex);
  const before = ex.before.trim();
  const answer = before ? ex.answer : ex.answer.charAt(0).toLocaleUpperCase('de') + ex.answer.slice(1);
  return [before, answer, ex.after.trim()]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+([,.!?;:])/g, '$1');
}

/**
 * The next state of an exercise after an answer. A right answer before the exercise is due proves
 * nothing new, so it only counts: a box is earned once per interval, and "learned" (box 2) takes
 * right answers on two different days.
 */
export function nextProgress(prev: GrammarProgress | undefined, id: string, ok: boolean, now: number): GrammarProgress {
  if (ok && prev && !isDue(prev, now)) return { ...prev, lastAt: now, right: prev.right + 1 };
  const box = ok ? Math.min((prev?.box ?? 0) + 1, INTERVALS_DAYS.length) : 0;
  return {
    id,
    box,
    due: now + (ok ? INTERVALS_DAYS[box - 1] * DAY : RETRY_MS),
    lastAt: now,
    right: (prev?.right ?? 0) + (ok ? 1 : 0),
    wrong: (prev?.wrong ?? 0) + (ok ? 0 : 1),
  };
}

export function isDue(p: GrammarProgress, now: number): boolean {
  return p.due <= now;
}

export function isLearned(p: GrammarProgress): boolean {
  return p.box >= 2;
}

export function topicStats(
  exercises: GrammarExercise[],
  progress: Map<string, GrammarProgress>,
  now: number,
): { total: number; learned: number; due: number; fresh: number; ratio: number } {
  let learned = 0;
  let started = 0;
  let due = 0;
  let fresh = 0;
  for (const ex of exercises) {
    const p = progress.get(ex.id);
    if (!p) {
      fresh++;
      continue;
    }
    if (isLearned(p)) learned++;
    else if (p.box === 1) started++;
    if (isDue(p, now)) due++;
  }
  const total = exercises.length;
  // A first right answer counts for half, so a good session moves the ring.
  return { total, learned, due, fresh, ratio: total ? (learned + started / 2) / total : 0 };
}

/**
 * Up to n exercises: due ones (oldest first), then new ones (level 1 before level 2, shuffled
 * within a level), then not yet due ones (soonest first), so practice is always possible. When
 * that leaves out a whole kind, the first of that kind takes the last place.
 */
export function pickExercises(
  pool: GrammarExercise[],
  progress: Map<string, GrammarProgress>,
  now: number,
  n = 10,
  rng: Rng = Math.random,
): GrammarExercise[] {
  const dueAt = (ex: GrammarExercise) => progress.get(ex.id)!.due;
  const practised = pool.filter((ex) => progress.has(ex.id)).sort((a, b) => dueAt(a) - dueAt(b));
  const fresh = pool.filter((ex) => !progress.has(ex.id));
  const ordered = [
    ...practised.filter((ex) => dueAt(ex) <= now),
    ...shuffle(fresh.filter((ex) => ex.level === 1), rng),
    ...shuffle(fresh.filter((ex) => ex.level !== 1), rng),
    ...practised.filter((ex) => dueAt(ex) > now),
  ];
  const picked = ordered.slice(0, Math.max(0, n));
  if (picked.length >= 2 && picked.every((ex) => ex.kind === picked[0].kind)) {
    const other = ordered.slice(picked.length).find((ex) => ex.kind !== picked[0].kind);
    if (other) picked[picked.length - 1] = other;
  }
  return picked;
}

/**
 * One practice run over exercises in the order given. A wrong answer asks the exercise again
 * later until it is answered right; only the first answer counts for the score.
 */
export class GrammarSession {
  private readonly exercises: GrammarExercise[];
  private readonly queue: GrammarExercise[];
  private index = 0;
  private readonly firstResults = new Map<string, boolean>();
  private readonly completed = new Set<string>();

  constructor(exercises: GrammarExercise[]) {
    this.exercises = exercises.slice();
    this.queue = exercises.slice();
  }

  get current(): GrammarExercise | undefined {
    return this.queue[this.index];
  }

  /** Unique exercises in the session. */
  get total(): number {
    return this.exercises.length;
  }

  /** Exercises answered right (eventually). */
  get doneCount(): number {
    return this.completed.size;
  }

  get firstTryCorrect(): number {
    let n = 0;
    for (const ok of this.firstResults.values()) if (ok) n++;
    return n;
  }

  /** Exercises whose first answer was wrong, in session order. */
  get missed(): GrammarExercise[] {
    return this.exercises.filter((ex) => this.firstResults.get(ex.id) === false);
  }

  get finished(): boolean {
    return this.index >= this.queue.length;
  }

  /** Grows with every question, also when an exercise comes back: a key for its component. */
  get seq(): number {
    return this.index;
  }

  answer(ok: boolean): { first: boolean } {
    const ex = this.current;
    if (!ex) throw new Error('Session finished');
    const first = !this.firstResults.has(ex.id);
    if (first) this.firstResults.set(ex.id, ok);
    this.index++;
    if (ok) {
      this.completed.add(ex.id);
    } else {
      this.queue.splice(Math.min(this.index + REQUEUE_GAP, this.queue.length), 0, ex);
    }
    return { first };
  }
}
