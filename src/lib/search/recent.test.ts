import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addRecent, cleanRecent, clearRecent, loadRecent, MAX_RECENT, RECENT_KEY } from './recent';

let store: Map<string, string>;
let blocked: boolean;

beforeEach(() => {
  store = new Map();
  blocked = false;
  const guard = () => {
    if (blocked) throw new DOMException('denied', 'SecurityError');
  };
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (guard(), store.get(k) ?? null),
    setItem: (k: string, v: string) => (guard(), void store.set(k, v)),
    removeItem: (k: string) => (guard(), void store.delete(k)),
  });
});

describe('recent searches', () => {
  it('starts empty and keeps newest first', () => {
    expect(loadRecent()).toEqual([]);
    addRecent('gehen');
    addRecent('das Haus');
    expect(loadRecent()).toEqual(['das Haus', 'gehen']);
    expect(JSON.parse(store.get(RECENT_KEY)!)).toEqual(['das Haus', 'gehen']);
  });

  it('moves a repeated word to the top (case-insensitive), caps the list', () => {
    addRecent('gehen');
    addRecent('Haus');
    addRecent('haus');
    expect(loadRecent()).toEqual(['haus', 'gehen']);
    for (let i = 0; i < 20; i++) addRecent(`Wort${i}`);
    const list = loadRecent();
    expect(list).toHaveLength(MAX_RECENT);
    expect(list[0]).toBe('Wort19');
  });

  it('keeps "der See" and "die See" apart', () => {
    addRecent('der See');
    addRecent('die See');
    expect(loadRecent()).toEqual(['die See', 'der See']);
  });

  it('ignores empty and over-long words', () => {
    addRecent('   ');
    addRecent('x'.repeat(61));
    expect(loadRecent()).toEqual([]);
  });

  it.each([
    ['not JSON', '{oops'],
    ['an object', '{"a":1}'],
    ['a string', '"Haus"'],
    ['a number', '42'],
    ['null', 'null'],
  ])('falls back to an empty list for %s', (_, raw) => {
    store.set(RECENT_KEY, raw);
    expect(loadRecent()).toEqual([]);
    // …and a new search still works (replaces the bad value).
    expect(addRecent('Haus')).toEqual(['Haus']);
  });

  it('drops bad entries in a stored array', () => {
    store.set(RECENT_KEY, JSON.stringify(['Haus', 3, null, '', '  gehen  ', { w: 1 }, 'y'.repeat(200), 'haus', ['x']]));
    expect(loadRecent()).toEqual(['Haus', 'gehen']);
    expect(cleanRecent(Array.from({ length: 40 }, (_, i) => `w${i}`))).toHaveLength(MAX_RECENT);
  });

  it('works without storage (blocked, private mode)', () => {
    blocked = true;
    expect(loadRecent()).toEqual([]);
    expect(() => addRecent('Haus')).not.toThrow();
    expect(() => clearRecent()).not.toThrow();
  });

  it('clears', () => {
    addRecent('Haus');
    clearRecent();
    expect(loadRecent()).toEqual([]);
    expect(store.has(RECENT_KEY)).toBe(false);
  });
});
