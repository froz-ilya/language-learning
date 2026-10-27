import type { Attachment } from 'svelte/attachments';
import { cubicOut } from 'svelte/easing';
import { fly, type FlyParams, type TransitionConfig } from 'svelte/transition';
import { dur, reducedMotion } from '../motion';

/**
 * Answer feedback motion for the study modes (Web Animations API, so nothing extra is needed
 * in CSS). Every helper is a no-op when the user prefers reduced motion.
 *
 *   <div {@attach feedbackFx(correct === null ? null : correct ? 'good' : 'bad')}>
 */

export type FxKind = 'good' | 'bad' | null | undefined;

/** A CSS color variable as rgba(…, alpha); handles #rgb/#rrggbb (the app's tokens). */
function cssRgba(el: Element, name: string, fallback: string, alpha: number): string {
  let hex = (getComputedStyle(el).getPropertyValue(name).trim() || fallback).replace('#', '');
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join('');
  const n = parseInt(hex.slice(0, 6), 16);
  if (Number.isNaN(n)) return `rgba(31, 157, 85, ${alpha})`;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Short green glow + slight scale. */
export function pulseGood(el: Element): void {
  if (reducedMotion() || typeof el.animate !== 'function') return;
  el.animate(
    [
      { transform: 'scale(1)', boxShadow: `0 0 0 0 ${cssRgba(el, '--good', '#1f9d55', 0.55)}` },
      { transform: 'scale(1.025)', offset: 0.35 },
      { transform: 'scale(1)', boxShadow: `0 0 0 12px ${cssRgba(el, '--good', '#1f9d55', 0)}` },
    ],
    { duration: 420, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
  );
}

/** Horizontal shake. */
export function shake(el: Element): void {
  if (reducedMotion() || typeof el.animate !== 'function') return;
  el.animate(
    [
      { transform: 'translateX(0)' },
      { transform: 'translateX(-7px)' },
      { transform: 'translateX(6px)' },
      { transform: 'translateX(-4px)' },
      { transform: 'translateX(2px)' },
      { transform: 'translateX(0)' },
    ],
    { duration: 380, easing: 'ease-in-out' },
  );
}

/** Pulse on 'good', shake on 'bad'; runs whenever `kind` changes to one of them. */
export function feedbackFx(kind: FxKind): Attachment {
  return (el) => {
    if (kind === 'good') pulseGood(el);
    else if (kind === 'bad') shake(el);
  };
}

/** Incoming question: slides in from the right. */
export function slideIn(node: Element, params: FlyParams = {}): TransitionConfig {
  return fly(node, { x: 56, duration: dur(240), easing: cubicOut, ...params });
}

/** Outgoing question: slides out to the left and fades. */
export function slideOut(node: Element, params: FlyParams = {}): TransitionConfig {
  return fly(node, { x: -56, duration: dur(200), easing: cubicOut, ...params });
}
