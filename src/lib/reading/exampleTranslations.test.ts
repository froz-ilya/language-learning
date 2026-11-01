import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/schema';
import { fillTiming } from '../lookup/lookup';
import { isCooling, resetProviders } from '../sources/chain';
import type { Example } from '../types';
import { translateArticleExamples } from './exampleTranslations';
import { buildCard } from './store';

const ARTICLE_SET = 7;
const OTHER_SET = 8;

const addCard = (term: string, examples: Example[], setId = ARTICLE_SET) =>
  db.cards.add({ ...buildCard(setId, { term, translation: 'x' }), examples }) as Promise<number>;

const examplesOf = async (id: number) => (await db.cards.get(id))!.examples;

/** Google answering "RU: <line>" for every line, and what it was asked. */
function stubGoogle(onRequest?: () => void | Promise<void>) {
  const asked: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      if (url.host !== 'translate.googleapis.com') throw new TypeError('Failed to fetch');
      const q = url.searchParams.get('q') ?? new URLSearchParams(String(init?.body)).get('q')!;
      asked.push(q);
      await onRequest?.();
      const text = q.split('\n').map((l) => `RU: ${l}`).join('\n');
      return new Response(JSON.stringify([[[text, q]], null, 'de']));
    }),
  );
  return asked;
}

beforeEach(async () => {
  await Promise.all([db.cards.clear(), db.articles.clear()]);
  await db.articles.add({
    id: 'paste:a',
    source: 'paste',
    title: 'Text',
    paragraphs: ['Ein Satz.'],
    url: '',
    license: '',
    attribution: '',
    level: '',
    savedAt: 1,
    readAt: 0,
    setId: ARTICLE_SET,
    progress: 0,
    openedAt: 0,
  });
  resetProviders();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('translateArticleExamples', () => {
  it('translates the sentence a word was read in, however the card stored its missing translation', async () => {
    const asked = stubGoogle();
    const built = (await db.cards.add(buildCard(ARTICLE_SET, { term: 'Haus', translation: 'дом' }, 'Das Haus ist alt.'))) as number;
    const edited = await addCard('alt', [{ de: 'Er ist alt.', tr: '' }]);
    await translateArticleExamples('ru');
    expect(await examplesOf(built)).toEqual([{ de: 'Das Haus ist alt.', tr: 'RU: Das Haus ist alt.' }]);
    expect(await examplesOf(edited)).toEqual([{ de: 'Er ist alt.', tr: 'RU: Er ist alt.' }]);
    expect(asked).toEqual(['Das Haus ist alt.\nEr ist alt.']);
  });

  it('keeps translations a card has, and leaves cards of other sets alone', async () => {
    const asked = stubGoogle();
    const mixed = await addCard('Haus', [{ de: 'Neu.' }, { de: 'Alt.', tr: 'старое' }]);
    const other = await addCard('Tisch', [{ de: 'Mein Satz.' }], OTHER_SET);
    await translateArticleExamples('ru');
    expect(await examplesOf(mixed)).toEqual([{ de: 'Neu.', tr: 'RU: Neu.' }, { de: 'Alt.', tr: 'старое' }]);
    expect(await examplesOf(other)).toEqual([{ de: 'Mein Satz.' }]);
    expect(asked).toEqual(['Neu.']);
  });

  it('translates a sentence once for all the words that share it', async () => {
    const asked = stubGoogle();
    const a = await addCard('Haus', [{ de: 'Das Haus ist alt.' }]);
    const b = await addCard('alt', [{ de: 'Das Haus ist alt.' }]);
    await translateArticleExamples('ru');
    expect(asked).toEqual(['Das Haus ist alt.']);
    expect((await examplesOf(a))[0].tr).toBe('RU: Das Haus ist alt.');
    expect((await examplesOf(b))[0].tr).toBe('RU: Das Haus ist alt.');
  });

  it('asks nothing when nothing is missing', async () => {
    const asked = stubGoogle();
    await addCard('Haus', [{ de: 'Satz.', tr: 'фраза' }]);
    await addCard('Tisch', []);
    await translateArticleExamples('ru');
    expect(asked).toEqual([]);
  });

  it('keeps a line break in a sentence from shifting the translations', async () => {
    stubGoogle();
    const a = await addCard('Haus', [{ de: 'Ein\nHaus.' }]);
    const b = await addCard('alt', [{ de: 'Alt.' }]);
    await translateArticleExamples('ru');
    expect((await examplesOf(a))[0]).toEqual({ de: 'Ein\nHaus.', tr: 'RU: Ein Haus.' });
    expect((await examplesOf(b))[0].tr).toBe('RU: Alt.');
  });

  it('keeps what the user did while the translation was on its way', async () => {
    let translated = 0;
    let changed = 0;
    let deleted = 0;
    stubGoogle(async () => {
      await db.cards.update(translated, { examples: [{ de: 'Eins.', tr: 'моё' }] });
      await db.cards.update(changed, { examples: [{ de: 'Anders.' }] });
      await db.cards.delete(deleted);
    });
    translated = await addCard('a', [{ de: 'Eins.' }]);
    changed = await addCard('b', [{ de: 'Zwei.' }]);
    deleted = await addCard('c', [{ de: 'Drei.' }]);
    await translateArticleExamples('ru');
    expect(await examplesOf(translated)).toEqual([{ de: 'Eins.', tr: 'моё' }]);
    expect(await examplesOf(changed)).toEqual([{ de: 'Anders.' }]);
    expect(await db.cards.get(deleted)).toBeUndefined();
  });

  it('leaves the sentence untranslated when no service answers, for a later run', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const id = await addCard('Haus', [{ de: 'Das Haus ist alt.' }]);
    await translateArticleExamples('ru');
    expect(await examplesOf(id)).toEqual([{ de: 'Das Haus ist alt.' }]);

    resetProviders();
    stubGoogle();
    await translateArticleExamples('ru');
    expect((await examplesOf(id))[0].tr).toBe('RU: Das Haus ist alt.');
  });

  it('leaves sources in cooldown alone, without forcing a retry', async () => {
    const failing = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', failing);
    await addCard('Haus', [{ de: 'Das Haus ist alt.' }]);
    await translateArticleExamples('ru');
    expect(isCooling('google') && isCooling('mymemory')).toBe(true);

    failing.mockClear();
    await translateArticleExamples('ru');
    expect(failing).not.toHaveBeenCalled();
  });

  it('runs again for a word added during a run', async () => {
    let second = 0;
    const asked = stubGoogle(async () => {
      if (second) return;
      second = await addCard('neu', [{ de: 'Neuer Satz.' }]);
      void translateArticleExamples('ru');
    });
    const first = await addCard('Haus', [{ de: 'Erster Satz.' }]);
    await translateArticleExamples('ru');
    expect(asked).toEqual(['Erster Satz.', 'Neuer Satz.']);
    expect((await examplesOf(first))[0].tr).toBe('RU: Erster Satz.');
    expect((await examplesOf(second))[0].tr).toBe('RU: Neuer Satz.');
  });

  it('saves a long backlog batch by batch, and stops when the service gives out', async () => {
    const gap = fillTiming.batchGapMs;
    fillTiming.batchGapMs = 0;
    try {
      let requests = 0;
      const asked = stubGoogle(() => {
        if (++requests > 1) throw new TypeError('Failed to fetch');
      });
      const ids = await Promise.all(Array.from({ length: 35 }, (_, i) => addCard(`w${i}`, [{ de: `Satz ${i}.` }])));
      await translateArticleExamples('ru');
      expect(asked[0].split('\n')).toHaveLength(30);
      const done = await Promise.all(ids.map(async (id) => !!(await examplesOf(id))[0].tr));
      expect(done.filter(Boolean)).toHaveLength(30);
    } finally {
      fillTiming.batchGapMs = gap;
    }
  });
});
