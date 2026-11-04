import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/schema';
import { addFolder, addSet } from '../db/repo';
import { i18n } from '../i18n.svelte';
import { READING_FOLDER, TRANSLATOR_SET } from './store';
import type { Article } from './types';
import { articleTarget, translatorTarget } from './wordTarget';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('translatorTarget', () => {
  it('creates its set once, in the Reading folder, under its English name', async () => {
    const target = translatorTarget();
    expect(TRANSLATOR_SET).toBe('Translator');
    expect(await target.findSet()).toBe(0);
    const [a, b] = await Promise.all([target.ensureSet(), target.ensureSet()]);
    expect(a).toBe(b);
    expect(await target.ensureSet()).toBe(a);
    expect(await target.findSet()).toBe(a);
    const folders = await db.folders.where('name').equals(READING_FOLDER).toArray();
    expect(folders).toHaveLength(1);
    const sets = await db.sets.toArray();
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({ id: a, name: 'Translator', folderId: folders[0].id, level: '' });
  });

  it('finds its set again by name in an existing Reading folder, not a set elsewhere', async () => {
    const folderId = await addFolder(READING_FOLDER);
    await addSet(TRANSLATOR_SET); // Unfiled: not the translator's.
    await addSet('Ein Artikel', folderId);
    const own = await addSet(TRANSLATOR_SET, folderId);
    expect(await translatorTarget().findSet()).toBe(own);
    expect((await translatorTarget().add({ term: 'Haus', pos: 'noun', genders: ['n'] })).setId).toBe(own);
    expect(await db.folders.count()).toBe(1);
  });

  it('returns the card already there for the same word, and keeps the sentence as its first example', async () => {
    const target = translatorTarget();
    const first = await target.add({ term: 'anrufen', pos: 'verb', translation: 'звонить' }, 'Ich rufe dich morgen an.');
    expect(first.created).toBe(true);
    const card = await db.cards.get(first.cardId);
    expect(card?.examples[0]).toEqual({ de: 'Ich rufe dich morgen an.' });
    expect(card?.setId).toBe(first.setId);
    const again = await target.add({ term: 'Anrufen', pos: 'verb' }, 'Ruf mich an.');
    expect(again).toEqual({ cardId: first.cardId, setId: first.setId, created: false });
    expect(await db.cards.count()).toBe(1);
    // Another word spelled the same is its own card.
    expect((await target.add({ term: 'Anrufen', pos: 'noun', genders: ['n'] })).created).toBe(true);
  });

  it('shows the set name in the interface language', () => {
    const before = i18n.lang;
    const target = translatorTarget();
    try {
      i18n.lang = 'de';
      expect(target.setName).toBe('Übersetzer');
      i18n.lang = 'ru';
      expect(target.setName).toBe('Переводчик');
      i18n.lang = 'en';
      expect(target.setName).toBe('Translator');
    } finally {
      i18n.lang = before;
    }
  });
});

describe('articleTarget', () => {
  const article: Article = { id: 'paste:x', source: 'paste', title: 'Mein Tag', paragraphs: ['Text.'], url: '', license: '', attribution: '' };

  it('adds to the article’s own set, linked on its row', async () => {
    const target = articleTarget(article);
    expect(target.setName).toBe('Mein Tag');
    expect(await target.findSet()).toBe(0);
    const r = await target.add({ term: 'Tag', pos: 'noun', genders: ['m'] }, 'Ein schöner Tag.');
    expect(await target.findSet()).toBe(r.setId);
    expect((await db.articles.get(article.id))?.setId).toBe(r.setId);
    expect((await db.sets.get(r.setId))?.name).toBe('Mein Tag');
    expect(await target.ensureSet()).toBe(r.setId);
  });
});
