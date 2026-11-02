import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { beginPage, endPage, LOAD_BUDGET_MS, pageArriving, pageLoaded, trackLoad } from './pageLoad';

describe('page load', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    endPage(beginPage());
    vi.useRealTimers();
  });

  it('resolves at once when the page reads nothing', async () => {
    beginPage();
    await expect(pageLoaded()).resolves.toBeUndefined();
  });

  it('waits for every read of the page', async () => {
    beginPage();
    const first = trackLoad();
    const second = trackLoad();
    let done = false;
    void pageLoaded().then(() => (done = true));
    first();
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);
    second();
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
  });

  it('gives up on a slow read after the budget', async () => {
    beginPage();
    trackLoad();
    let done = false;
    void pageLoaded().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(LOAD_BUDGET_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });

  it('a read of the previous page does not hold up the next one', async () => {
    beginPage();
    const old = trackLoad();
    beginPage();
    await expect(pageLoaded()).resolves.toBeUndefined();
    old(); // ending late is harmless
  });

  it('a read that ends twice counts once', async () => {
    beginPage();
    const first = trackLoad();
    trackLoad();
    let done = false;
    void pageLoaded().then(() => (done = true));
    first();
    first();
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);
  });

  it('is arriving from beginPage until endPage', () => {
    const id = beginPage();
    expect(pageArriving()).toBe(true);
    endPage(id);
    expect(pageArriving()).toBe(false);
  });

  it('an older navigation does not end a newer arrival', () => {
    const old = beginPage();
    const current = beginPage();
    expect(endPage(old)).toBe(false);
    expect(pageArriving()).toBe(true);
    expect(endPage(current)).toBe(true);
    expect(pageArriving()).toBe(false);
  });
});
