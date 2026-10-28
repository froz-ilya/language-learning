import { describe, expect, it } from 'vitest';
import { createFillQueue, type FillFn, type FillJobView, type QueueDeps } from './queue';
import type { Card } from '../types';

const card = (id: number, setId: number): Card => ({
  id,
  setId,
  term: `w${id}`,
  translation: '',
  pos: 'other',
  genders: [],
  plural: '',
  praeteritum: '',
  partizip2: '',
  auxiliary: '',
  examples: [],
  notes: '',
  starred: 0,
  needsFill: 1,
  known: 0,
  presetId: '',
  createdAt: id,
});

const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * A fake database plus a fake fillCards that fills one card per `step()` (or right away when
 * `auto`), honouring the abort signal like the real one.
 */
function setup(opts: { auto?: boolean; chunk?: number; online?: boolean } = {}) {
  const db = new Map<number, Card>();
  const calls: { setId: number; ids: number[] }[] = [];
  const finished: { setId: number; counts: { filled: number; notFound: number; failed: number } }[] = [];
  const views: FillJobView[][] = [];
  let online = opts.online ?? true;
  let release: (() => void) | null = null;
  let active = 0;
  let maxActive = 0;

  const fill: FillFn = async (cards, _lang, onProgress, signal) => {
    calls.push({ setId: cards[0].setId, ids: cards.map((c) => c.id!) });
    active++;
    maxActive = Math.max(maxActive, active);
    const counts = { filled: 0, notFound: 0, failed: 0 };
    let done = 0;
    try {
      for (const c of cards) {
        if (signal?.aborted) break;
        if (!opts.auto) {
          await new Promise<void>((resolve) => {
            release = resolve;
            signal?.addEventListener(
              'abort',
              () => {
                release = null;
                resolve();
              },
              { once: true },
            );
          });
          if (signal?.aborted) break;
        }
        if (c.term.startsWith('x')) counts.notFound++;
        else counts.filled++;
        db.set(c.id!, { ...c, needsFill: 0 });
        onProgress?.(++done, cards.length);
      }
    } finally {
      active--;
    }
    return counts;
  };

  const deps: QueueDeps = {
    fill,
    loadCards: async (ids) => ids.map((id) => db.get(id)).filter((c): c is Card => !!c && c.needsFill === 1),
    isOnline: () => online,
    lang: () => 'ru',
    publish: (jobs) => views.push(jobs),
    onFinish: (setId, counts) => finished.push({ setId, counts }),
    chunk: opts.chunk,
  };
  const queue = createFillQueue(deps);

  return {
    queue,
    db,
    calls,
    finished,
    add(setId: number, ...ids: number[]) {
      for (const id of ids) db.set(id, card(id, setId));
      return ids;
    },
    /** Let the fake fill finish its current card. */
    async step(n = 1) {
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < 20 && !release; k++) await tick();
        const r = release;
        release = null;
        r?.();
        await tick();
        await tick();
      }
    },
    jobs: () => views[views.length - 1] ?? [],
    setOnline(v: boolean) {
      online = v;
      queue.setOnline(v);
    },
    get maxActive() {
      return maxActive;
    },
  };
}

describe('fill queue', () => {
  it('fills a set and reports progress, then finishes with counts', async () => {
    const t = setup();
    t.queue.enqueue(1, t.add(1, 1, 2, 3));
    expect(t.jobs()).toEqual([{ setId: 1, done: 0, total: 3, status: 'running' }]);
    await t.step();
    expect(t.jobs()[0]).toMatchObject({ done: 1, total: 3 });
    await t.step(2);
    await t.queue.idle();
    expect(t.jobs()).toEqual([]);
    expect(t.finished).toEqual([{ setId: 1, counts: { filled: 3, notFound: 0, failed: 0 } }]);
    expect([...t.db.values()].every((c) => c.needsFill === 0)).toBe(true);
  });

  it('runs one job at a time and queues the others', async () => {
    const t = setup();
    t.queue.enqueue(1, t.add(1, 1, 2));
    t.queue.enqueue(2, t.add(2, 10, 11));
    expect(t.jobs().map((j) => [j.setId, j.status])).toEqual([
      [1, 'running'],
      [2, 'queued'],
    ]);
    await t.step(2);
    expect(t.jobs().map((j) => [j.setId, j.status])).toEqual([[2, 'running']]);
    await t.step(2);
    await t.queue.idle();
    expect(t.maxActive).toBe(1);
    expect(t.calls.map((c) => c.setId)).toEqual([1, 2]);
    expect(t.finished.map((f) => f.setId)).toEqual([1, 2]);
  });

  it('adds cards to a set that already has a job instead of starting another', async () => {
    const t = setup();
    t.queue.enqueue(1, t.add(1, 1, 2));
    t.queue.enqueue(1, [...t.add(1, 3), 2]);
    expect(t.jobs()).toEqual([{ setId: 1, done: 0, total: 3, status: 'running' }]);
    await t.step(3);
    await t.queue.idle();
    expect(t.finished).toEqual([{ setId: 1, counts: { filled: 3, notFound: 0, failed: 0 } }]);
  });

  it('cancels the running job, keeping the rest for later, and moves on', async () => {
    const t = setup();
    t.queue.enqueue(1, t.add(1, 1, 2, 3));
    t.queue.enqueue(2, t.add(2, 10));
    await t.step();
    t.queue.cancel(1);
    expect(t.jobs().map((j) => j.setId)).toEqual([2]);
    await t.step();
    await t.queue.idle();
    expect(t.db.get(1)!.needsFill).toBe(0);
    expect(t.db.get(2)!.needsFill).toBe(1);
    expect(t.db.get(3)!.needsFill).toBe(1);
    // A cancelled job gets no "Filled …" toast; the next one does.
    expect(t.finished.map((f) => f.setId)).toEqual([2]);
  });

  it('cancels a queued job without running it', async () => {
    const t = setup();
    t.queue.enqueue(1, t.add(1, 1));
    t.queue.enqueue(2, t.add(2, 10));
    t.queue.cancel(2);
    expect(t.jobs().map((j) => j.setId)).toEqual([1]);
    await t.step();
    await t.queue.idle();
    expect(t.calls.map((c) => c.setId)).toEqual([1]);
  });

  it('pauses while offline and resumes where it stopped', async () => {
    const t = setup();
    t.queue.enqueue(1, t.add(1, 1, 2, 3));
    await t.step();
    t.setOnline(false);
    await t.queue.idle();
    expect(t.jobs()).toEqual([{ setId: 1, done: 1, total: 3, status: 'paused' }]);
    t.setOnline(true);
    await tick();
    expect(t.jobs()[0]).toMatchObject({ status: 'running', done: 1 });
    await t.step(2);
    await t.queue.idle();
    // Only the cards it hadn't got to were handed to fill again.
    expect(t.calls.map((c) => c.ids)).toEqual([
      [1, 2, 3],
      [2, 3],
    ]);
    expect(t.finished).toEqual([{ setId: 1, counts: { filled: 3, notFound: 0, failed: 0 } }]);
  });

  it('waits for the network when a job is added offline', async () => {
    const t = setup({ online: false, auto: true });
    t.queue.enqueue(1, t.add(1, 1, 2));
    await t.queue.idle();
    expect(t.calls).toEqual([]);
    expect(t.jobs()).toEqual([{ setId: 1, done: 0, total: 2, status: 'paused' }]);
    t.setOnline(true);
    await t.queue.idle();
    expect(t.finished).toEqual([{ setId: 1, counts: { filled: 2, notFound: 0, failed: 0 } }]);
  });

  it('fills in chunks re-read from the database, skipping cards deleted or filled meanwhile', async () => {
    const t = setup({ auto: true, chunk: 2 });
    const ids = t.add(1, 1, 2, 3, 4, 5);
    t.queue.enqueue(1, ids);
    t.db.delete(3);
    t.db.set(4, { ...t.db.get(4)!, needsFill: 0, translation: 'edited' });
    await t.queue.idle();
    expect(t.calls.map((c) => c.ids)).toEqual([[1, 2], [5]]);
    expect(t.db.get(4)!.translation).toBe('edited');
    expect(t.finished[0].counts.filled).toBe(3);
  });

  it('counts a chunk as failed when fill throws, and carries on', async () => {
    const t = setup({ auto: true, chunk: 1 });
    const errors: unknown[] = [];
    const queue = createFillQueue({
      fill: async (cards) => {
        if (cards[0].id === 1) throw new Error('boom');
        return { filled: 1, notFound: 0, failed: 0 };
      },
      loadCards: async (ids) => ids.map((id) => t.db.get(id)!).filter(Boolean),
      isOnline: () => true,
      lang: () => 'ru',
      publish: () => {},
      onFinish: (setId, counts) => t.finished.push({ setId, counts }),
      onError: (_s, e) => errors.push(e),
      chunk: 1,
    });
    queue.enqueue(1, t.add(1, 1, 2));
    await queue.idle();
    expect(errors).toHaveLength(1);
    expect(t.finished).toEqual([{ setId: 1, counts: { filled: 1, notFound: 0, failed: 1 } }]);
  });
});
