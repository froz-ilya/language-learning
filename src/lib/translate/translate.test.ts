import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isCooling, resetProviders } from '../sources/chain';
import {
  HISTORY_MAX,
  MAX_TRANSLATE_CHARS,
  addHistory,
  clearHistory,
  clearTranslateCache,
  loadHistory,
  normalizeVersion,
  removeHistory,
  splitForBytes,
  translate,
  type HistoryItem,
  type TranslateOutcome,
} from './translate';

// All texts here are invented for the tests.

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

type Reply = ((q: string) => string) | 'fail' | 429 | 'hang';

interface Mock {
  google?: Reply;
  /** The same endpoint with client=dict-chrome-ex (its own rate limit); fails when not set. */
  googleChrome?: Reply;
  googleDict?: unknown;
  /** Raw md / ex blocks (indexes 12, 13) Google adds for dt=md / dt=ex. */
  googleExtras?: [unknown, unknown];
  googleExt?: Reply;
  mymemory?: Reply;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function mockFetch(opts: Mock) {
  const calls = { google: [] as string[], googleChrome: [] as string[], googleExt: [] as string[], mymemory: [] as string[], dt: [] as string[][] };
  const fail = (r: Reply | undefined, signal?: AbortSignal | null): Promise<Response> | Response | null => {
    if (r === undefined || r === 'fail') throw new TypeError('Failed to fetch');
    if (r === 429) return json({}, 429);
    if (r === 'hang')
      return new Promise((_, reject) => signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    return null;
  };
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    init?.signal?.throwIfAborted();
    const url = new URL(input);
    if (url.host === 'translate.googleapis.com') {
      const q = url.searchParams.get('q') ?? new URLSearchParams(String(init?.body ?? '')).get('q') ?? '';
      const chrome = url.searchParams.get('client') === 'dict-chrome-ex';
      const reply = chrome ? opts.googleChrome : opts.google;
      (chrome ? calls.googleChrome : calls.google).push(q);
      calls.dt.push(url.searchParams.getAll('dt'));
      const f = fail(reply, init?.signal);
      if (f) return f;
      const body: unknown[] = [[[(reply as (q: string) => string)(q), q]], opts.googleDict ?? null, 'de'];
      if (opts.googleExtras && url.searchParams.getAll('dt').includes('md')) {
        while (body.length < 12) body.push(null);
        body.push(...opts.googleExtras);
      }
      return json(body);
    }
    if (url.host === 'clients5.google.com') {
      const q = new URLSearchParams(String(init?.body ?? '')).getAll('q');
      calls.googleExt.push(q.join('|'));
      const f = fail(opts.googleExt, init?.signal);
      if (f) return f;
      return json(q.map((s) => (opts.googleExt as (q: string) => string)(s)));
    }
    if (url.host === 'api.mymemory.translated.net') {
      const q = url.searchParams.get('q')!;
      calls.mymemory.push(q);
      const f = fail(opts.mymemory, init?.signal);
      if (f) return f;
      const text = (opts.mymemory as (q: string) => string)(q);
      return json({ responseData: { translatedText: text }, quotaFinished: false, responseDetails: '', responseStatus: 200 });
    }
    throw new Error(`unexpected ${input}`);
  });
  vi.stubGlobal('fetch', fetch);
  return calls;
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  resetProviders();
  clearTranslateCache();
});
afterEach(() => vi.unstubAllGlobals());

const SENTENCE = 'Die Katze sitzt auf dem roten Sofa.';

describe('translate', () => {
  it('takes the main version from Google and alternatives from MyMemory', async () => {
    const calls = mockFetch({ google: () => 'Кошка сидит на красном диване.', mymemory: () => 'Кот сидит на красном диване' });
    const updates: TranslateOutcome[] = [];
    const out = await translate(SENTENCE, 'de', 'ru', { onUpdate: (o) => updates.push(o) });
    expect(out.main).toEqual({ text: 'Кошка сидит на красном диване.', via: 'google' });
    expect(out.alternatives).toEqual([{ text: 'Кот сидит на красном диване', via: 'mymemory' }]);
    expect(out.unavailable).toBe(false);
    expect(out.done).toBe(true);
    expect(calls.googleExt).toEqual([]); // Google's second endpoint is the same engine
    expect(updates[0].main?.via).toBe('google');
    expect(updates[0].done).toBe(false);
    expect(updates.at(-1)?.done).toBe(true);
  });

  it('passes Google’s dictionary for a single word', async () => {
    mockFetch({ google: () => 'кружка', googleDict: [['noun', ['кружка', 'чашка']]], mymemory: (q) => q });
    const out = await translate('Becher', 'de', 'ru');
    expect(out.dict).toEqual([{ pos: 'noun', terms: ['кружка', 'чашка'] }]);
    expect(out.alternatives).toEqual([]); // MyMemory echoed: no alternative
  });

  it('falls back to Google’s second endpoint, then MyMemory, and cools the failing ones', async () => {
    mockFetch({ google: 429, googleExt: () => 'Кошка сидит на диване.', mymemory: () => 'Кошка сидит на диване!' });
    const out = await translate(SENTENCE, 'de', 'ru');
    expect(out.main).toEqual({ text: 'Кошка сидит на диване.', via: 'google.ext' });
    expect(out.alternatives).toEqual([]); // same after normalising
    expect(isCooling('google')).toBe(true);

    clearTranslateCache();
    resetProviders();
    const calls = mockFetch({ google: 'fail', googleExt: 'fail', mymemory: () => 'Кошка на диване.' });
    const out2 = await translate(SENTENCE, 'de', 'ru');
    expect(out2.main).toEqual({ text: 'Кошка на диване.', via: 'mymemory' });
    // Google's providers are cooling now, so no alternative is asked from them.
    expect(calls.google).toHaveLength(1);
    expect(calls.googleExt).toHaveLength(1);
    expect(out2.alternatives).toEqual([]);
  });

  it('asks Google’s extension client when gtx is rate-limited', async () => {
    const calls = mockFetch({
      google: 429,
      googleChrome: () => 'лестница',
      googleDict: [['noun', ['лестница', 'стремянка'], [], 'Leiter', 1]],
    });
    const out = await translate('die Leiter', 'de', 'ru');
    expect(out.main).toEqual({ text: 'лестница', via: 'google.dict' });
    expect(out.dict).toEqual([{ pos: 'noun', terms: ['лестница', 'стремянка'] }]);
    expect(isCooling('google')).toBe(true);
    expect(calls.googleExt).toEqual([]);
  });

  it('asks for German definitions and examples of a German word only', async () => {
    const calls = mockFetch({
      google: () => 'ударяться',
      googleExtras: [
        [['verb', [['heftig gegen etwas stoßen', '1', 'mit dem Kopf gegen die Tür <b>prallen</b>'], ['grell scheinen', '2']], 'prallen', 2]],
        [[['der Ball <b>prallt</b> gegen die Wand', null, null, null, null, '1']]],
      ],
    });
    const out = await translate('prallen', 'de', 'ru');
    expect(out.definitions).toEqual([
      { pos: 'verb', gloss: 'heftig gegen etwas stoßen', example: 'mit dem Kopf gegen die Tür prallen' },
      { pos: 'verb', gloss: 'grell scheinen' },
    ]);
    expect(out.examples).toEqual(['der Ball prallt gegen die Wand']);
    expect(calls.dt[0]).toEqual(['t', 'bd', 'md', 'ex']);

    // Not for a sentence, and not when German is the target.
    const more = mockFetch({ google: () => 'x' });
    await translate('Der Hund schläft heute sehr lange.', 'de', 'ru');
    await translate('собака', 'ru', 'de');
    expect(more.dt.every((dt) => !dt.includes('md'))).toBe(true);
  });

  it('asks Google for an alternative when MyMemory gave the main one', async () => {
    mockFetch({ google: () => 'Котик сидит на диване.', googleExt: () => 'Котик сидит на диване.', mymemory: () => 'Кошка на диване.' });
    // Every Google endpoint misses (404, no cooldown) the first time, so MyMemory gives the main version.
    const fetchMock = vi.mocked(globalThis.fetch as (input: string, init?: RequestInit) => Promise<Response>);
    const real = fetchMock.getMockImplementation()!;
    let missed = 0;
    fetchMock.mockImplementation(async (input: string, init?: RequestInit) => {
      if (new URL(input).host !== 'api.mymemory.translated.net' && missed < 3) {
        missed++;
        return json({}, 404);
      }
      return real(input, init);
    });
    const out = await translate(SENTENCE, 'de', 'ru');
    expect(out.main).toEqual({ text: 'Кошка на диване.', via: 'mymemory' });
    expect(out.alternatives).toEqual([{ text: 'Котик сидит на диване.', via: 'google' }]);
  });

  it('dedupes alternatives against main after normalising', () => {
    expect(normalizeVersion('  Кошка   сидит. ')).toBe(normalizeVersion('кошка сидит'));
    expect(normalizeVersion('Да!?')).toBe('да');
  });

  it('skips cooling providers for alternatives', async () => {
    mockFetch({ google: () => 'Кошка сидит на диване.', mymemory: 'fail' });
    await translate('Ein anderer Satz.', 'de', 'ru');
    expect(isCooling('mymemory')).toBe(true);
    const calls = mockFetch({ google: () => 'Кошка сидит на диване.', mymemory: () => 'Другое' });
    const out = await translate(SENTENCE, 'de', 'ru');
    expect(calls.mymemory).toEqual([]);
    expect(out.alternatives).toEqual([]);
  });

  it('asks MyMemory for alternatives only for short text', async () => {
    const calls = mockFetch({ google: (q) => q.toUpperCase(), mymemory: () => 'другое' });
    const long = 'Ein langer Satz ohne Ende, '.repeat(30);
    const out = await translate(long, 'de', 'ru');
    expect(out.main?.via).toBe('google');
    expect(calls.mymemory).toEqual([]);
  });

  it('is unavailable when every service fails, and offline', async () => {
    mockFetch({ google: 'fail', googleExt: 'fail', mymemory: 'fail' });
    const out = await translate(SENTENCE, 'de', 'ru');
    expect(out).toEqual({ main: null, alternatives: [], dict: [], definitions: [], examples: [], unavailable: true, done: true });

    resetProviders();
    vi.stubGlobal('navigator', { onLine: false });
    const calls = mockFetch({ google: () => 'x' });
    const off = await translate('Noch ein Satz.', 'de', 'ru');
    expect(off.unavailable).toBe(true);
    expect(calls.google).toEqual([]);
  });

  it('treats an echo from every service as the text itself', async () => {
    mockFetch({ google: (q) => q, mymemory: (q) => q });
    const out = await translate('Okay', 'de', 'en');
    expect(out.main).toEqual({ text: 'Okay', via: 'google' });
    expect(out.alternatives).toEqual([]);
    expect(out.unavailable).toBe(false);
  });

  it('stops on abort without cooldowns', async () => {
    mockFetch({ google: 'hang' });
    const ctrl = new AbortController();
    const p = translate(SENTENCE, 'de', 'ru', { signal: ctrl.signal });
    setTimeout(() => ctrl.abort(), 10);
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(isCooling('google')).toBe(false);

    const updates: TranslateOutcome[] = [];
    mockFetch({ google: () => 'Кошка.', mymemory: 'hang' });
    const ctrl2 = new AbortController();
    const p2 = translate('Die Katze.', 'de', 'ru', {
      signal: ctrl2.signal,
      onUpdate: (o) => {
        updates.push(o);
        setTimeout(() => ctrl2.abort(), 0);
      },
    });
    await expect(p2).rejects.toMatchObject({ name: 'AbortError' });
    expect(isCooling('mymemory')).toBe(false);
    expect(updates).toHaveLength(1);
  });

  it('caches results and caps the input', async () => {
    const calls = mockFetch({ google: (q) => `[${q.length}]`, mymemory: (q) => q });
    await translate(SENTENCE, 'de', 'ru');
    await translate(SENTENCE, 'de', 'ru');
    expect(calls.google).toHaveLength(1);
    await translate('x'.repeat(MAX_TRANSLATE_CHARS + 100), 'de', 'ru');
    expect(calls.google[1]).toHaveLength(MAX_TRANSLATE_CHARS);
  });

  it('splits long text for MyMemory at sentence ends', async () => {
    const text = 'Der erste Satz ist hier. '.repeat(30).trim();
    const pieces = splitForBytes(text, 500)!;
    expect(pieces.join('')).toBe(text);
    expect(pieces.every((p) => new TextEncoder().encode(p).length <= 500)).toBe(true);
    expect(pieces.every((p) => p.trim().endsWith('.'))).toBe(true);
    expect(splitForBytes('ä'.repeat(300), 500)).toBeNull();

    const calls = mockFetch({ google: 'fail', googleExt: 'fail', mymemory: (q) => q.replace(/Der erste Satz ist hier\./g, 'Первое.') });
    const out = await translate(text, 'de', 'ru');
    expect(out.main?.via).toBe('mymemory');
    expect(calls.mymemory.length).toBe(pieces.length);
    expect(out.main?.text).toBe(Array(30).fill('Первое.').join(' '));
  });
});

describe('history', () => {
  const item = (text: string, at: number, from: HistoryItem['from'] = 'de', to: HistoryItem['to'] = 'ru'): HistoryItem => ({
    from,
    to,
    text,
    result: `[${text}]`,
    at,
  });

  it('reads garbage as empty', () => {
    for (const raw of ['not json', '{"a":1}', '42', 'null']) {
      localStorage.setItem('translate:history', raw);
      expect(loadHistory()).toEqual([]);
    }
    localStorage.setItem('translate:history', JSON.stringify([item('Haus', 1), { from: 'xx', to: 'ru', text: 'a', result: '', at: 2 }, null, 'x']));
    expect(loadHistory()).toEqual([item('Haus', 1)]);
  });

  it('keeps newest first, dedupes and caps', () => {
    addHistory(item('eins', 1));
    addHistory(item('zwei', 2));
    addHistory(item('eins', 3, 'de', 'en'));
    addHistory(item('eins', 4));
    expect(loadHistory().map((i) => [i.text, i.to, i.at])).toEqual([
      ['eins', 'ru', 4],
      ['eins', 'en', 3],
      ['zwei', 'ru', 2],
    ]);
    for (let i = 0; i < 40; i++) addHistory(item(`Wort ${i}`, 10 + i));
    const h = loadHistory();
    expect(h).toHaveLength(HISTORY_MAX);
    expect(h[0].text).toBe('Wort 39');
    removeHistory(49);
    expect(loadHistory()[0].text).toBe('Wort 38');
    clearHistory();
    expect(loadHistory()).toEqual([]);
  });
});
