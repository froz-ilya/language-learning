/**
 * Motion helpers. Everything animates through these so "Reduce Motion" (iOS Settings →
 * Accessibility → Motion) turns animations off everywhere.
 *
 *   <li transition:fly={{ y: 8, duration: dur(200) }}>
 */
import { cubicOut } from 'svelte/easing';
import { fly, type FlyParams, type TransitionConfig } from 'svelte/transition';
import { pageArriving } from './pageLoad';

const query = typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)') : undefined;

export function reducedMotion(): boolean {
  return !!query?.matches;
}

/** Duration in ms, or 0 when the user prefers reduced motion. */
export function dur(ms: number): number {
  return reducedMotion() ? 0 : ms;
}

/**
 * Entrance of a block on a page: <div in:enter|global={{ y: 12, duration: dur(260) }}>. Blocks that
 * come with a navigation appear in place, because moving them too would fight the page transition.
 */
export function enter(node: Element, params: FlyParams = {}): TransitionConfig {
  return pageArriving() ? { duration: 0 } : fly(node, params);
}

/** Bottom sheet in and out, starting fully off screen whatever its height. */
export function slideUp(node: HTMLElement): TransitionConfig {
  return fly(node, { y: node.offsetHeight + 24, duration: dur(320), easing: cubicOut, opacity: 1 });
}

/** iOS-like ease-out curve for JS-driven animations (CSS uses var(--ease)). */
export function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
