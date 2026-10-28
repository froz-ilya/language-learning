import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/schema';
import { addSet, emptyCard, saveCard } from '../db/repo';
import type { Folder, WordSet } from '../types';
import { addWordToSet, findDuplicate, isSameWord, orderSetChoices, ownedCards } from './addToSet';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('isSameWord', () => {
  it('compares the term case-insensitively, trimmed', () => {
    expect(isSameWord({ term: 'Haus', genders: [] }, ' haus ')).toBe(true);
    expect(isSameWord({ term: 'Haus', genders: [] }, 'Häuser')).toBe(false);
  });

  it('tells the articles of a split noun apart', () => {
    const derSee = { term: 'See', genders: ['m' as const] };
    expect(isSameWord(derSee, 'See', ['m'])).toBe(true);
    expect(isSameWord(derSee, 'See', ['f'])).toBe(false);
    // No article on either side: the same word.
    expect(isSameWord({ term: 'See', genders: [] }, 'See', ['f'])).toBe(true);
    expect(isSameWord(derSee, 'See', [])).toBe(true);
    // der/das Teil overlaps with das Teil.
    expect(isSameWord({ term: 'Teil', genders: ['m', 'n'] }, 'Teil', ['n'])).toBe(true);
  });

  it('findDuplicate', () => {
    const cards = [
      { id: 1, term: 'See', genders: ['m' as const] },
      { id: 2, term: 'gehen', genders: [] },
    ];
    expect(findDuplicate(cards, { term: 'See', genders: ['f'] })).toBeUndefined();
    expect(findDuplicate(cards, { term: 'see', genders: ['m'] })?.id).toBe(1);
    expect(findDuplicate(cards, { term: 'Gehen' })?.id).toBe(2);
  });
});

describe('addWordToSet', () => {
  it('adds one card with the looked-up fields, then skips the duplicate', async () => {
    const set = await addSet('Mine');
    const fields = { term: 'Haus', pos: 'noun' as const, genders: ['n' as const], plural: 'Häuser', translation: 'дом', examples: [{ de: 'Das Haus ist alt.' }] };
    const first = await addWordToSet(set, fields);
    expect(first.created).toBe(true);
    const card = await db.cards.get(first.cardId);
    expect(card).toMatchObject({ setId: set, term: 'Haus', genders: ['n'], plural: 'Häuser', translation: 'дом', needsFill: 0, known: 0, presetId: '' });
    expect(card!.examples).toEqual([{ de: 'Das Haus ist alt.' }]);

    const again = await addWordToSet(set, { term: 'haus', genders: ['n'] });
    expect(again).toEqual({ cardId: first.cardId, created: false });
    expect(await db.cards.count()).toBe(1);
  });

  it('adds the other article of a split noun as its own card; same word in another set is fine', async () => {
    const a = await addSet('A');
    const b = await addSet('B');
    await addWordToSet(a, { term: 'See', pos: 'noun', genders: ['m'], translation: 'озеро' });
    expect((await addWordToSet(a, { term: 'See', pos: 'noun', genders: ['f'], translation: 'море' })).created).toBe(true);
    expect((await addWordToSet(a, { term: 'See', pos: 'noun', genders: ['f'] })).created).toBe(false);
    expect((await addWordToSet(b, { term: 'See', pos: 'noun', genders: ['m'] })).created).toBe(true);
    expect(await db.cards.count()).toBe(3);
  });

  it('a word without translation is marked to be filled later', async () => {
    const set = await addSet('Mine');
    const r = await addWordToSet(set, { term: 'Blabla' });
    expect((await db.cards.get(r.cardId))!.needsFill).toBe(1);
  });
});

describe('set choices', () => {
  const set = (id: number, name: string, over: Partial<WordSet> = {}): WordSet => ({ id, name, folderId: 0, level: '', topic: '', createdAt: id, ...over });
  const folders: Folder[] = [{ id: 1, name: 'Reading', level: '', createdAt: 0 }];

  it('user sets only, the last quick-add set first, then newest', () => {
    const sets = [set(1, 'Old'), set(2, 'Preset', { level: 'A1', topic: 'Essen' }), set(3, 'Article', { folderId: 1 }), set(4, 'New')];
    expect(orderSetChoices(sets, folders, 1)).toEqual([
      { id: 1, name: 'Old', folder: '', last: true },
      { id: 4, name: 'New', folder: '', last: false },
      { id: 3, name: 'Article', folder: 'Reading', last: false },
    ]);
    // A remembered set that no longer exists changes nothing.
    expect(orderSetChoices(sets, folders, 99).map((s) => s.id)).toEqual([4, 3, 1]);
  });
});

describe('ownedCards', () => {
  it('finds the word in any set (case-insensitive) with its status', async () => {
    const mine = await addSet('Mine');
    const preset = (await db.sets.add({ name: 'A1 Essen', folderId: 0, level: 'A1', topic: 'Essen', createdAt: 1 })) as number;
    await saveCard({ ...emptyCard(mine), term: 'see', genders: ['m'] });
    await saveCard({ ...emptyCard(preset), term: 'See', genders: ['f'], known: 1 });
    await saveCard({ ...emptyCard(mine), term: 'Seen' });
    const owned = await ownedCards('See');
    expect(owned.map((c) => [c.setName, c.genders, c.status])).toEqual([
      ['Essen', ['f'], 'known'],
      ['Mine', ['m'], 'new'],
    ]);
    expect(await ownedCards('')).toEqual([]);
  });
});
