import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanDefinition, enWiktionaryGlosses, enWiktionaryPrefix, parseEnDefinitions, parseOpensearch } from './enwiktionary';

// Recorded from https://en.wiktionary.org/api/rest_v1/page/definition/<Word>.
const sample = (word: string) =>
  JSON.parse(readFileSync(new URL(`./__fixtures__/enwiktionary-${word}.json`, import.meta.url), 'utf8')) as unknown;

// Recorded from …/w/api.php?action=opensearch&search=Hausschl&limit=8&namespace=0&format=json&origin=*
const OPENSEARCH = [
  'Hausschl',
  ['Hausschlüssel', 'Hausschlüssels', 'Hauschild', 'Hausschuh', 'Hauschildt', 'Hausschwein', 'Hausschaf', 'Haussuchung'],
  ['', '', '', '', '', '', '', ''],
  ['https://en.wiktionary.org/wiki/Hausschl%C3%BCssel'],
];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const signal = () => new AbortController().signal;

afterEach(() => vi.unstubAllGlobals());

describe('parseEnDefinitions', () => {
  it('reads the German noun section, not other languages or the proper noun', () => {
    expect(parseEnDefinitions(sample('Haus'))).toEqual({
      pos: 'noun',
      glosses: ['house, building', 'home', 'theatre'],
      // One meaning per definition.
      translation: 'house, building; home; theatre',
    });
  });

  it('drops "to" from verb glosses and skips empty definitions', () => {
    const g = parseEnDefinitions(sample('gehen'))!;
    expect(g.pos).toBe('verb');
    expect(g.glosses.slice(0, 2)).toEqual(['to go, to walk', 'to leave']);
    expect(g.glosses.length).toBeLessThanOrEqual(3);
    expect(g.translation).toBe('go, walk; leave; take off');
  });

  it('ignores form-of definitions (inflected forms)', () => {
    expect(parseEnDefinitions(sample('ging'))).toBeNull();
  });

  it('returns null without a German section', () => {
    expect(parseEnDefinitions({ en: [] })).toBeNull();
    expect(parseEnDefinitions(null)).toBeNull();
  });
});

describe('cleanDefinition', () => {
  it('strips HTML, styles, entities and labels', () => {
    expect(
      cleanDefinition('<style>.x{}</style><span class="l">(colloquial)</span> to <a href="/wiki/go">go</a>&nbsp;&amp; <b>run</b> [with dative]'),
    ).toBe('to go & run');
  });
});

describe('enWiktionaryGlosses', () => {
  it('fetches the definition page, trying the capitalised title after a 404', async () => {
    const fetch = vi.fn(async (url: string) =>
      url.endsWith('/Haus') ? json(sample('Haus')) : json({ status: 404, type: 'Internal error' }, 404),
    );
    vi.stubGlobal('fetch', fetch);
    expect((await enWiktionaryGlosses.run('haus', signal()))!.translation).toBe('house, building; home; theatre');
    expect(fetch.mock.calls.map(([u]) => u)).toEqual([
      'https://en.wiktionary.org/api/rest_v1/page/definition/haus',
      'https://en.wiktionary.org/api/rest_v1/page/definition/Haus',
    ]);
  });

  it('returns null for a missing page and throws a typed error on 429', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ status: 404 }, 404)));
    expect(await enWiktionaryGlosses.run('Qwrtz', signal())).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 429)));
    await expect(enWiktionaryGlosses.run('Haus', signal())).rejects.toMatchObject({ status: 429, refusal: true });
  });
});

describe('opensearch', () => {
  it('parses titles', () => {
    expect(parseOpensearch(OPENSEARCH).slice(0, 2)).toEqual(['Hausschlüssel', 'Hausschlüssels']);
    expect(parseOpensearch({})).toEqual([]);
  });

  it('queries en.wiktionary with origin=*', async () => {
    const fetch = vi.fn(async (_url: string) => json(OPENSEARCH));
    vi.stubGlobal('fetch', fetch);
    expect(await enWiktionaryPrefix.run({ prefix: 'Hausschl', limit: 8 }, signal())).toHaveLength(8);
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.host).toBe('en.wiktionary.org');
    expect(url.searchParams.get('action')).toBe('opensearch');
    expect(url.searchParams.get('origin')).toBe('*');
  });
});
