import type { Card, Review } from '../types';
import { endOfDay, isArticleCard, isVerbCard, modeApplies, type QuestionDir, type Rng, type StudyItem, type StudyMode } from './session';

/**
 * The smart ("Learn") session: pure queue logic, no DB/DOM, unit tested in smart.test.ts.
 *
 * Queue: due/overdue reviewed cards first (most overdue first, capped), then up to
 * `newPerSession` never-studied cards in source order. Known cards are skipped.
 *
 * Each item gets a mode picked from the card's state:
 *   new       → intro (full card, "Got it"); the same card comes back later as multiple choice
 *   learning  → choice or write, translation → German
 *   review    → write (direction alternates) or listen
 *   nouns with a gender / verbs with forms: 1 in 3 → articles / verbs
 * Wrong answers re-queue the item a few positions later. Only the first graded answer of each
 * card counts for SRS and the results (intros are not graded).
 */

export type SmartMode = StudyMode | 'intro';
export type CardState = 'new' | 'learning' | 'review';

export interface SmartItem extends StudyItem {
  mode: SmartMode;
}

/** Stability (days) below which a studied card is still "learning". */
export const LEARNING_STABILITY_DAYS = 7;
export const MAX_DUE = 30;

export function cardState(review: Review | undefined): CardState {
  if (!review || !review.fsrs || !review.fsrs.reps) return 'new';
  return review.fsrs.stability < LEARNING_STABILITY_DAYS ? 'learning' : 'review';
}

/**
 * Source order for new words: level words (presetId) by id — they are installed in frequency
 * order; user words by createdAt, then id.
 */
export function sourceOrder(a: Card, b: Card): number {
  if (a.presetId && b.presetId) return (a.id ?? 0) - (b.id ?? 0);
  return a.createdAt - b.createdAt || (a.id ?? 0) - (b.id ?? 0);
}

export interface PlanOptions {
  newPerSession: number;
  maxDue?: number;
  now?: Date | number;
}

export interface SmartPlan {
  /** Reviewed cards due by the end of today, most overdue first (capped). */
  due: Card[];
  /** Never-studied cards for this session, in source order. */
  fresh: Card[];
  /** Never-studied cards left over beyond `fresh`. */
  moreNew: number;
  /** Due cards left over beyond the cap. */
  moreDue: number;
}

/** Which cards a smart session asks, and in what order. */
export function planSmartQueue(
  cards: readonly Card[],
  reviews: ReadonlyMap<number, Review>,
  opts: PlanOptions,
): SmartPlan {
  const eod = endOfDay(opts.now ?? Date.now());
  const seen = new Set<number>();
  const due: { card: Card; at: number }[] = [];
  const fresh: Card[] = [];
  for (const c of cards) {
    if (c.known || !c.term.trim()) continue;
    if (c.id != null) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
    }
    const r = c.id == null ? undefined : reviews.get(c.id);
    if (!r) fresh.push(c);
    else if (r.due <= eod) due.push({ card: c, at: r.due });
  }
  due.sort((a, b) => a.at - b.at);
  fresh.sort(sourceOrder);
  const maxDue = opts.maxDue ?? MAX_DUE;
  const n = Math.max(0, opts.newPerSession);
  return {
    due: due.slice(0, maxDue).map((d) => d.card),
    fresh: fresh.slice(0, n),
    moreNew: Math.max(0, fresh.length - n),
    moreDue: Math.max(0, due.length - maxDue),
  };
}

export interface ModeContext {
  rng: Rng;
  /** Multiple choice needs at least 2 cards to draw options from. */
  canChoice: boolean;
  /** Speech synthesis available (listen mode). */
  canListen: boolean;
  /** Direction of the next review-state write question (alternates). */
  nextWriteDir: () => QuestionDir;
}

function applies(mode: StudyMode, card: Card, ctx: ModeContext): boolean {
  if (mode === 'choice' && !ctx.canChoice) return false;
  if (mode === 'listen' && !ctx.canListen) return false;
  return modeApplies(mode, card);
}

/** First applicable of `modes`, falling back to write/flashcards/listen. */
function firstApplicable(modes: StudyMode[], card: Card, ctx: ModeContext): StudyMode {
  for (const m of [...modes, 'write', 'flashcards', 'listen'] as StudyMode[]) if (applies(m, card, ctx)) return m;
  return 'listen';
}

/** Mode + direction for one question about `card`. */
export function chooseMode(card: Card, review: Review | undefined, ctx: ModeContext): { mode: SmartMode; dir: QuestionDir } {
  const state = cardState(review);
  if (state === 'new') return { mode: 'intro', dir: 'de-x' };
  if (isArticleCard(card) && ctx.rng() < 1 / 3) return { mode: 'articles', dir: 'de-x' };
  if (isVerbCard(card) && ctx.rng() < 1 / 3) return { mode: 'verbs', dir: 'de-x' };
  if (state === 'learning') {
    const pref: StudyMode[] = ctx.rng() < 0.5 ? ['choice', 'write'] : ['write', 'choice'];
    const mode = firstApplicable(pref, card, ctx);
    return { mode, dir: mode === 'listen' ? 'de-x' : 'x-de' };
  }
  const pref: StudyMode[] = ctx.rng() < 1 / 3 ? ['listen', 'write'] : ['write', 'listen'];
  const mode = firstApplicable(pref, card, ctx);
  return { mode, dir: mode === 'write' || mode === 'flashcards' ? ctx.nextWriteDir() : 'de-x' };
}

/** Mode for the question that follows an intro: multiple choice, else the closest fallback. */
export function followUpMode(card: Card, ctx: ModeContext): { mode: StudyMode; dir: QuestionDir } {
  const mode = firstApplicable(['choice'], card, ctx);
  return { mode, dir: mode === 'write' ? 'x-de' : 'de-x' };
}

export interface SmartSessionOptions extends PlanOptions {
  rng?: Rng;
  /** Number of cards multiple choice can draw options from (default: the session's cards). */
  poolSize?: number;
  canListen?: boolean;
  /** A wrong item comes back after this many other items (or at the end). */
  requeueGap?: number;
  /** The post-intro question comes after this many other items (or at the end). */
  introGap?: number;
}

export interface SmartOutcome {
  /** First graded answer for this card: record it in SRS. */
  first: boolean;
}

function keyOf(card: Card, fallback: number): number {
  return card.id ?? -1 - fallback;
}

export class SmartSession {
  readonly cards: Card[];
  readonly plan: SmartPlan;
  private queue: SmartItem[] = [];
  private index = 0;
  private seq = 0;
  private writeCount = 0;
  private readonly keys = new Map<Card, number>();
  private readonly firstResults = new Map<number, boolean>();
  private readonly completed = new Set<number>();
  private readonly introduced = new Set<number>();
  private readonly ctx: ModeContext;
  private readonly gap: number;
  private readonly introGap: number;

  constructor(cards: readonly Card[], reviews: ReadonlyMap<number, Review>, opts: SmartSessionOptions) {
    this.plan = planSmartQueue(cards, reviews, opts);
    this.cards = [...this.plan.due, ...this.plan.fresh];
    this.gap = Math.max(1, opts.requeueGap ?? 3);
    this.introGap = Math.max(1, opts.introGap ?? 3);
    this.ctx = {
      rng: opts.rng ?? Math.random,
      canChoice: (opts.poolSize ?? cards.length) >= 2,
      canListen: opts.canListen ?? true,
      nextWriteDir: () => (this.writeCount++ % 2 === 0 ? 'de-x' : 'x-de'),
    };
    this.cards.forEach((c, i) => this.keys.set(c, keyOf(c, i)));
    for (const card of this.cards) {
      const r = card.id == null ? undefined : reviews.get(card.id);
      const { mode, dir } = chooseMode(card, r, this.ctx);
      this.queue.push({ card, mode, dir, seq: this.seq++ });
    }
  }

  private key(card: Card): number {
    return this.keys.get(card) ?? keyOf(card, 0);
  }

  get current(): SmartItem | undefined {
    return this.queue[this.index];
  }

  /** Unique cards in the session. */
  get total(): number {
    return this.cards.length;
  }

  get empty(): boolean {
    return this.cards.length === 0;
  }

  /** Cards answered right (eventually). */
  get doneCount(): number {
    return this.completed.size;
  }

  /** 0…1 for the progress bar: an introduced card counts half. */
  get progress(): number {
    if (!this.total) return 1;
    let half = 0;
    for (const k of this.introduced) if (!this.completed.has(k)) half++;
    return Math.min(1, (this.completed.size + half / 2) / this.total);
  }

  get finished(): boolean {
    return this.index >= this.queue.length;
  }

  /** Items still to show, including the current one. */
  get remaining(): number {
    return this.queue.length - this.index;
  }

  /** Intro "Got it": not graded; the card comes back a few items later as a question. */
  seen(): void {
    const item = this.current;
    if (!item) throw new Error('Session finished');
    if (item.mode !== 'intro') throw new Error('Not an intro');
    this.introduced.add(this.key(item.card));
    this.index++;
    const { mode, dir } = followUpMode(item.card, this.ctx);
    const at = Math.min(this.index + this.introGap, this.queue.length);
    this.queue.splice(at, 0, { card: item.card, mode, dir, seq: this.seq++ });
  }

  /** Graded answer for the current (non-intro) item. */
  answer(correct: boolean): SmartOutcome {
    const item = this.current;
    if (!item) throw new Error('Session finished');
    if (item.mode === 'intro') throw new Error('Intro items are not graded; call seen()');
    const k = this.key(item.card);
    const first = !this.firstResults.has(k);
    if (first) this.firstResults.set(k, correct);
    this.index++;
    if (correct) {
      this.completed.add(k);
    } else {
      const at = Math.min(this.index + this.gap, this.queue.length);
      this.queue.splice(at, 0, { ...item, seq: this.seq++ });
    }
    return { first };
  }

  firstResult(card: Card): boolean | undefined {
    return this.firstResults.get(this.key(card));
  }

  get firstTryCorrect(): number {
    let n = 0;
    for (const ok of this.firstResults.values()) if (ok) n++;
    return n;
  }

  /** Cards whose first graded answer was wrong, in session order. */
  get missed(): Card[] {
    return this.cards.filter((c) => this.firstResults.get(this.key(c)) === false);
  }

  /** Cards that got a graded answer (all of them once the session is finished). */
  get graded(): number {
    return this.firstResults.size;
  }
}
