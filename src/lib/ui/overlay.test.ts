import { describe, expect, it } from 'vitest';
import { createOverlayStack, type OverlayStack } from './overlay';

/** Session history with asynchronous traversal (like browsers): go() only queues the move. */
function fakeHistory() {
  const entries: { state: unknown; url: string }[] = [{ state: { idx: 0 }, url: '/#/set/1' }];
  let index = 0;
  const queue: number[] = [];
  let onPop = () => {};
  const timers: (() => void)[] = [];
  const history = {
    get state() {
      return entries[index].state;
    },
    pushState(state: unknown, _: string, url?: string | null) {
      entries.splice(index + 1);
      entries.push({ state, url: url ?? entries[index].url });
      index++;
    },
    go(delta: number) {
      queue.push(delta);
    },
  };
  return {
    history,
    entries,
    get index() {
      return index;
    },
    /** Run queued traversals, firing popstate for each. */
    flush() {
      while (queue.length) {
        const d = queue.shift()!;
        index = Math.max(0, Math.min(entries.length - 1, index + d));
        onPop();
      }
    },
    /** The user presses back. */
    back() {
      history.go(-1);
      this.flush();
    },
    connect(stack: OverlayStack) {
      onPop = stack.onPopstate;
    },
    runTimers() {
      timers.splice(0).forEach((t) => t());
    },
    env() {
      return {
        history,
        href: () => entries[index].url,
        setTimeout: (fn: () => void) => timers.push(fn),
        clearTimeout: () => {},
      };
    },
  };
}

function setup() {
  const h = fakeHistory();
  const stack = createOverlayStack(h.env());
  h.connect(stack);
  return { h, stack };
}

describe('overlay stack', () => {
  it('pushes a same-URL entry that keeps the router state', () => {
    const { h, stack } = setup();
    stack.open(() => {});
    expect(h.entries).toHaveLength(2);
    expect(h.entries[1].url).toBe('/#/set/1');
    expect(h.entries[1].state).toMatchObject({ idx: 0, overlay: expect.any(Number) });
  });

  it('back closes the top overlay and stays on the page', () => {
    const { h, stack } = setup();
    let closed = 0;
    const handle = stack.open(() => {
      closed++;
      handle.release(); // components release when their open flag flips
    });
    h.back();
    expect(closed).toBe(1);
    expect(h.index).toBe(0);
    expect(stack.hasOpen()).toBe(false);
    // The next back is a normal navigation (nothing left to close).
    h.back();
    expect(closed).toBe(1);
  });

  it('closing by button drops the entry once, without calling close', () => {
    const { h, stack } = setup();
    let closed = 0;
    const handle = stack.open(() => closed++);
    handle.release();
    handle.release();
    expect(stack.isPending()).toBe(true);
    h.flush();
    expect(h.index).toBe(0);
    expect(closed).toBe(0);
    expect(stack.isPending()).toBe(false);
  });

  it('nested overlays close one per back press', () => {
    const { h, stack } = setup();
    const closed: string[] = [];
    const a = stack.open(() => (closed.push('sheet'), a.release()));
    const b = stack.open(() => (closed.push('dialog'), b.release()));
    expect(h.entries).toHaveLength(3);
    h.back();
    expect(closed).toEqual(['dialog']);
    h.back();
    expect(closed).toEqual(['dialog', 'sheet']);
    expect(h.index).toBe(0);
  });

  it('a dialog replacing another waits for the old entry to go before pushing', () => {
    const { h, stack } = setup();
    const first = stack.open(() => {});
    first.release(); // history.back() queued, not done yet
    stack.open(() => {});
    expect(h.entries).toHaveLength(2); // nothing pushed while the pop is in flight
    h.flush();
    expect(h.index).toBe(1);
    expect(h.entries).toHaveLength(2);
    expect(stack.hasOpen()).toBe(true);
  });

  it('navigation waits for overlay entries to be unwound', () => {
    const { h, stack } = setup();
    stack.open(() => {});
    stack.open(() => {});
    const ran: number[] = [];
    stack.unwind();
    stack.whenSettled(() => ran.push(h.index));
    expect(ran).toEqual([]);
    h.flush();
    expect(ran).toEqual([0]); // back on the page's own entry, ready to push the next page
  });

  it('runs immediately when nothing is pending', () => {
    const { stack } = setup();
    let ran = false;
    stack.whenSettled(() => (ran = true));
    expect(ran).toBe(true);
  });

  it('release after a navigation does not step back', () => {
    const { h, stack } = setup();
    const handle = stack.open(() => {});
    // A link pushed a new page on top of the overlay entry.
    h.history.pushState({ idx: 1 }, '', '/#/card/2');
    handle.release();
    expect(stack.isPending()).toBe(false);
    h.flush();
    expect(h.index).toBe(2);
  });

  it('settles after a timeout if the popstate never arrives', () => {
    const { h, stack } = setup();
    stack.open(() => {}).release();
    let ran = false;
    stack.whenSettled(() => (ran = true));
    expect(ran).toBe(false);
    h.runTimers();
    expect(ran).toBe(true);
  });
});
