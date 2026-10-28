// App-wide background auto-fill: one queue for the whole app, so a fill started on import or
// with "Fill now" keeps going while the user moves around. Lives for the page session only:
// on app start nothing resumes by itself (the set page offers "Fill now" for leftovers).
import { db } from '../db/schema';
import { fillCards } from '../lookup/lookup';
import { online } from '../online.svelte';
import { settings } from '../settings.svelte';
import { showToast } from '../ui/dialogs.svelte';
import type { Card } from '../types';
import { createFillQueue, type FillCounts, type FillJobView } from './queue';

const state = $state<{ jobs: FillJobView[] }>({ jobs: [] });

const words = (n: number) => `${n} ${n === 1 ? 'word' : 'words'}`;

/** "Filled 27 words · 2 not found · 1 failed" */
export function finishMessage(c: FillCounts): string {
  const parts = [`Filled ${words(c.filled)}`];
  if (c.notFound) parts.push(`${c.notFound} not found`);
  if (c.failed) parts.push(`${c.failed} failed`);
  return parts.join(' · ');
}

const queue = createFillQueue({
  fill: fillCards,
  async loadCards(ids) {
    const cards = await db.cards.bulkGet(ids);
    return cards.filter((c): c is Card => !!c && c.needsFill === 1);
  },
  isOnline: () => online.value,
  lang: () => settings.lang,
  publish: (jobs) => (state.jobs = jobs),
  onFinish(_setId, counts) {
    if (counts.filled || counts.notFound || counts.failed) showToast(finishMessage(counts));
  },
  onError(_setId, e) {
    console.warn('auto-fill failed', e);
  },
});

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => queue.setOnline(true));
  window.addEventListener('offline', () => queue.setOnline(false));
}

/** The background fill of a set (running, queued or paused offline), or undefined. Reactive. */
export function fillJob(setId: number): FillJobView | undefined {
  return state.jobs.find((j) => j.setId === setId);
}

/** Fill these cards of a set in the background. */
export function fillInBackground(setId: number, cardIds: number[]): void {
  queue.enqueue(setId, cardIds);
}

/** Fill every card of a set that still needs details ("Fill now"), in the set's order. */
export async function fillSet(setId: number): Promise<number> {
  const cards = await db.cards.where('setId').equals(setId).filter((c) => c.needsFill === 1).toArray();
  cards.sort((a, b) => a.createdAt - b.createdAt || a.id! - b.id!);
  queue.enqueue(setId, cards.map((c) => c.id!));
  return cards.length;
}

export function cancelFill(setId: number): void {
  queue.cancel(setId);
}
