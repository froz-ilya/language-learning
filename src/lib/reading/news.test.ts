import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getArticle, READING_SOURCES, SourceError, sourcesForLevel } from './sources';
import { matchFeed, parseFeed } from './sources/dw';
import { httpsUrl } from './sources/news';
import { parseSearch, parseStories, storyParagraphs } from './sources/tagesschau';
import { filterNews, loadNews, mergeNews, news, newsDate, newsSearch, resetNews, searchNews } from './feed.svelte';
import { isHeading } from './text';
import type { ArticleSummary } from './types';

// All texts here are invented: news articles are copyrighted and don't go into the repository.

const STORY = {
  type: 'story',
  title: 'Der Testzug fährt wieder',
  date: '2026-11-01T15:00:00.000+01:00',
  details: 'https://www.tagesschau.de/api2u/inland/test-zug-100.json',
  shareURL: 'https://www.tagesschau.de/inland/test-zug-100.html',
  firstSentence: 'Der <em>Testzug</em> fährt.',
  ressort: 'inland',
};

const FEED = `<?xml version="1.0"?><rss><channel><title>DW</title>
<item><guid isPermaLink="false">111</guid><pubDate>Sun, 1 Nov 2026 14:26:00 GMT</pubDate>
<title>Tests &quot;bestanden&quot;</title>
<link>https://www.dw.com/de/tests-bestanden/a-111?maca=de-rss</link>
<description>Alle Tests sind grün.</description><category>Welt</category></item>
<item><guid>333</guid><pubDate>Sun, 1 Nov 2026 12:00:00 GMT</pubDate><title>Die Lage heute</title>
<link>https://www.dw.com/de/die-lage/a-333</link><category>Aktuelles</category></item>
<item><guid>222</guid><pubDate>Sun, 1 Nov 2026 13:00:00 GMT</pubDate>
<title><![CDATA[Ein Video]]></title><link>https://www.dw.com/de/ein-video/video-222</link></item>
</channel></rss>`;

function stubFetch(handler: (url: string) => Response | Promise<Response>) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      calls.push(input);
      return handler(input);
    }),
  );
  return calls;
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const answer = (url: string) => (url.includes('tagesschau') ? json({ news: [STORY] }) : new Response(FEED));

beforeEach(() => {
  resetNews();
  vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-11-01T16:00:00+01:00') });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('news sources', () => {
  it('stay out of the level lists but have a credit', () => {
    for (const id of ['tagesschau', 'dw']) {
      expect(READING_SOURCES.find((s) => s.id === id)?.license).toBeTruthy();
      expect(sourcesForLevel('C1').map((s) => s.id)).not.toContain(id);
    }
  });

  it('lists national tagesschau stories with their date and a clean teaser', () => {
    const items = parseStories({
      news: [
        STORY,
        { ...STORY, type: 'video' },
        { ...STORY, ressort: undefined }, // a regional broadcaster's story
        { ...STORY, date: 'gestern' },
        { ...STORY, details: 'https://example.com/x.json' },
      ],
    });
    expect(items).toEqual([
      {
        id: 'tagesschau:inland/test-zug-100',
        source: 'tagesschau',
        title: STORY.title,
        snippet: 'Der Testzug fährt.',
        publishedAt: Date.parse(STORY.date),
        topic: 'germany',
      },
    ]);
  });

  it('maps tagesschau sections to topics; search results keep regional stories', () => {
    const topic = (ressort: string) => parseStories({ news: [{ ...STORY, ressort }] })[0].topic;
    expect(topic('ausland')).toBe('world');
    expect(topic('wirtschaft')).toBe('economy');
    expect(topic('video')).toBeUndefined();
    const found = parseSearch({ searchResults: [{ ...STORY, ressort: undefined }, { ...STORY, type: 'video' }] });
    expect(found).toHaveLength(1);
    expect(found[0].topic).toBeUndefined();
  });

  it('keeps text, headings and quotes of a tagesschau story; drops boxes and the broadcast list', () => {
    const paragraphs = storyParagraphs([
      { type: 'text', value: '<strong>Der Testzug fährt wieder.</strong>' },
      { type: 'box', value: 'Bildunterschrift' },
      { type: 'headline', value: '<h2>Die Strecke</h2>' },
      { type: 'text', value: 'Sie ist <a href="https://x">frei</a>.' },
      { type: 'quotation', quotation: { text: 'Wir sind froh.' } },
      { type: 'text', value: '<ul><li>Das Erste | tagesschau | 31.10.2026 | 20:00 Uhr</li></ul>' },
      { type: 'text', value: 'BR Fernsehen | Abendschau | 27.10.2026 | 17:30 Uhr' },
      { type: 'related', value: 'Mehr dazu' },
    ]);
    expect(paragraphs).toEqual(['Der Testzug fährt wieder.', '## Die Strecke', 'Sie ist frei.', 'Wir sind froh.']);
    expect(isHeading(paragraphs[1])).toBe(true);
  });

  it('opens a tagesschau story, and an odd link falls back to the home page', async () => {
    const calls = stubFetch(() => json({ ...STORY, shareURL: 'javascript:alert(1)', content: [{ type: 'text', value: 'Der Testzug fährt.' }] }));
    const a = await getArticle('tagesschau:inland/test-zug-100');
    expect(calls).toEqual(['https://www.tagesschau.de/api2u/inland/test-zug-100.json']);
    expect(a).toMatchObject({ title: STORY.title, paragraphs: ['Der Testzug fährt.'], url: 'https://www.tagesschau.de/', license: '© ARD' });
    expect(a.attribution).toBe('tagesschau · © ARD');
    expect(a.publishedAt).toBe(Date.parse(STORY.date));
  });

  it('lists DW articles only, with decoded titles', () => {
    expect(parseFeed(FEED)).toEqual([
      {
        id: 'dw:111',
        source: 'dw',
        title: 'Tests "bestanden"',
        snippet: 'Alle Tests sind grün.',
        publishedAt: Date.parse('Sun, 1 Nov 2026 14:26:00 GMT'),
        topic: 'world',
      },
      { id: 'dw:333', source: 'dw', title: 'Die Lage heute', publishedAt: Date.parse('Sun, 1 Nov 2026 12:00:00 GMT') },
    ]);
  });

  it('searches the DW feed in titles and teasers, ignoring case', () => {
    const items = parseFeed(FEED);
    expect(matchFeed(items, 'grün').map((a) => a.id)).toEqual(['dw:111']);
    expect(matchFeed(items, 'LAGE').map((a) => a.id)).toEqual(['dw:333']);
    expect(matchFeed(items, 'Mond')).toEqual([]);
  });

  it.each(['gri/wa (dpa, rtr)', 'wa/gri (dpa, consilium.europa.eu)', 'kle (afp)'])('drops the closing credit "%s" of a DW article', async (credit) => {
    stubFetch(() => json({ data: { content: { title: 'T', text: `<p>Es gab keine Fehler.</p><p>${credit}</p>` } } }));
    expect((await getArticle('dw:111')).paragraphs).toEqual(['Es gab keine Fehler.']);
  });

  it('keeps a closing sentence of a DW article', async () => {
    stubFetch(() => json({ data: { content: { title: 'T', text: '<p>Am Ende sagte er nur (leise): Danke.</p>' } } }));
    expect((await getArticle('dw:111')).paragraphs).toEqual(['Am Ende sagte er nur (leise): Danke.']);
  });

  it('opens a DW article with its teaser as the lead', async () => {
    const calls = stubFetch(() =>
      json({
        data: {
          content: {
            title: 'Tests bestanden',
            teaser: 'Alle Tests sind grün.',
            text: '<p>Es gab keine Fehler.</p><h2>Wie geht es weiter?</h2><p>Morgen gibt es neue Tests.</p>',
            canonicalUrl: 'https://www.dw.com/de/tests-bestanden/a-111',
            contentDate: '2026-11-01T14:26:54.891Z',
          },
        },
      }),
    );
    const a = await getArticle('dw:111');
    expect(calls).toEqual(['https://www.dw.com/graph-api/de/content/article/111']);
    expect(a.paragraphs).toEqual(['Alle Tests sind grün.', 'Es gab keine Fehler.', '## Wie geht es weiter?', 'Morgen gibt es neue Tests.']);
    expect(a).toMatchObject({ url: 'https://www.dw.com/de/tests-bestanden/a-111', attribution: 'Deutsche Welle · © DW', publishedAt: Date.parse('2026-11-01T14:26:54.891Z') });
  });

  it('reports an article that is gone as removed', async () => {
    stubFetch(() => json({}, 404));
    const e = await getArticle('dw:111').catch((x) => x);
    expect(e).toBeInstanceOf(SourceError);
    expect(e.code).toBe('removed');
  });

  it('lets only https links through', () => {
    expect(httpsUrl('https://www.dw.com/de', 'x')).toBe('https://www.dw.com/de');
    for (const bad of ['http://www.dw.com', 'javascript:alert(1)', undefined, 3]) expect(httpsUrl(bad, 'x')).toBe('x');
  });
});

describe('news list', () => {
  const NOW = Date.parse('2026-11-01T16:00:00+01:00');
  const HOUR = 3_600_000;
  const item = (id: string, hours: number | undefined): ArticleSummary => ({
    id,
    source: 'dw',
    title: id,
    publishedAt: hours === undefined ? undefined : NOW - hours * HOUR,
  });

  it('merges newest first and leaves out what is older than a day or undated', () => {
    const merged = mergeNews([[item('a', 1), item('old', 25)], [item('b', 0.5), item('c', 23.9), item('none', undefined)]], NOW);
    expect(merged.map((a) => a.id)).toEqual(['b', 'a', 'c']);
  });

  it('filters by source and topic together', () => {
    const items: ArticleSummary[] = [
      { ...item('a', 1), topic: 'world' },
      { ...item('b', 1), topic: 'germany' },
      { ...item('c', 1), source: 'tagesschau', topic: 'world' },
      item('d', 1),
    ];
    const ids = (s: Parameters<typeof filterNews>[1], t: Parameters<typeof filterNews>[2]) => filterNews(items, s, t).map((a) => a.id);
    expect(ids('', '')).toEqual(['a', 'b', 'c', 'd']);
    expect(ids('dw', '')).toEqual(['a', 'b', 'd']);
    expect(ids('', 'world')).toEqual(['a', 'c']);
    expect(ids('tagesschau', 'world')).toEqual(['c']);
    expect(ids('tagesschau', 'germany')).toEqual([]);
  });

  it('shows the date and time, and the year only when it differs', () => {
    const thisYear = newsDate(Date.parse('2026-03-05T10:00:00'), NOW);
    expect(thisYear).toContain('5');
    expect(thisYear).not.toContain('2026');
    expect(newsDate(Date.parse('2024-03-05T10:00:00'), NOW)).toContain('2024');
  });
});

describe('searchNews', () => {
  const answerSearch = (url: string) =>
    url.includes('/search/')
      ? json({ searchResults: [{ ...STORY, title: 'Treffer', date: '2026-10-01T10:00:00.000+02:00' }] })
      : new Response(FEED);

  it('asks tagesschau once, looks through the feed and sorts by date, whatever the age', async () => {
    const calls = stubFetch(answerSearch);
    await searchNews('  Tests & mehr ');
    expect(calls).toContain('https://www.tagesschau.de/api2u/search/?searchText=Tests+%26+mehr&pageSize=30');
    expect(newsSearch.query).toBe('Tests & mehr');
    expect(newsSearch.items.map((a) => a.title)).toEqual(['Treffer']);

    await searchNews('tests');
    expect(newsSearch.items.map((a) => a.title)).toEqual(['Tests "bestanden"', 'Treffer']);
    expect(newsSearch.loading).toBe(false);
  });

  it('goes back to the list on an empty query, without a request', async () => {
    stubFetch(answerSearch);
    await searchNews('tests');
    const calls = stubFetch(answerSearch);
    await searchNews('  ');
    expect(calls).toEqual([]);
    expect(newsSearch).toMatchObject({ query: '', items: [] });
  });

  it('shows what one source found when the other fails', async () => {
    stubFetch((url) => (url.includes('/search/') ? json({}, 503) : new Response(FEED)));
    await searchNews('tests');
    expect(newsSearch.items.map((a) => a.source)).toEqual(['dw']);
    expect(newsSearch.errors).toEqual([{ id: 'tagesschau', error: 'unavailable' }]);
  });

  it('keeps only the latest search when an older one answers late', async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    stubFetch(async (url) => {
      if (url.includes('searchText=alt')) await gate;
      return answerSearch(url);
    });
    const first = searchNews('alt');
    await searchNews('tests');
    release();
    await first;
    expect(newsSearch.query).toBe('tests');
    expect(newsSearch.items).toHaveLength(2);
  });

  it('asks no source that is backing off', async () => {
    const calls = stubFetch((url) => (url.includes('/search/') ? json({}, 429) : new Response(FEED)));
    await searchNews('tests');
    const before = calls.filter((u) => u.includes('/search/')).length;
    await searchNews('tests');
    expect(calls.filter((u) => u.includes('/search/'))).toHaveLength(before);
  });
});

describe('loadNews', () => {
  const advance = (ms: number) => vi.setSystemTime(Date.now() + ms);

  it('loads every source and keeps them for ten minutes', async () => {
    const calls = stubFetch(answer);
    await loadNews();
    expect(calls).toHaveLength(2);
    expect(news.tagesschau.items).toHaveLength(1);
    expect(news.dw.items).toHaveLength(2);

    advance(9 * 60_000);
    await loadNews();
    expect(calls).toHaveLength(2);

    advance(2 * 60_000);
    await loadNews();
    expect(calls).toHaveLength(4);
  });

  it('refreshes on request, but not twice in 30 seconds', async () => {
    const calls = stubFetch(answer);
    await loadNews();
    advance(10_000);
    await loadNews(true);
    expect(calls).toHaveLength(2);
    advance(25_000);
    await loadNews(true);
    expect(calls).toHaveLength(4);
  });

  it('keeps the list when an update fails, and retries a failed source at once', async () => {
    let failing = false;
    const calls = stubFetch((url) => (failing && url.includes('dw.com') ? json({}, 503) : answer(url)));
    await loadNews();
    advance(11 * 60_000);
    failing = true;
    await loadNews();
    expect(news.dw).toMatchObject({ error: 'unavailable' });
    expect(news.dw.items).toHaveLength(2);
    expect(news.tagesschau.error).toBe('');

    failing = false;
    const before = calls.length;
    await loadNews(true);
    expect(calls.slice(before)).toEqual(['https://rss.dw.com/xml/rss-de-all']);
    expect(news.dw.error).toBe('');
  });

  it('backs off for ten minutes after a 429, even on request', async () => {
    const calls = stubFetch((url) => (url.includes('tagesschau') ? json({}, 429) : answer(url)));
    await loadNews();
    expect(news.tagesschau.error).toBe('unavailable');
    const before = calls.filter((u) => u.includes('tagesschau')).length;

    advance(5 * 60_000);
    await loadNews(true);
    expect(calls.filter((u) => u.includes('tagesschau'))).toHaveLength(before);

    advance(6 * 60_000);
    await loadNews(true);
    expect(calls.filter((u) => u.includes('tagesschau'))).toHaveLength(before + 1);
  });
});
