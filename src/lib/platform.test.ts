import { describe, expect, it } from 'vitest';
import { canVibrate, isAndroid, isIOS, isStandalone } from './platform';
import { hapticPattern, HAPTIC_PATTERNS, vibrateFor } from './haptics';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const vibrate = () => true;

describe('platform detection', () => {
  it('detects iPhone and iPadOS (desktop UA + touch)', () => {
    expect(isIOS({ userAgent: IPHONE })).toBe(true);
    expect(isIOS({ userAgent: IPAD_DESKTOP_UA, maxTouchPoints: 5 })).toBe(true);
    expect(isIOS({ userAgent: IPAD_DESKTOP_UA, maxTouchPoints: 0 })).toBe(false);
    expect(isIOS({ userAgent: ANDROID })).toBe(false);
    expect(isIOS(undefined)).toBe(false);
  });

  it('detects Android by UA or client hints', () => {
    expect(isAndroid({ userAgent: ANDROID })).toBe(true);
    expect(isAndroid({ userAgent: DESKTOP, userAgentData: { platform: 'Android' } })).toBe(true);
    expect(isAndroid({ userAgent: IPHONE })).toBe(false);
    expect(isAndroid({ userAgent: DESKTOP })).toBe(false);
  });

  it('standalone from navigator.standalone or display-mode', () => {
    const no = () => ({ matches: false });
    const yes = () => ({ matches: true });
    expect(isStandalone({ standalone: true }, no)).toBe(true);
    expect(isStandalone({}, yes)).toBe(true);
    expect(isStandalone({}, no)).toBe(false);
    expect(isStandalone({}, undefined)).toBe(false);
  });

  it('vibration only where the API exists on Android', () => {
    expect(canVibrate({ userAgent: ANDROID, vibrate })).toBe(true);
    expect(canVibrate({ userAgent: ANDROID })).toBe(false);
    expect(canVibrate({ userAgent: IPHONE })).toBe(false);
    expect(canVibrate({ userAgent: DESKTOP, vibrate })).toBe(false);
  });
});

describe('answer haptics', () => {
  it('picks the pattern only when enabled and supported', () => {
    expect(hapticPattern('good', true, true)).toBe(12);
    expect(hapticPattern('bad', true, true)).toEqual([30, 40, 30]);
    expect(hapticPattern('good', false, true)).toBeNull();
    expect(hapticPattern('bad', true, false)).toBeNull();
  });

  it('calls navigator.vibrate with the pattern', () => {
    const calls: unknown[] = [];
    const nav = { userAgent: ANDROID, vibrate: (p: unknown) => (calls.push(p), true) };
    vibrateFor('bad', true, nav);
    vibrateFor('good', false, nav);
    vibrateFor('good', true, { userAgent: IPHONE, vibrate: (p: unknown) => (calls.push(p), true) });
    expect(calls).toEqual([HAPTIC_PATTERNS.bad]);
  });

  it('swallows errors from vibrate()', () => {
    const nav = {
      userAgent: ANDROID,
      vibrate: () => {
        throw new Error('blocked');
      },
    };
    expect(() => vibrateFor('good', true, nav)).not.toThrow();
  });
});
