import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { getArticle, listArticles, READING_SOURCES, sourcesForLevel, splitArticleId } from './sources';
import { loadGutenberg, nextPart, resetGutenbergCache, type GutenbergFile } from './sources/gutenberg';
import { newsSnippet } from './sources/wikinews';
import { introSnippet } from './sources/wikipedia';
import { isHeading } from './text';
import { articleIdFromParts, articlePath, articleSetName } from './store';

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, '__fixtures__', name), 'utf8');

/** fetch mock: answers by matching the URL; records requested URLs. */
function mockFetch(handler: (url: URL) => unknown) {
  const calls: URL[] = [];
  const fn = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost/');
    calls.push(url);
    const body = handler(url);
    if (body instanceof Response) return body;
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

beforeEach(() => resetGutenbergCache());
afterEach(() => vi.unstubAllGlobals());

describe('source registry', () => {
  it('maps levels to sources', () => {
    expect(sourcesForLevel('A1').map((s) => s.id)).toEqual(['miniklexikon']);
    expect(sourcesForLevel('A2').map((s) => s.id)).toEqual(['miniklexikon', 'klexikon']);
    expect(sourcesForLevel('B2').map((s) => s.id)).toEqual(['gutenberg', 'wikinews']);
    expect(sourcesForLevel('C2').map((s) => s.id)).toEqual(['gutenberg', 'wikipedia']);
    expect(READING_SOURCES.every((s) => s.id === 'paste' || s.license)).toBe(true);
  });

  it('splits ids and maps them to routes and back (titles may contain ":" and "/")', () => {
    expect(splitArticleId('wikipedia:AC/DC: Live')).toEqual({ source: 'wikipedia', key: 'AC/DC: Live' });
    const p = articlePath('wikipedia:AC/DC: Live');
    expect(p).toBe('/article/wikipedia/AC%2FDC%3A%20Live');
    // The router splits on "/" and then decodes each part.
    const parts = p.split('/').filter(Boolean).map(decodeURIComponent);
    expect(articleIdFromParts(parts)).toBe('wikipedia:AC/DC: Live');
    expect(() => splitArticleId('nope:x')).toThrow();
  });

  it('names sets after the article, at most 60 characters', () => {
    expect(articleSetName('  Hunde ')).toBe('Hunde');
    const long = articleSetName('Das Bundesverteidigungsministerium bestreitet die operative US-Drohnen-Kriegsführung');
    expect(long.length).toBe(60);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('Klexikon / MiniKlexikon', () => {
  it('lists random articles with a continue cursor', async () => {
    const calls = mockFetch(() => ({
      continue: { rncontinue: '0.81|0.82|7212|0' },
      query: { random: [{ id: 1, ns: 0, title: 'Aachen' }, { id: 2, ns: 0, title: 'Brasília' }] },
    }));
    const r = await listArticles('klexikon', { level: 'A2' });
    expect(r.items).toEqual([
      { id: 'klexikon:Aachen', source: 'klexikon', title: 'Aachen' },
      { id: 'klexikon:Brasília', source: 'klexikon', title: 'Brasília' },
    ]);
    expect(r.cursor).toBe('0.81|0.82|7212|0');
    const u = calls[0];
    expect(u.origin + u.pathname).toBe('https://klexikon.zum.de/api.php');
    expect(u.searchParams.get('list')).toBe('random');
    expect(u.searchParams.get('rnnamespace')).toBe('0');
    expect(u.searchParams.get('origin')).toBe('*');

    await listArticles('klexikon', { cursor: r.cursor });
    expect(calls[1].searchParams.get('rncontinue')).toBe('0.81|0.82|7212|0');
  });

  it('searches with snippets', async () => {
    const calls = mockFetch(() => ({
      continue: { sroffset: 20 },
      query: { search: [{ title: 'Hunde', snippet: 'Die <span class="searchmatch">Hunde</span> sind Tiere' }] },
    }));
    const r = await listArticles('miniklexikon', { query: 'Hund' });
    expect(calls[0].hostname).toBe('miniklexikon.zum.de');
    expect(calls[0].searchParams.get('srsearch')).toBe('Hund');
    expect(r.items[0]).toEqual({ id: 'miniklexikon:Hunde', source: 'miniklexikon', title: 'Hunde', snippet: 'Die Hunde sind Tiere' });
    expect(r.cursor).toBe('20');
  });

  it('gets an article through action=parse', async () => {
    const calls = mockFetch(() => fixture('klexikon-parse-Hund.json'));
    const a = await getArticle('klexikon:Hund');
    const u = calls[calls.length - 1];
    expect(u.searchParams.get('action')).toBe('parse');
    expect(u.searchParams.get('page')).toBe('Hund');
    expect(u.searchParams.get('redirects')).toBe('1');
    expect(a.id).toBe('klexikon:Hund');
    expect(a.title).toBe('Hunde');
    expect(a.url).toBe('https://klexikon.zum.de/wiki/Hunde');
    expect(a.license).toBe('CC BY-SA 4.0');
    expect(a.attribution).toBe('Klexikon · CC BY-SA 4.0');
    expect(a.paragraphs[0]).toMatch(/^Hunde sind Säugetiere/);
  });

  it('throws on network errors and API errors', async () => {
    mockFetch(() => new Response('nope', { status: 503 }));
    await expect(listArticles('klexikon')).rejects.toThrow('HTTP 503');
    mockFetch(() => ({ error: { code: 'missingtitle', info: "The page you specified doesn't exist." } }));
    await expect(getArticle('miniklexikon:Gibtsnicht')).rejects.toThrow('missingtitle');
  });
});

describe('Wikipedia', () => {
  it('gets the plain-text extract, flags headings, stops at Literatur and truncates', async () => {
    const long = Array.from({ length: 40 }, (_, i) => `Absatz ${i} ` + 'Wort '.repeat(60).trim() + '.').join('\n');
    const extract = `Der Haushund ist ein Haustier.\n\n\n== Geschichte ==\n${long}\n\n\n== Literatur ==\nBuch.`;
    const calls = mockFetch(() => ({
      batchcomplete: true,
      query: { redirects: [{ from: 'Hund', to: 'Haushund' }], pages: [{ pageid: 1, ns: 0, title: 'Haushund', extract }] },
    }));
    const a = await getArticle('wikipedia:Hund');
    const u = calls[0];
    expect(u.searchParams.get('prop')).toBe('extracts');
    expect(u.searchParams.get('explaintext')).toBe('1');
    expect(u.searchParams.has('exintro')).toBe(false); // any value of exintro means "intro only"
    expect(u.searchParams.get('titles')).toBe('Hund');
    expect(a.title).toBe('Haushund');
    expect(a.url).toBe('https://de.wikipedia.org/wiki/Haushund');
    expect(a.paragraphs[0]).toBe('Der Haushund ist ein Haustier.');
    expect(isHeading(a.paragraphs[1])).toBe(true);
    const words = a.paragraphs.filter((p) => !isHeading(p)).join(' ').split(/\s+/).length;
    expect(words).toBeGreaterThanOrEqual(1500);
    expect(words).toBeLessThan(1600);
    expect(a.paragraphs.join(' ')).not.toContain('Buch.');
  });

  it('throws for a missing page', async () => {
    mockFetch(() => ({ query: { pages: [{ ns: 0, title: 'Xyz', missing: true }] } }));
    await expect(getArticle('wikipedia:Xyz')).rejects.toThrow();
  });

  it('lists quality articles, alternating "exzellent" and "lesenswert"', async () => {
    const calls = mockFetch((u) => ({
      continue: { gcmcontinue: `${u.searchParams.get('gcmtitle')}|next` },
      query: {
        pages: [{ pageid: 1, ns: 0, title: 'Molybdän', extract: 'Molybdän [molʏpˈdɛːn] (von altgriechisch „Blei“) ist ein chemisches Element. Es ist hart.' }],
      },
    }));
    const p1 = await listArticles('wikipedia', { level: 'C1' });
    expect(calls[0].searchParams.get('gcmtitle')).toBe('Kategorie:Wikipedia:Exzellent');
    expect(calls[0].searchParams.get('generator')).toBe('categorymembers');
    expect(p1.items[0]).toEqual({
      id: 'wikipedia:Molybdän',
      source: 'wikipedia',
      title: 'Molybdän',
      snippet: 'Molybdän [molʏpˈdɛːn] ist ein chemisches Element.',
    });
    await listArticles('wikipedia', { cursor: p1.cursor });
    expect(calls[1].searchParams.get('gcmtitle')).toBe('Kategorie:Wikipedia:Lesenswert');
    expect(calls[1].searchParams.get('gcmcontinue')).toBeNull();
    const p3 = await listArticles('wikipedia', { cursor: (await listArticles('wikipedia', { cursor: p1.cursor })).cursor });
    expect(calls[3].searchParams.get('gcmtitle')).toBe('Kategorie:Wikipedia:Exzellent');
    expect(calls[3].searchParams.get('gcmcontinue')).toBe('Kategorie:Wikipedia:Exzellent|next');
    expect(p3.cursor).toBeDefined();
  });

  it('cleans intro snippets', () => {
    expect(introSnippet('Raymond Tanguy (* 5. Januar 1900 in Paris; † 15.')).toBe('Raymond Tanguy…');
    expect(introSnippet(undefined)).toBeUndefined();
  });
});

describe('Wikinews', () => {
  it('lists published articles from the category, newest first, with teasers', async () => {
    const calls = mockFetch(() => ({
      batchcomplete: true,
      continue: { gcmcontinue: '20260504115125|86871', continue: 'gcmcontinue||' },
      query: {
        pages: [
          { pageid: 86858, ns: 0, title: 'Brenzkirche Stuttgart: Umbau hat begonnen', extract: 'Brenzkirche Stuttgart: Umbau hat begonnen\n\nUmbausünde von 1938 wird zurückgebaut\n\nStuttgart (Baden-Württemberg), 05.05.2026 – Die Brenzkirche in Stuttgart wird seit einigen Monaten umgebaut. Es sollen dabei Elemente wiederhergestellt werden.' },
          { pageid: 86901, ns: 0, title: 'Deutsche Post AG wird zur DHL AG', extract: 'Deutsche Post AG wird zur DHL AG\n\nBonn (Deutschland), 05.05.2026 – Die Deutsche Post AG heißt künftig DHL. Das sollen die Aktionäre beschließen.' },
        ],
      },
    }));
    const r = await listArticles('wikinews', { level: 'B2' });
    const u = calls[0];
    expect(u.hostname).toBe('de.wikinews.org');
    expect(u.searchParams.get('gcmtitle')).toBe('Kategorie:Veröffentlicht');
    expect(u.searchParams.get('gcmsort')).toBe('timestamp');
    expect(u.searchParams.get('gcmdir')).toBe('desc');
    expect(r.items.map((i) => i.title)).toEqual(['Deutsche Post AG wird zur DHL AG', 'Brenzkirche Stuttgart: Umbau hat begonnen']);
    expect(r.items[0].snippet).toBe('Die Deutsche Post AG heißt künftig DHL.');
    expect(r.items[1].snippet).toBe('Die Brenzkirche in Stuttgart wird seit einigen Monaten umgebaut.');
    expect(r.cursor).toBe('20260504115125|86871');
  });

  it('gets an article through action=parse without the boxes', async () => {
    mockFetch(() => fixture('wikinews-parse-ICE.json'));
    const a = await getArticle('wikinews:ICE kollidiert mit Oberleitung');
    expect(a.url).toBe('https://de.wikinews.org/wiki/ICE_kollidiert_mit_Oberleitung');
    expect(a.license).toBe('CC BY 2.5');
    expect(a.paragraphs[0]).toMatch(/^Lüneburg/);
    expect(a.paragraphs).toHaveLength(5);
  });

  it('newsSnippet handles missing extracts', () => {
    expect(newsSnippet('T', undefined)).toBeUndefined();
    expect(newsSnippet('T', 'T\n\nNur ein Satz ohne Datum.')).toBe('Nur ein Satz ohne Datum.');
  });
});

describe('Gutenberg (bundled JSON)', () => {
  const file: GutenbergFile = {
    version: 1,
    license: 'Public domain (Project Gutenberg)',
    texts: [
      { id: 'grimm-rotkaeppchen', title: 'Rotkäppchen', author: 'Brüder Grimm', work: 'Deutsche Märchen', url: 'https://www.gutenberg.org/ebooks/77905', level: 'B1', words: 10, snippet: 'Es war einmal.', paragraphs: ['Es war einmal eine kleine süße Dirne.'] },
      { id: 'kafka-verwandlung-i-1', title: 'Die Verwandlung – Teil I (1/2)', author: 'Franz Kafka', work: 'Die Verwandlung', url: 'https://www.gutenberg.org/ebooks/22367', level: 'C1', words: 10, snippet: 'Als Gregor Samsa erwachte.', paragraphs: ['Als Gregor Samsa eines Morgens erwachte.'] },
      { id: 'kafka-verwandlung-i-2', title: 'Die Verwandlung – Teil I (2/2)', author: 'Franz Kafka', work: 'Die Verwandlung', url: 'https://www.gutenberg.org/ebooks/22367', level: 'C1', words: 10, snippet: '…', paragraphs: ['Teil zwei.'] },
      { id: 'kafka-verwandlung-ii-1', title: 'Die Verwandlung – Teil II', author: 'Franz Kafka', work: 'Die Verwandlung', url: 'https://www.gutenberg.org/ebooks/22367', level: 'C1', words: 10, snippet: '…', paragraphs: ['Kapitel zwei.'] },
      { id: 'kafka-vor-dem-gesetz', title: 'Vor dem Gesetz', author: 'Franz Kafka', work: 'Ein Landarzt', url: 'https://www.gutenberg.org/ebooks/21989', level: 'C1', words: 10, snippet: 'Vor dem Gesetz steht ein Türhüter.', paragraphs: ['Vor dem Gesetz steht ein Türhüter.'] },
    ],
  };

  it('loads the file once and lists first parts for a level', async () => {
    const calls = mockFetch(() => file);
    const r = await listArticles('gutenberg', { level: 'C1' });
    expect(calls).toHaveLength(1);
    expect(calls[0].pathname).toMatch(/reading\/gutenberg\.json$/);
    expect(r.items).toEqual([
      { id: 'gutenberg:kafka-verwandlung-i-1', source: 'gutenberg', title: 'Die Verwandlung – Teil I', snippet: 'Franz Kafka · Als Gregor Samsa erwachte.', level: 'C1' },
      { id: 'gutenberg:kafka-vor-dem-gesetz', source: 'gutenberg', title: 'Vor dem Gesetz', snippet: 'Franz Kafka · Vor dem Gesetz steht ein Türhüter.', level: 'C1' },
    ]);
    expect(r.cursor).toBeUndefined();
    await listArticles('gutenberg', { level: 'B1' });
    expect(calls).toHaveLength(1);
  });

  it('gets a text with attribution, and finds the next part', async () => {
    mockFetch(() => file);
    const a = await getArticle('gutenberg:grimm-rotkaeppchen');
    expect(a).toMatchObject({
      title: 'Rotkäppchen',
      license: 'Public domain (Project Gutenberg)',
      attribution: 'Brüder Grimm, Deutsche Märchen · Public domain (Project Gutenberg)',
      url: 'https://www.gutenberg.org/ebooks/77905',
    });
    expect(await nextPart('gutenberg:kafka-verwandlung-i-1')).toEqual({ id: 'gutenberg:kafka-verwandlung-i-2', title: 'Die Verwandlung – Teil I (2/2)' });
    expect(await nextPart('gutenberg:kafka-verwandlung-i-2')).toEqual({ id: 'gutenberg:kafka-verwandlung-ii-1', title: 'Die Verwandlung – Teil II' });
    expect(await nextPart('gutenberg:kafka-verwandlung-ii-1')).toBeNull();
    expect(await nextPart('gutenberg:grimm-rotkaeppchen')).toBeNull();
    await expect(getArticle('gutenberg:nope')).rejects.toThrow();
  });

  it('throws when the file is unavailable, and retries later', async () => {
    mockFetch(() => new Response('', { status: 404 }));
    await expect(loadGutenberg()).rejects.toThrow('HTTP 404');
    mockFetch(() => file);
    await expect(loadGutenberg()).resolves.toMatchObject({ version: 1 });
  });

  it('the bundled public/reading/gutenberg.json is valid and small', () => {
    const p = path.join(__dirname, '../../../public/reading/gutenberg.json');
    const raw = fs.readFileSync(p, 'utf8');
    expect(raw.length).toBeLessThan(1024 * 1024);
    const data = JSON.parse(raw) as GutenbergFile;
    expect(data.license).toBe('Public domain (Project Gutenberg)');
    expect(data.texts.length).toBeGreaterThanOrEqual(30);
    const ids = new Set(data.texts.map((t) => t.id));
    expect(ids.size).toBe(data.texts.length);
    for (const t of data.texts) {
      expect(t.paragraphs.length).toBeGreaterThan(0);
      expect(t.words).toBeLessThanOrEqual(1500);
      expect(t.url).toMatch(/^https:\/\/www\.gutenberg\.org\/ebooks\/\d+$/);
      expect(['B1', 'B2', 'C1', 'C2']).toContain(t.level);
      expect(t.paragraphs.join(' ')).not.toMatch(/PROJECT GUTENBERG|\*\*\*/i);
    }
  });
});

describe('cards from the reader', () => {
  it('buildCard keeps the reading context as the first example and flags missing translations', async () => {
    const { buildCard, fieldsFromEntry } = await import('./store');
    const entry = {
      term: 'Hund',
      pos: 'noun' as const,
      genders: ['m' as const],
      plural: 'Hunde',
      praeteritum: '',
      partizip2: '',
      auxiliary: '' as const,
      tr: { ru: 'собака', en: 'dog' },
      rank: 400,
    };
    const card = buildCard(7, fieldsFromEntry(entry, 'en'), 'Der Hund bellt.');
    expect(card).toMatchObject({ setId: 7, term: 'Hund', genders: ['m'], plural: 'Hunde', translation: 'dog', needsFill: 0 });
    expect(card.examples).toEqual([{ de: 'Der Hund bellt.' }]);
    const bare = buildCard(7, { term: 'Odradek' });
    expect(bare.needsFill).toBe(1);
    expect(bare.examples).toEqual([]);
  });
});
