import type { Card, Direction, Review } from '../types';

/**
 * Pure study-session logic (no DB, no DOM) so it can be unit tested.
 *
 * Queue rules:
 *  - cards are shuffled once when the session starts;
 *  - a wrong answer re-inserts the card a few positions later until it is answered right;
 *  - only the FIRST answer of each card counts for SRS and the results screen.
 */

export type Scope = 'due' | 'all';
export type StudyMode = 'flashcards' | 'write' | 'choice' | 'match' | 'listen' | 'articles' | 'verbs';
/** Per question: 'de-x' shows German and asks the translation, 'x-de' the other way round. */
export type QuestionDir = 'de-x' | 'x-de';
export type Rng = () => number;

export const STUDY_MODES: StudyMode[] = ['flashcards', 'write', 'choice', 'match', 'listen', 'articles', 'verbs'];

export function isStudyMode(s: string | undefined): s is StudyMode {
  return !!s && (STUDY_MODES as string[]).includes(s);
}

export function isDirection(s: string | null | undefined): s is Direction {
  return s === 'de-x' || s === 'x-de' || s === 'mixed';
}

/** Fisher–Yates on a copy. */
export function shuffle<T>(items: readonly T[], rng: Rng = Math.random): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function endOfDay(now: Date | number = Date.now()): number {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

/** Never reviewed, or due by the end of today. */
export function isDueOrNew(review: Review | undefined, now: Date | number = Date.now()): boolean {
  return !review || review.due <= endOfDay(now);
}

export function filterByScope(
  cards: Card[],
  reviews: ReadonlyMap<number, Review>,
  scope: Scope,
  now: Date | number = Date.now(),
): Card[] {
  if (scope === 'all') return cards;
  return cards.filter((c) => isDueOrNew(c.id == null ? undefined : reviews.get(c.id), now));
}

export function isArticleCard(c: Card): boolean {
  return c.pos === 'noun' && c.genders.length > 0;
}

export function isVerbCard(c: Card): boolean {
  return c.pos === 'verb' && !!(c.praeteritum.trim() || c.partizip2.trim());
}

/** Can this card be asked in this mode? */
export function modeApplies(mode: StudyMode, c: Card): boolean {
  if (!c.term.trim()) return false;
  switch (mode) {
    case 'listen':
      return true;
    case 'articles':
      return isArticleCard(c);
    case 'verbs':
      return isVerbCard(c);
    default:
      return !!c.translation.trim();
  }
}

export interface ModeAvailability {
  /** Cards this mode would ask. */
  count: number;
  /** Set when the mode can't be used. */
  reason?: string;
}

/**
 * `cards` are the cards in scope; `poolSize` is how many cards the source has in total
 * (multiple choice can borrow distractors from outside the scope).
 */
export function modeAvailability(mode: StudyMode, cards: Card[], poolSize = cards.length): ModeAvailability {
  const count = cards.filter((c) => modeApplies(mode, c)).length;
  if (mode === 'articles' && count === 0) return { count, reason: 'No nouns with der/die/das' };
  if (mode === 'verbs' && count === 0) return { count, reason: 'No verbs with Präteritum or Partizip II' };
  if (mode === 'match' && count < 2) return { count, reason: 'Needs at least 2 words' };
  if (mode === 'choice' && poolSize < 2) return { count, reason: 'Needs at least 2 words' };
  if (count === 0) return { count, reason: cards.length ? 'No words with a translation' : 'Nothing to study' };
  return { count };
}

export function resolveDirection(dir: Direction, rng: Rng = Math.random): QuestionDir {
  if (dir === 'mixed') return rng() < 0.5 ? 'de-x' : 'x-de';
  return dir;
}

export interface StudyItem {
  card: Card;
  dir: QuestionDir;
  /** Unique per presentation (a re-queued card gets a new seq). */
  seq: number;
}

export interface SessionOptions {
  direction?: Direction;
  rng?: Rng;
  /** A wrong card comes back after this many other cards (or at the end). */
  requeueGap?: number;
  /** Default true. */
  shuffle?: boolean;
}

export interface AnswerOutcome {
  /** First answer for this card in the session: record it in SRS. */
  first: boolean;
}

function keyOf(card: Card, fallback: number): number {
  return card.id ?? -1 - fallback;
}

export class Session {
  readonly cards: Card[];
  private queue: StudyItem[] = [];
  private index = 0;
  private seq = 0;
  private readonly keys = new Map<Card, number>();
  private readonly firstResults = new Map<number, boolean>();
  private readonly completed = new Set<number>();
  private readonly gap: number;

  constructor(cards: Card[], opts: SessionOptions = {}) {
    const rng = opts.rng ?? Math.random;
    this.gap = Math.max(1, opts.requeueGap ?? 3);
    this.cards = opts.shuffle === false ? cards.slice() : shuffle(cards, rng);
    this.cards.forEach((c, i) => this.keys.set(c, keyOf(c, i)));
    const direction = opts.direction ?? 'de-x';
    this.queue = this.cards.map((card) => ({ card, dir: resolveDirection(direction, rng), seq: this.seq++ }));
  }

  private key(card: Card): number {
    return this.keys.get(card) ?? keyOf(card, 0);
  }

  get current(): StudyItem | undefined {
    return this.queue[this.index];
  }

  /** Unique cards in the session. */
  get total(): number {
    return this.cards.length;
  }

  /** Cards answered right (eventually). */
  get doneCount(): number {
    return this.completed.size;
  }

  get finished(): boolean {
    return this.index >= this.queue.length;
  }

  /** Items still to show, including the current one (re-queued copies count). */
  get remaining(): number {
    return this.queue.length - this.index;
  }

  answer(correct: boolean): AnswerOutcome {
    const item = this.current;
    if (!item) throw new Error('Session finished');
    const k = this.key(item.card);
    const first = !this.firstResults.has(k);
    if (first) this.firstResults.set(k, correct);
    this.index++;
    if (correct) {
      this.completed.add(k);
    } else {
      const at = Math.min(this.index + this.gap, this.queue.length);
      this.queue.splice(at, 0, { card: item.card, dir: item.dir, seq: this.seq++ });
    }
    return { first };
  }

  /** First-try result of a card, or undefined if not answered yet. */
  firstResult(card: Card): boolean | undefined {
    return this.firstResults.get(this.key(card));
  }

  get firstTryCorrect(): number {
    let n = 0;
    for (const ok of this.firstResults.values()) if (ok) n++;
    return n;
  }

  /** Cards whose first answer was wrong, in session order. */
  get missed(): Card[] {
    return this.cards.filter((c) => this.firstResults.get(this.key(c)) === false);
  }
}
