import { afterEach, describe, expect, it, vi } from 'vitest';
import { googleSentences, parseSentences } from './googlesentences';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseSentences', () => {
  it('reads a translation per sentence, with or without the detected language', () => {
    expect(parseSentences(['Eins. ', 'Zwei.'], 2)).toEqual(['Eins.', 'Zwei.']);
    expect(parseSentences([['One.', 'de'], ['Two.', 'de']], 2)).toEqual(['One.', 'Two.']);
  });

  it('is null for another number of translations or an unknown shape', () => {
    expect(parseSentences(['One.'], 2)).toBeNull();
    expect(parseSentences({ text: 'One.' }, 1)).toBeNull();
    expect(parseSentences([1], 1)).toBeNull();
  });
});

describe('googleSentences', () => {
  const run = (sentences: string[]) => googleSentences.run({ sentences, from: 'de', to: 'ru' }, new AbortController().signal);

  it('sends every sentence as its own q', async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const qs = new URLSearchParams(String(init?.body)).getAll('q');
      return new Response(JSON.stringify(qs.map((q) => `RU: ${q}`)));
    });
    vi.stubGlobal('fetch', fetch);
    expect(await run(['Er knüpfte an.', 'Wir & ihr?'])).toEqual(['RU: Er knüpfte an.', 'RU: Wir & ihr?']);
    expect(new URL(fetch.mock.calls[0][0]).host).toBe('clients5.google.com');
  });

  it('has no answer when every sentence comes back unchanged', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(['Hallo.']))));
    expect(await run(['Hallo.'])).toBeNull();
  });

  it('fails on a rate limit or a reply of another length', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 429 })));
    await expect(run(['Eins.'])).rejects.toMatchObject({ status: 429, refusal: true });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(['One.']))));
    await expect(run(['Eins.', 'Zwei.'])).rejects.toMatchObject({ refusal: true });
  });
});
