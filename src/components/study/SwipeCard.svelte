<script lang="ts" module>
  export type SwipeDir = 'left' | 'right';
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import { dur, reducedMotion } from '../../lib/motion';

  /**
   * A card you can drag sideways: it follows the finger with a slight rotation, a colored
   * hint fades in, and releasing past the threshold flies it off (right / left). Tap = `ontap`.
   * Vertical scrolling still works (touch-action: pan-y). Call `fling(dir)` to animate it
   * from a button.
   */
  let {
    children,
    onswipe,
    ontap,
    rightLabel = 'Knew it',
    leftLabel = 'Again',
    label = 'Card',
    disabled = false,
  }: {
    children: Snippet;
    onswipe: (dir: SwipeDir) => void;
    ontap?: () => void;
    rightLabel?: string;
    leftLabel?: string;
    /** Accessible name of the tap action. */
    label?: string;
    disabled?: boolean;
  } = $props();

  let el = $state<HTMLDivElement>();
  let width = $state(320);
  let dx = $state(0);
  let dy = $state(0);
  let dragging = $state(false);
  let animating = $state(false);
  let flying: SwipeDir | null = null;

  let tracking = false;
  let moved = false;
  let startX = 0;
  let startY = 0;
  let pointerId = -1;

  const threshold = $derived(Math.min(110, width * 0.28));
  const hint = $derived(Math.max(-1, Math.min(1, dx / threshold)));
  const rotation = $derived(dx / 16);

  function down(e: PointerEvent) {
    moved = false;
    if (disabled || flying || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if ((e.target as Element).closest('button, a, input, textarea')) return;
    tracking = true;
    animating = false;
    startX = e.clientX;
    startY = e.clientY;
    pointerId = e.pointerId;
  }

  function move(e: PointerEvent) {
    if (!tracking || e.pointerId !== pointerId) return;
    const x = e.clientX - startX;
    const y = e.clientY - startY;
    if (!dragging) {
      if (Math.abs(y) > 12 && Math.abs(y) > Math.abs(x)) {
        tracking = false; // vertical scroll
        return;
      }
      if (Math.abs(x) < 8) return;
      dragging = true;
      moved = true;
      el?.setPointerCapture(pointerId);
    }
    dx = x;
    dy = y * 0.25;
  }

  function release() {
    animating = true;
    dx = 0;
    dy = 0;
  }

  function up(e: PointerEvent) {
    if (!tracking || e.pointerId !== pointerId) return;
    tracking = false;
    if (!dragging) return;
    dragging = false;
    if (Math.abs(dx) >= threshold) fling(dx > 0 ? 'right' : 'left');
    else release();
  }

  function cancel() {
    tracking = false;
    if (dragging) {
      dragging = false;
      release();
    }
  }

  /** Fly the card off to one side, then report the swipe. */
  export function fling(dir: SwipeDir) {
    if (flying) return;
    flying = dir;
    if (reducedMotion()) {
      onswipe(dir);
      return;
    }
    animating = true;
    const sign = dir === 'right' ? 1 : -1;
    dx = sign * (window.innerWidth * 0.6 + width);
    dy = dy + 24;
    setTimeout(() => onswipe(dir), dur(240));
  }

  function click(e: MouseEvent) {
    if (moved) {
      moved = false;
      e.preventDefault();
      return;
    }
    if (!flying && !disabled) ontap?.();
  }

  function keydown(e: KeyboardEvent) {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      if (!flying && !disabled) ontap?.();
    }
  }
</script>

<div
  bind:this={el}
  bind:clientWidth={width}
  class="swipe"
  class:animating
  class:dragging
  role="button"
  tabindex="0"
  aria-label={label}
  style:transform="translate3d({dx}px, {dy}px, 0) rotate({rotation}deg)"
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={cancel}
  onlostpointercapture={cancel}
  onclick={click}
  onkeydown={keydown}
>
  {@render children()}
  <div class="hint right" aria-hidden="true" style:opacity={Math.max(0, hint)}>
    <span class="stamp">{rightLabel}</span>
  </div>
  <div class="hint left" aria-hidden="true" style:opacity={Math.max(0, -hint)}>
    <span class="stamp">{leftLabel}</span>
  </div>
</div>

<style>
  .swipe {
    position: relative;
    touch-action: pan-y;
    cursor: pointer;
    outline: none;
    -webkit-user-select: none;
    user-select: none;
    will-change: transform;
  }
  .swipe.dragging {
    cursor: grabbing;
  }
  .swipe.animating {
    transition: transform 0.24s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .swipe:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
    border-radius: var(--radius);
  }
  .hint {
    position: absolute;
    inset: 0;
    z-index: 2;
    pointer-events: none;
    border-radius: var(--radius);
    border: 3px solid;
    display: flex;
    align-items: flex-start;
    padding: 18px;
  }
  .hint.right {
    color: var(--good);
    border-color: var(--good);
    background: color-mix(in srgb, var(--good) 10%, transparent);
    justify-content: flex-start;
  }
  .hint.left {
    color: var(--bad);
    border-color: var(--bad);
    background: color-mix(in srgb, var(--bad) 10%, transparent);
    justify-content: flex-end;
  }
  .stamp {
    font-weight: 800;
    font-size: 20px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border: 3px solid currentColor;
    border-radius: 8px;
    padding: 2px 10px;
    background: var(--surface);
  }
  .right .stamp {
    transform: rotate(-10deg);
  }
  .left .stamp {
    transform: rotate(10deg);
  }
  @media (prefers-reduced-motion: reduce) {
    .swipe.animating {
      transition: none;
    }
  }
</style>
