/**
 * Multi-source fallback: try providers in order; a provider that errors, times out or is
 * rate-limited (429/302/403/5xx) is skipped for a cooldown period, and the next one is asked.
 *
 * Rules:
 * - `null` from a provider means "no answer": the next one is asked, no penalty.
 * - A thrown error (except a SourceError marked as a plain miss, e.g. HTTP 404), a timeout or a
 *   refusal puts the provider in cooldown for 10 min. Failing again soon after a cooldown ends
 *   doubles it, up to 60 min. A success clears it.
 * - Cooling providers are skipped; when every provider of a chain is cooling, the one whose
 *   cooldown ends first is tried anyway.
 * - While the device reports itself offline, network providers (all but 'local') are skipped
 *   without a penalty.
 * - Caller aborts propagate as AbortError and never cause a cooldown.
 * - Cooldowns persist in localStorage (`sources:cooldowns`).
 */
export type ProviderId =
  | 'local'
  | 'de.wiktionary'
  | 'en.wiktionary'
  | 'google'
  | 'mymemory'
  | 'miniklexikon'
  | 'klexikon'
  | 'wikinews'
  | 'wikipedia'
  | 'gutenberg';

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  local: 'Offline dictionary',
  'de.wiktionary': 'Wiktionary (DE)',
  'en.wiktionary': 'Wiktionary (EN)',
  google: 'Google Translate',
  mymemory: 'MyMemory',
  miniklexikon: 'MiniKlexikon',
  klexikon: 'Klexikon',
  wikinews: 'Wikinews',
  wikipedia: 'Wikipedia',
  gutenberg: 'Project Gutenberg',
};

export interface Provider<I, O> {
  id: ProviderId;
  /** Return null when this provider has no answer (not an error: the chain moves on). */
  run: (input: I, signal: AbortSignal) => Promise<O | null>;
  /** Per-provider timeout in ms (default 4000). */
  timeoutMs?: number;
}

export interface ChainResult<O> {
  value: O;
  via: ProviderId;
}

/** What happened during one chain run (for callers that must tell "not found" from "unavailable"). */
export interface ChainOutcome<O> {
  result: ChainResult<O> | null;
  /** Providers that failed during this run (error, timeout, refusal) and are now cooling. */
  failed: ProviderId[];
  /** Providers not asked because they were cooling or the device is offline. */
  skipped: ProviderId[];
}

export const DEFAULT_TIMEOUT_MS = 4000;
const MIN = 60_000;
export const BASE_COOLDOWN_MS = 10 * MIN;
export const MAX_COOLDOWN_MS = 60 * MIN;
const STORAGE_KEY = 'sources:cooldowns';

// ---------- Errors ----------

/** Statuses that mean "this source refuses us right now" (rate limit, captcha redirect, block, outage). */
export function isRefusalStatus(status: number | undefined): boolean {
  return status === undefined || status === 302 || status === 403 || status === 429 || status >= 500;
}

/**
 * Typed provider error carrying the HTTP status. `refusal` decides whether the chain puts the
 * provider in cooldown; by default 302/403/429/5xx (and errors without a status) are refusals,
 * other statuses (e.g. 404) are a plain miss.
 */
export class SourceError extends Error {
  readonly status?: number;
  readonly refusal: boolean;
  constructor(message: string, opts: { status?: number; refusal?: boolean } = {}) {
    super(message);
    this.name = 'SourceError';
    this.status = opts.status;
    this.refusal = opts.refusal ?? isRefusalStatus(opts.status);
  }
}

/** Throw a SourceError for a non-OK (or redirected) fetch response. */
export function checkResponse(res: Response, label: string): void {
  if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
    throw new SourceError(`${label} redirected the request`, { status: 302 });
  }
  if (!res.ok) throw new SourceError(`${label} error ${res.status}`, { status: res.status });
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms} ms`);
    this.name = 'TimeoutError';
  }
}

// ---------- Cooldown state ----------

interface Cooldown {
  /** Epoch ms when the provider may be tried again. */
  until: number;
  /** Length of the current cooldown (doubles on repeated failures). */
  ms: number;
  error?: string;
}

let state: Partial<Record<ProviderId, Cooldown>> | null = null;

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function load(): Partial<Record<ProviderId, Cooldown>> {
  if (state) return state;
  state = {};
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, Cooldown>) : {};
    for (const [id, c] of Object.entries(parsed)) {
      if (id in PROVIDER_LABELS && typeof c?.until === 'number' && typeof c?.ms === 'number') {
        state[id as ProviderId] = { until: c.until, ms: c.ms, error: typeof c.error === 'string' ? c.error : undefined };
      }
    }
  } catch {
    // Corrupt or unavailable storage: start clean.
  }
  return state;
}

function save(): void {
  try {
    const s = storage();
    if (!s) return;
    const st = load();
    if (Object.keys(st).length) s.setItem(STORAGE_KEY, JSON.stringify(st));
    else s.removeItem(STORAGE_KEY);
  } catch {
    // Storage full / blocked: cooldowns stay in memory only.
  }
}

function coolingUntil(id: ProviderId, now = Date.now()): number | null {
  const c = load()[id];
  return c && c.until > now ? c.until : null;
}

function markFailed(id: ProviderId, error: unknown): void {
  const st = load();
  const now = Date.now();
  const prev = st[id];
  // Failing while cooling, or soon (within one cooldown length) after it ended: double it.
  const repeat = prev && now < prev.until + prev.ms;
  const ms = repeat ? Math.min(prev.ms * 2, MAX_COOLDOWN_MS) : BASE_COOLDOWN_MS;
  const message = error instanceof Error ? error.message : String(error);
  st[id] = { until: now + ms, ms, error: message.slice(0, 200) };
  save();
}

function markOk(id: ProviderId, forced: boolean): void {
  const st = load();
  const c = st[id];
  if (!c) return;
  // Don't let a request that started before a concurrent failure clear a fresh cooldown.
  if (forced || c.until <= Date.now()) {
    delete st[id];
    save();
  }
}

/** Is this provider currently skipped after failures? */
export function isCooling(id: ProviderId): boolean {
  return coolingUntil(id) !== null;
}

function isOffline(): boolean {
  try {
    return typeof navigator !== 'undefined' && navigator.onLine === false;
  } catch {
    return false;
  }
}

// ---------- Running ----------

async function attempt<I, O>(p: Provider<I, O>, input: I, signal?: AbortSignal): Promise<O | null> {
  const ms = p.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort(new TimeoutError(PROVIDER_LABELS[p.id], ms));
  }, ms);
  const onAbort = () => ctrl.abort(abortError());
  signal?.addEventListener('abort', onAbort, { once: true });

  // Race the provider against the abort, in case it ignores its signal.
  const aborted = new Promise<never>((_, reject) => {
    ctrl.signal.addEventListener(
      'abort',
      () => reject(timedOut ? new TimeoutError(PROVIDER_LABELS[p.id], ms) : abortError()),
      { once: true },
    );
  });
  aborted.catch(() => {});
  try {
    const run = Promise.resolve().then(() => p.run(input, ctrl.signal));
    run.catch(() => {});
    return await Promise.race([run, aborted]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Like runChain, but also reports which providers failed or were skipped. */
export async function runChainDetailed<I, O>(
  _capability: string,
  providers: Provider<I, O>[],
  input: I,
  signal?: AbortSignal,
): Promise<ChainOutcome<O>> {
  if (signal?.aborted) throw abortError();
  const outcome: ChainOutcome<O> = { result: null, failed: [], skipped: [] };

  const offline = isOffline();
  const usable = providers.filter((p) => {
    if (offline && p.id !== 'local') {
      outcome.skipped.push(p.id);
      return false;
    }
    return true;
  });

  const now = Date.now();
  let queue = usable.filter((p) => coolingUntil(p.id, now) === null);
  let forced = false;
  if (!queue.length && usable.length) {
    // Everything is cooling: ask the one that recovers first rather than nobody.
    const soonest = usable.reduce((a, b) => (coolingUntil(b.id, now)! < coolingUntil(a.id, now)! ? b : a));
    queue = [soonest];
    forced = true;
  }
  for (const p of usable) if (!queue.includes(p)) outcome.skipped.push(p.id);

  for (const p of queue) {
    try {
      const value = await attempt(p, input, signal);
      markOk(p.id, forced);
      if (value !== null && value !== undefined) {
        outcome.result = { value, via: p.id };
        return outcome;
      }
    } catch (e) {
      if (signal?.aborted) throw abortError();
      if (e instanceof SourceError && !e.refusal) continue; // plain miss (e.g. 404)
      markFailed(p.id, e);
      outcome.failed.push(p.id);
    }
  }
  return outcome;
}

/** Run providers in order; returns the first non-null result, or null if all had no answer/failed. */
export async function runChain<I, O>(
  capability: string,
  providers: Provider<I, O>[],
  input: I,
  signal?: AbortSignal,
): Promise<ChainResult<O> | null> {
  return (await runChainDetailed(capability, providers, input, signal)).result;
}

export interface ProviderState {
  id: ProviderId;
  label: string;
  /** 'ok', or 'cooling' while skipped after failures. */
  state: 'ok' | 'cooling';
  /** Epoch ms when a cooling provider will be tried again. */
  until?: number;
  lastError?: string;
}

/** Status of every known provider (for Settings → Sources). */
export function providerStatus(): ProviderState[] {
  const st = load();
  const now = Date.now();
  return (Object.keys(PROVIDER_LABELS) as ProviderId[]).map((id) => {
    const c = st[id];
    const s: ProviderState = { id, label: PROVIDER_LABELS[id], state: c && c.until > now ? 'cooling' : 'ok' };
    if (c && c.until > now) s.until = c.until;
    if (c?.error) s.lastError = c.error;
    return s;
  });
}

/** Clear all cooldowns (Settings → Sources → "Retry all"). */
export function resetProviders(): void {
  state = {};
  save();
}
