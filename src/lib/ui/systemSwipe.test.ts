import { describe, expect, it } from 'vitest';
import { createSwipeTracker } from './systemSwipe';

const tracker = () => createSwipeTracker(() => 400);

describe('system swipe', () => {
  it('trusts the browser when it reports the transition', () => {
    expect(tracker().takeSwipe(true)).toBe(true);
    expect(tracker().takeSwipe(false)).toBe(false);
    expect(tracker().takeSwipe(undefined)).toBe(false);
  });

  it('counts a cancelled touch from either edge when the browser reports nothing', () => {
    for (const x of [4, 396]) {
      const t = tracker();
      t.touchStart(x);
      t.touchCancel();
      expect(t.takeSwipe(undefined)).toBe(true);
    }
  });

  it('answers once per swipe, so the next back press animates', () => {
    const t = tracker();
    t.touchStart(4);
    t.touchCancel();
    expect(t.takeSwipe(false)).toBe(true);
    expect(t.takeSwipe(false)).toBe(false);
  });

  it('ignores a cancelled touch away from the edges', () => {
    const t = tracker();
    t.touchStart(200);
    t.touchCancel();
    expect(t.takeSwipe(undefined)).toBe(false);
  });

  it('ignores a tap at the edge that ended normally', () => {
    const t = tracker();
    t.touchStart(10);
    expect(t.takeSwipe(undefined)).toBe(false);
  });

  it('a new touch clears an earlier cancelled swipe', () => {
    const t = tracker();
    t.touchStart(4);
    t.touchCancel();
    t.touchStart(200);
    expect(t.takeSwipe(undefined)).toBe(false);
  });
});
