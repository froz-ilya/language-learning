/**
 * Motion helpers. Everything animates through these so "Reduce Motion" (iOS Settings →
 * Accessibility → Motion) turns animations off everywhere.
 *
 *   <li transition:fly={{ y: 8, duration: dur(200) }}>
 */
const query = typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)') : undefined;

export function reducedMotion(): boolean {
  return !!query?.matches;
}

/** Duration in ms, or 0 when the user prefers reduced motion. */
export function dur(ms: number): number {
  return reducedMotion() ? 0 : ms;
}

/** iOS-like ease-out curve for JS-driven animations (CSS uses var(--ease)). */
export function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
