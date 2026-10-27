import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BASE_COOLDOWN_MS,
  MAX_COOLDOWN_MS,
  PROVIDER_LABELS,
  SourceError,
  isCooling,
  providerStatus,
  resetProviders,
  runChain,
  runChainDetailed,
  type Provider,
  type ProviderId,
} from './chain';

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => void m.delete(k),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
  };
}

const answer = (id: ProviderId, value: string | null) => {
  const run = vi.fn(async (_input: string, _signal: AbortSignal) => value);
  return { id, run } satisfies Provider<string, string>;
};
const failing = (id: ProviderId, error: unknown = new TypeError('Failed to fetch')) => {
  const run = vi.fn(async (): Promise<string | null> => {
    throw error;
  });
  return { id, run } satisfies Provider<string, string>;
};
const hanging = (id: ProviderId, timeoutMs?: number) => {
  const run = vi.fn(
    (_: string, signal: AbortSignal) =>
      new Promise<string | null>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))),
  );
  return { id, run, timeoutMs } satisfies Provider<string, string>;
};
const status = (id: ProviderId) => providerStatus().find((s) => s.id === id)!;

let storage: Storage;
beforeEach(() => {
  storage = memoryStorage();
  vi.stubGlobal('localStorage', storage);
  resetProviders();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('runChain', () => {
  it('returns the first answer, in order', async () => {
    const a = answer('google', 'A');
    const b = answer('mymemory', 'B');
    expect(await runChain('t', [a, b], 'x')).toEqual({ value: 'A', via: 'google' });
    expect(b.run).not.toHaveBeenCalled();
    expect(a.run.mock.calls[0][0]).toBe('x');
  });

  it('moves on after null without a penalty', async () => {
    const a = answer('google', null);
    const b = answer('mymemory', 'B');
    expect(await runChain('t', [a, b], 'x')).toEqual({ value: 'B', via: 'mymemory' });
    expect(isCooling('google')).toBe(false);
  });

  it('returns null when nobody answers', async () => {
    const o = await runChainDetailed('t', [answer('google', null), answer('mymemory', null)], 'x');
    expect(o).toEqual({ result: null, failed: [], skipped: [] });
  });

  it('puts a throwing provider in cooldown and skips it next time', async () => {
    const a = failing('google');
    const b = answer('mymemory', 'B');
    expect(await runChainDetailed('t', [a, b], 'x')).toEqual({
      result: { value: 'B', via: 'mymemory' },
      failed: ['google'],
      skipped: [],
    });
    expect(status('google')).toMatchObject({ state: 'cooling', lastError: 'Failed to fetch' });
    const o = await runChainDetailed('t', [a, b], 'x');
    expect(o.skipped).toEqual(['google']);
    expect(a.run).toHaveBeenCalledTimes(1);
  });

  it('cools down on HTTP 429/302/403/5xx but not on a plain 404 miss', async () => {
    for (const [code, cools] of [
      [429, true],
      [302, true],
      [403, true],
      [503, true],
      [404, false],
    ] as const) {
      resetProviders();
      const b = answer('mymemory', 'B');
      await runChain('t', [failing('google', new SourceError(`HTTP ${code}`, { status: code })), b], 'x');
      expect(isCooling('google'), `status ${code}`).toBe(cools);
      expect(b.run).toHaveBeenCalled();
    }
  });

  it('cools down a provider that times out', async () => {
    vi.useFakeTimers();
    const slow = hanging('de.wiktionary', 1000);
    const b = answer('en.wiktionary', 'B');
    const p = runChain('t', [slow, b], 'x');
    await vi.advanceTimersByTimeAsync(1000);
    expect(await p).toEqual({ value: 'B', via: 'en.wiktionary' });
    expect(status('de.wiktionary')).toMatchObject({ state: 'cooling' });
    expect(status('de.wiktionary').lastError).toMatch(/timed out/);
  });

  it('times out after 4 s by default, even if the provider ignores its signal', async () => {
    vi.useFakeTimers();
    const deaf = { id: 'google' as const, run: vi.fn(() => new Promise<string | null>(() => {})) };
    const p = runChain('t', [deaf, answer('mymemory', 'B')], 'x');
    await vi.advanceTimersByTimeAsync(3999);
    expect(isCooling('google')).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toEqual({ value: 'B', via: 'mymemory' });
    expect(isCooling('google')).toBe(true);
  });

  it('doubles the cooldown on repeated failures, up to 60 minutes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const a = failing('google');
    const lengths: number[] = [];
    for (let i = 0; i < 5; i++) {
      await runChain('t', [a], 'x'); // Only provider: tried even while cooling.
      lengths.push(status('google').until! - Date.now());
      vi.advanceTimersByTime(lengths.at(-1)! + 1000); // Just after the cooldown ends.
    }
    expect(lengths).toEqual([BASE_COOLDOWN_MS, 2 * BASE_COOLDOWN_MS, 4 * BASE_COOLDOWN_MS, MAX_COOLDOWN_MS, MAX_COOLDOWN_MS]);
  });

  it('starts over at 10 minutes after a long quiet period or a success', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const a = failing('google');
    await runChain('t', [a], 'x');
    vi.advanceTimersByTime(3 * BASE_COOLDOWN_MS);
    await runChain('t', [a], 'x');
    expect(status('google').until! - Date.now()).toBe(BASE_COOLDOWN_MS);

    vi.advanceTimersByTime(BASE_COOLDOWN_MS + 1);
    await runChain('t', [answer('google', 'ok')], 'x');
    expect(status('google')).toEqual({ id: 'google', label: 'Google Translate', state: 'ok' });
    await runChain('t', [a], 'x');
    expect(status('google').until! - Date.now()).toBe(BASE_COOLDOWN_MS);
  });

  it('when every provider is cooling, tries the one whose cooldown ends first', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    await runChain('t', [failing('mymemory')], 'x');
    vi.advanceTimersByTime(60_000);
    await runChain('t', [failing('google')], 'x');
    const g = answer('google', 'G');
    const m = answer('mymemory', 'M');
    const o = await runChainDetailed('t', [g, m], 'x');
    expect(o.result).toEqual({ value: 'M', via: 'mymemory' });
    expect(o.skipped).toEqual(['google']);
    expect(g.run).not.toHaveBeenCalled();
    // A success clears that cooldown.
    expect(isCooling('mymemory')).toBe(false);
    expect(isCooling('google')).toBe(true);
  });

  it('propagates a caller abort as AbortError without a cooldown', async () => {
    const ctrl = new AbortController();
    const slow = hanging('google');
    const p = runChain('t', [slow, answer('mymemory', 'B')], 'x', ctrl.signal);
    ctrl.abort(new Error('custom reason'));
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(isCooling('google')).toBe(false);
    await expect(runChain('t', [answer('google', 'A')], 'x', ctrl.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('skips network providers offline, without a penalty', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const net = answer('google', 'G');
    const local = answer('local', 'L');
    const o = await runChainDetailed('t', [net, local], 'x');
    expect(o).toEqual({ result: { value: 'L', via: 'local' }, failed: [], skipped: ['google'] });
    expect(net.run).not.toHaveBeenCalled();
    expect(isCooling('google')).toBe(false);
  });
});

describe('provider status', () => {
  it('covers every provider', () => {
    const s = providerStatus();
    expect(s.map((x) => x.id).sort()).toEqual((Object.keys(PROVIDER_LABELS) as ProviderId[]).sort());
    expect(s.every((x) => x.state === 'ok')).toBe(true);
  });

  it('resetProviders clears cooldowns', async () => {
    await runChain('t', [failing('google')], 'x');
    expect(isCooling('google')).toBe(true);
    resetProviders();
    expect(isCooling('google')).toBe(false);
    expect(storage.getItem('sources:cooldowns')).toBeNull();
  });

  it('persists cooldowns in localStorage across reloads', async () => {
    await runChain('t', [failing('google', new SourceError('HTTP 429', { status: 429 }))], 'x');
    const saved = JSON.parse(storage.getItem('sources:cooldowns')!);
    expect(saved.google).toMatchObject({ ms: BASE_COOLDOWN_MS, error: 'HTTP 429' });

    vi.resetModules();
    const fresh = await import('./chain');
    expect(fresh.isCooling('google')).toBe(true);
    expect(fresh.providerStatus().find((x) => x.id === 'google')).toMatchObject({ state: 'cooling', lastError: 'HTTP 429' });
  });

  it('works when localStorage throws', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    });
    vi.resetModules();
    const fresh = await import('./chain');
    await fresh.runChain('t', [failing('google')], 'x');
    expect(fresh.isCooling('google')).toBe(true);
  });
});
