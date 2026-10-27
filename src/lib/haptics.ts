import { canVibrate, type NavigatorLike } from './platform';

/**
 * Answer haptics (Android; iOS web apps have no Vibration API): a light tick on a correct
 * answer, a short double buzz on a wrong one.
 */

export type HapticKind = 'good' | 'bad';

export const HAPTIC_PATTERNS: Record<HapticKind, number | number[]> = {
  good: 12,
  bad: [30, 40, 30],
};

/** The pattern to play, or null when vibration is off or unsupported. */
export function hapticPattern(kind: HapticKind, enabled: boolean, supported: boolean): number | number[] | null {
  return enabled && supported ? HAPTIC_PATTERNS[kind] : null;
}

/** Vibrate for an answer when `enabled` (the user's setting) and the device supports it. */
export function vibrateFor(
  kind: HapticKind,
  enabled: boolean,
  nav: NavigatorLike | undefined = typeof navigator !== 'undefined' ? navigator : undefined,
): void {
  const pattern = hapticPattern(kind, enabled, canVibrate(nav));
  if (pattern === null || !nav) return;
  try {
    (nav.vibrate as (p: number | number[]) => boolean).call(nav, pattern);
  } catch {
    // blocked (e.g. no user activation yet): no feedback, nothing else to do
  }
}
