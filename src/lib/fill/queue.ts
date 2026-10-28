// Background fill queue: one job per set, one job at a time, paused while offline. Pure logic
// with injected dependencies; the app-wide instance with reactive state lives in
// runner.svelte.ts.
import type { Card, Lang } from '../types';

export type FillFn = (
  cards: Card[],
  lang: Lang,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
) => Promise<{ filled: number; notFound: number; failed: number }>;

export interface FillCounts {
  filled: number;
  notFound: number;
  failed: number;
}

/** What a page shows for a set's job. */
export interface FillJobView {
  setId: number;
  done: number;
  total: number;
  /** running: filling now; queued: another set goes first; paused: offline, continues when back. */
  status: 'running' | 'queued' | 'paused';
}

export interface QueueDeps {
  fill: FillFn;
  /** The cards with these ids that still exist and still need filling, in the given order. */
  loadCards: (ids: number[]) => Promise<Card[]>;
  isOnline: () => boolean;
  lang: () => Lang;
  /** A job ran to the end (not cancelled). */
  onFinish?: (setId: number, counts: FillCounts) => void;
  /** fill threw (not an abort). The job goes on with the next cards. */
  onError?: (setId: number, error: unknown) => void;
  /** Called with the current jobs after every change (queue order, active job first). */
  publish: (jobs: FillJobView[]) => void;
  /**
   * Cards handed to `fill` per call. Small chunks are re-read from the database, so a card the
   * user edited or deleted meanwhile isn't overwritten from a stale copy.
   */
  chunk?: number;
}

interface Job {
  setId: number;
  /** Card ids still to fill, in order. */
  remaining: number[];
  total: number;
  done: number;
  counts: FillCounts;
  cancelled: boolean;
  paused: boolean;
  ctrl?: AbortController;
}

export interface FillQueue {
  /** Fill these cards of a set in the background (added to the set's job when it has one). */
  enqueue(setId: number, cardIds: number[]): void;
  /** Stop and drop a set's job; its cards keep needsFill for a later "Fill now". */
  cancel(setId: number): void;
  /** Network state changed: going offline pauses the running job, coming back resumes it. */
  setOnline(online: boolean): void;
  /** Resolves when nothing is running (queued jobs that wait for the network don't count). */
  idle(): Promise<void>;
}

export function createFillQueue(deps: QueueDeps): FillQueue {
  const chunk = Math.max(1, deps.chunk ?? 10);
  const jobs: Job[] = [];
  let pumping: Promise<void> | null = null;

  function publish() {
    deps.publish(
      jobs.filter((j) => !j.cancelled).map((j, i) => ({
        setId: j.setId,
        done: j.done,
        total: j.total,
        status: i === 0 ? (j.paused ? 'paused' : 'running') : 'queued',
      })),
    );
  }

  /** Runs the job until it is done ('done'), cancelled, or paused because the network went away. */
  async function run(job: Job): Promise<'done' | 'cancelled' | 'paused'> {
    while (job.remaining.length) {
      if (job.cancelled) return 'cancelled';
      if (!deps.isOnline()) return 'paused';
      const ids = job.remaining.slice(0, chunk);
      const cards = (await deps.loadCards(ids)).filter((c) => c.id !== undefined && ids.includes(c.id));
      if (job.cancelled) return 'cancelled';
      if (!deps.isOnline()) return 'paused';
      // Deleted or already filled meanwhile: nothing to do for those.
      const loaded = new Set(cards.map((c) => c.id!));
      job.remaining = job.remaining.filter((id) => !ids.includes(id) || loaded.has(id));
      const base = job.total - job.remaining.length;
      job.done = base;
      publish();
      if (!cards.length) continue;

      const ctrl = new AbortController();
      job.ctrl = ctrl;
      let processed = 0;
      try {
        const r = await deps.fill(
          cards,
          deps.lang(),
          (done) => {
            if (ctrl.signal.aborted) return;
            processed = Math.min(done, cards.length);
            job.done = base + processed;
            publish();
          },
          ctrl.signal,
        );
        job.counts.filled += r.filled;
        job.counts.notFound += r.notFound;
        job.counts.failed += r.failed;
      } catch (e) {
        if (!ctrl.signal.aborted) {
          job.counts.failed += cards.length - processed;
          deps.onError?.(job.setId, e);
        }
      } finally {
        job.ctrl = undefined;
      }
      if (ctrl.signal.aborted) {
        // Keep the cards fill didn't get to; ones it did are saved (or kept needsFill on failure).
        const finished = new Set(cards.slice(0, processed).map((c) => c.id!));
        job.remaining = job.remaining.filter((id) => !finished.has(id));
        job.done = job.total - job.remaining.length;
        publish();
        return job.cancelled ? 'cancelled' : 'paused';
      }
      const handled = new Set(cards.map((c) => c.id!));
      job.remaining = job.remaining.filter((id) => !handled.has(id));
      job.done = job.total - job.remaining.length;
      publish();
    }
    return job.cancelled ? 'cancelled' : 'done';
  }

  async function pumpLoop() {
    while (jobs.length) {
      const job = jobs[0];
      if (!deps.isOnline()) {
        job.paused = true;
        publish();
        return; // setOnline(true) starts again
      }
      job.paused = false;
      publish();
      const outcome = await run(job);
      if (outcome === 'paused' && !job.cancelled) {
        job.paused = true;
        publish();
        return;
      }
      jobs.splice(jobs.indexOf(job), 1);
      publish();
      if (outcome === 'done') deps.onFinish?.(job.setId, { ...job.counts });
    }
  }

  function pump() {
    if (!pumping) pumping = pumpLoop().finally(() => (pumping = null));
    return pumping;
  }

  return {
    enqueue(setId, cardIds) {
      const job = jobs.find((j) => j.setId === setId && !j.cancelled);
      if (job) {
        const added = cardIds.filter((id) => !job.remaining.includes(id));
        job.remaining.push(...added);
        job.total += added.length;
      } else if (cardIds.length) {
        jobs.push({
          setId,
          remaining: [...cardIds],
          total: cardIds.length,
          done: 0,
          counts: { filled: 0, notFound: 0, failed: 0 },
          cancelled: false,
          paused: false,
        });
      }
      publish();
      void pump();
    },
    cancel(setId) {
      const job = jobs.find((j) => j.setId === setId && !j.cancelled);
      if (!job) return;
      job.cancelled = true;
      job.ctrl?.abort();
      publish();
      if (jobs[0] !== job || !pumping) {
        // Not running right now (queued, or paused offline): just drop it.
        jobs.splice(jobs.indexOf(job), 1);
        publish();
        if (jobs.length && !pumping) void pump();
      }
    },
    setOnline(online) {
      if (online) {
        if (jobs.length) void pump();
      } else {
        jobs[0]?.ctrl?.abort();
      }
    },
    async idle() {
      while (pumping) await pumping;
    },
  };
}
