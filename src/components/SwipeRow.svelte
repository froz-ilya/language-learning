<script lang="ts" module>
  import type { IconName } from './Icon.svelte';

  export type SwipeAction = {
    label: string;
    icon?: IconName;
    tone: 'bad' | 'good' | 'accent' | 'warn';
    run: () => void;
  };

  /** Only one row is open at a time. */
  let closeOpenRow: (() => void) | null = null;
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  /**
   * iOS-style swipeable list row.
   *   left  — revealed by swiping LEFT (button on the right edge), e.g. Delete
   *   right — revealed by swiping RIGHT (button on the left edge), e.g. Mark known / Star
   * A full swipe (past FULL of the width) runs the action; a partial swipe snaps open to a
   * tappable button; tapping anywhere else closes it. Vertical scrolling is untouched.
   *
   *   <div class="list">
   *     <SwipeRow left={{ label: 'Delete', icon: 'trash', tone: 'bad', run: del }}>
   *       <button class="list-item">…</button>
   *     </SwipeRow>
   *   </div>
   */
  let { children, left, right }: { children: Snippet; left?: SwipeAction; right?: SwipeAction } = $props();

  const ACTION_W = 88;
  const FULL = 0.6;

  let row: HTMLDivElement;
  let offset = $state(0);
  let dragging = $state(false);
  let width = $state(0);

  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let startOffset = 0;
  /** 'pending' until we know whether this is a horizontal swipe or a scroll/tap. */
  let mode: 'idle' | 'pending' | 'swipe' | 'scroll' = 'idle';
  let suppressClick = false;

  const armed = $derived(width > 0 && Math.abs(offset) > width * FULL);
  /** Side currently revealed: 'end' = the `left` action (row moved left), 'start' = `right`. */
  const side = $derived(offset < 0 ? 'end' : offset > 0 ? 'start' : null);

  function setOpen(value: number) {
    offset = value;
    if (value !== 0) {
      if (closeOpenRow && closeOpenRow !== close) closeOpenRow();
      closeOpenRow = close;
    } else if (closeOpenRow === close) closeOpenRow = null;
  }

  function close() {
    setOpen(0);
  }

  function onpointerdown(e: PointerEvent) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!left && !right) return;
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    startOffset = offset;
    width = row.offsetWidth;
    mode = 'pending';
  }

  function resist(x: number) {
    // Allowed direction follows the finger; the other way rubber-bands a little.
    if (x < 0 && !left) return -Math.min(12, Math.sqrt(-x));
    if (x > 0 && !right) return Math.min(12, Math.sqrt(x));
    const max = width;
    return Math.max(-max, Math.min(max, x));
  }

  function onpointermove(e: PointerEvent) {
    if (e.pointerId !== pointerId || mode === 'idle' || mode === 'scroll') return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (mode === 'pending') {
      if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) {
        mode = 'scroll';
        return;
      }
      if (Math.abs(dx) < 8) return;
      mode = 'swipe';
      dragging = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      if (closeOpenRow && closeOpenRow !== close) closeOpenRow();
    }
    offset = resist(startOffset + dx);
  }

  function finish(action: SwipeAction | undefined, dir: -1 | 1) {
    if (!action) return close();
    // Slide all the way out, run, then come back (or the row unmounts, e.g. on delete).
    offset = dir * width;
    setTimeout(() => {
      action.run();
      close();
    }, 180);
  }

  function onpointerup(e: PointerEvent) {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    const wasSwipe = mode === 'swipe';
    mode = 'idle';
    dragging = false;
    if (!wasSwipe) return;
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 400);
    if (armed) return finish(offset < 0 ? left : right, offset < 0 ? -1 : 1);
    if (offset < -ACTION_W / 2 && left) setOpen(-ACTION_W);
    else if (offset > ACTION_W / 2 && right) setOpen(ACTION_W);
    else close();
  }

  function onpointercancel(e: PointerEvent) {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    mode = 'idle';
    dragging = false;
    if (Math.abs(offset) !== ACTION_W) close();
  }

  function onclickcapture(e: MouseEvent) {
    // A swipe or a tap on an open row must not also "click" the row content.
    if (suppressClick || offset !== 0) {
      e.preventDefault();
      e.stopPropagation();
      if (offset !== 0 && !suppressClick) close();
    }
  }

  // Tapping anywhere outside an open row closes it.
  $effect(() => {
    if (offset === 0 || dragging) return;
    const onDown = (e: PointerEvent) => {
      if (!row.contains(e.target as Node)) close();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  });

  $effect(() => () => {
    if (closeOpenRow === close) closeOpenRow = null;
  });

  function tap(action: SwipeAction) {
    action.run();
    close();
  }
</script>

<div class="swipe-row" bind:this={row}>
  {#if right}
    <div
      class="swipe-action start tone-{right.tone}"
      class:armed={armed && side === 'start'}
      style:width="{Math.max(0, offset)}px"
      aria-hidden={side !== 'start'}
    >
      <button tabindex={side === 'start' ? 0 : -1} onclick={() => tap(right)}>
        {#if right.icon}<Icon name={right.icon} size={20} />{/if}
        <span>{right.label}</span>
      </button>
    </div>
  {/if}
  {#if left}
    <div
      class="swipe-action end tone-{left.tone}"
      class:armed={armed && side === 'end'}
      style:width="{Math.max(0, -offset)}px"
      aria-hidden={side !== 'end'}
    >
      <button tabindex={side === 'end' ? 0 : -1} onclick={() => tap(left)}>
        {#if left.icon}<Icon name={left.icon} size={20} />{/if}
        <span>{left.label}</span>
      </button>
    </div>
  {/if}
  <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
  <div
    class="swipe-content"
    class:dragging
    style:transform={offset ? `translate3d(${offset}px, 0, 0)` : undefined}
    {onpointerdown}
    {onpointermove}
    {onpointerup}
    {onpointercancel}
    {onclickcapture}
  >
    {@render children()}
  </div>
</div>

<style>
  .swipe-row {
    position: relative;
    overflow: hidden;
    background: var(--surface);
  }
  :global(.swipe-row + .swipe-row)::before {
    content: '';
    position: absolute;
    z-index: 2;
    top: 0;
    left: 16px;
    right: 0;
    border-top: 1px solid var(--border);
    opacity: 0.7;
    pointer-events: none;
  }
  .swipe-content {
    position: relative;
    z-index: 1;
    background: var(--surface);
    touch-action: pan-y;
    transition: transform var(--dur) var(--ease);
  }
  .swipe-content.dragging {
    transition: none;
  }
  .swipe-action {
    position: absolute;
    top: 0;
    bottom: 0;
    display: flex;
    overflow: hidden;
    color: var(--on-tone);
    transition: width var(--dur) var(--ease);
  }
  .swipe-row:has(.swipe-content.dragging) .swipe-action {
    transition: none;
  }
  .swipe-action.start {
    left: 0;
    justify-content: flex-start;
  }
  .swipe-action.end {
    right: 0;
    justify-content: flex-end;
  }
  .swipe-action button {
    flex-shrink: 0;
    width: 88px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    border: 0;
    background: transparent;
    color: inherit;
    font-family: var(--font-display);
    font-size: 13px;
    font-weight: 800;
    cursor: pointer;
    transition: transform var(--dur-fast) var(--ease);
  }
  /* When armed (full swipe) the button rides along with the row edge. */
  .swipe-action.armed.start {
    justify-content: flex-end;
  }
  .swipe-action.armed.end {
    justify-content: flex-start;
  }
  .swipe-action.armed button {
    transform: scale(1.06);
  }
  .tone-bad {
    background: var(--bad);
  }
  .tone-good {
    background: var(--good);
  }
  .tone-accent {
    background: var(--accent);
  }
  .tone-warn {
    background: var(--warn);
  }
  @media (prefers-reduced-motion: reduce) {
    .swipe-content,
    .swipe-action,
    .swipe-action button {
      transition: none;
    }
  }
</style>
