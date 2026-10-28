import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWikitexts, lineSegments, parseEntry, RateLimitError, titleChunks, parseSenseTranslations, stripMarkup, templateParams } from './wiktionary';
import { formatMeanings } from './meanings';

const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/${name}.wikitext`, import.meta.url), 'utf8');
const entry = (name: string) => parseEntry(name, fixture(name))!;

describe('parseEntry', () => {
  it('reads a neuter noun with plural and translations', () => {
    const e = entry('Haus');
    expect(e.pos).toBe('noun');
    expect(e.genders).toEqual(['n']);
    expect(e.plural).toBe('Häuser');
    // Senses 1 and 2 are both "house"/"дом": one meaning; "home" (sense 3) is another.
    expect(e.translations.en).toEqual([['house'], ['home']]);
    expect(e.translations.ru).toEqual([['дом']]);
    expect(e.examples.length).toBeGreaterThan(0);
  });

  it('reads a masculine noun', () => {
    const e = entry('Tisch');
    expect(e.genders).toEqual(['m']);
    expect(e.plural).toBe('Tische');
    expect(e.translations.ru).toEqual([['стол']]);
  });

  it('merges gender variants of one meaning (der/das Teil)', () => {
    const teil = entry('Teil');
    expect(teil.genders.sort()).toEqual(['m', 'n']);
    expect(teil.articles).toBeUndefined();
  });

  it('reads verb forms', () => {
    const e = entry('gehen');
    expect(e.pos).toBe('verb');
    expect(e.praeteritum).toBe('ging');
    expect(e.partizip2).toBe('gegangen');
    expect(e.auxiliary).toBe('sein');
    expect(e.translations.en[0]).toEqual(['go', 'walk']);
    // "''imperfektiv:''" notes are kept; text around the template belongs to the word ("be operable").
    expect(formatMeanings(e.translations.en)).toBe('go, walk; leave; work, be operable');
    expect(formatMeanings(e.translations.ru)).toBe('идти, пойти; уходить/уйти; действовать');
  });

  it('groups translations by meaning (Folge: consequence, sequence, episode)', () => {
    const e = entry('Folge');
    expect(formatMeanings(e.translations.ru)).toBe('последствие; череда, ряд; эпизод');
    expect(formatMeanings(e.translations.en)).toBe('consequence; order; episode');
  });

  it('merges homonym blocks meaning by meaning (Bank: bench, bank)', () => {
    const e = entry('Bank');
    expect(e.translations.ru.slice(0, 2)).toEqual([['скамейка', 'скамья'], ['банк']]);
    expect(e.translations.en.slice(0, 2)).toEqual([['bench'], ['bank']]);
  });

  it('keeps articles with different meanings apart (der See, die See)', () => {
    const see = entry('See');
    // The entry itself is the first article, so callers that ignore `articles` get one word.
    expect(see).toMatchObject({ genders: ['m'], plural: 'Seen', translations: { ru: [['озеро']], en: [['lake']] } });
    expect(see.examples[0]).toBe('Ein ausgetrockneter See hat kein Wasser mehr.');
    expect(see.articles!.map((a) => [a.genders, a.translations.ru, a.translations.en])).toEqual([
      [['m'], [['озеро']], [['lake']]],
      [['f'], [['море']], [['sea']]],
    ]);
    expect(see.articles![1].examples.every((x) => !x.includes('ausgetrocknet'))).toBe(true);
  });

  it('leaves out colloquial senses and labelled words when plain ones exist', () => {
    // anrufen 3 "''imperfektiv:'' звонить" is a plain note; Teil 2–3 are colloquial.
    expect(entry('anrufen').translations.ru).toContainEqual(['звонить', 'позвонить']);
    expect(entry('Teil').translations.ru).toEqual([['часть']]);
    expect(entry('schön').translations.en).toEqual([['beautiful', 'nice']]);
  });

  it('reads separable verbs', () => {
    const e = entry('anrufen');
    expect(e.praeteritum).toBe('rief an');
    expect(e.partizip2).toBe('angerufen');
    expect(e.auxiliary).toBe('haben');
  });

  it('reads adjectives', () => {
    expect(entry('schön').pos).toBe('adj');
  });

  it('points inflected forms to the lemma', () => {
    expect(entry('ging').lemma).toBe('gehen');
    expect(entry('Häuser').lemma).toBe('Haus');
  });

  it('prefers short example sentences without citations', () => {
    const ex = entry('Hausschlüssel').examples;
    expect(ex[0]).toBe('Ich habe meinen Hausschlüssel verloren.');
    expect(ex.every((s) => !s.includes('<ref'))).toBe(true);
  });

  it('returns null without a German section', () => {
    expect(parseEntry('x', '== x ({{Sprache|Englisch}}) ==\n=== {{Wortart|Substantiv|Englisch}} ===')).toBeNull();
  });
});

describe('translation tables', () => {
  it('splits lines at top-level separators and sense markers', () => {
    expect(lineSegments(' {{Ü|en|a}}, to {{Ü|en|b}} ({{Ü|en|c}}, d); [2] {{Ü|en|e}}')).toEqual([
      '{{Ü|en|a}}',
      'to {{Ü|en|b}} ({{Ü|en|c}}, d)',
      '[2]',
      '{{Ü|en|e}}',
    ]);
  });

  it('reads an old single table with [N] markers', () => {
    const body = [
      '{{Ü-Tabelle|Ü-links=',
      '*{{en}}: [1] {{Ü|en|consequence}}; [2] {{Ü|en|sequence}}, {{Ü|en|series}}; [3] {{Ü|en|episode}}',
      '*{{fr}}: [1] {{Ü|fr|conséquence}}; [2] {{Ü|fr|suite}}; [3] {{Ü|fr|épisode}}',
      '|Ü-rechts=',
      "*{{ru}}: [1] {{Üt|ru|последствие}}; [3] ''umgangssprachlich:'' {{Üt|ru|серия}}, {{Üt|ru|эпизод}}",
      '}}',
    ].join('\n');
    expect(parseSenseTranslations(body, 'en')).toEqual([
      { n: 1, words: [{ word: 'consequence', labelled: false }], weight: 3 },
      { n: 2, words: [{ word: 'sequence', labelled: false }, { word: 'series', labelled: false }], weight: 2 },
      { n: 3, words: [{ word: 'episode', labelled: false }], weight: 3 },
    ]);
    const ru = parseSenseTranslations(body, 'ru').find((s) => s.n === 3)!;
    expect(ru.words).toEqual([
      { word: 'серия', labelled: true },
      { word: 'эпизод', labelled: false },
    ]);
  });

  it('moves words after a marker to that sense inside a numbered table', () => {
    const body = [
      '{{Ü-Tabelle|2|G=zeitlich|Ü-Liste=',
      '*{{ru}}: {{Üt|ru|приходить}}; [4] {{Üt|ru|кончить}}',
      '}}',
      '{{Ü-Tabelle|6a|G=Militär|Ü-Liste=',
      '*{{en}}: {{Ü|en|platoon}}',
      '}}',
    ].join('\n');
    const ru = parseSenseTranslations(body, 'ru').filter((s) => s.words.length);
    expect(ru.map((s) => [s.n, s.words.map((w) => w.word)])).toEqual([
      [2, ['приходить']],
      [4, ['кончить']],
    ]);
    // "6a" belongs to sense 6.
    expect(parseSenseTranslations(body, 'en').find((s) => s.words.length)!.n).toBe(6);
  });
});

describe('helpers', () => {
  it('keeps pipes inside values', () => {
    const p = templateParams('{{Deutsch Verb Übersicht\n|Hilfsverb=sein\n|Bild=a.gif|mini|1|Text\n}}', 'Deutsch Verb Übersicht');
    expect(p).toEqual({ Hilfsverb: 'sein', Bild: 'a.gif|mini|1|Text' });
  });

  it('strips markup', () => {
    expect(stripMarkup("Ich ''gehe'' über die [[Straße]]&nbsp;… [[Haus|Häuser]]{{Ref|x}}")).toBe('Ich gehe über die Straße … Häuser');
  });
});

describe('fetchWikitexts', () => {
  afterEach(() => vi.unstubAllGlobals());
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  it('maps normalized and redirected titles back, and marks missing or invalid ones', async () => {
    const fetch = vi.fn(async (_url: string) =>
      json({
        query: {
          normalized: [{ from: 'Rote_Bete', to: 'Rote Bete' }],
          redirects: [{ from: 'Rote Bete', to: 'Bete' }],
          pages: [
            { pageid: 1, ns: 0, title: 'Bete', revisions: [{ slots: { main: { content: 'B' } } }] },
            { pageid: 2, ns: 0, title: 'Haus', revisions: [{ slots: { main: { content: 'H' } } }] },
            { ns: 0, title: 'Qwrtz', missing: true },
            { title: 'x[y', invalid: true },
          ],
        },
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const out = await fetchWikitexts(['Rote_Bete', 'Haus', 'Qwrtz', 'x[y', 'a|b', 'Haus']);
    expect(Object.fromEntries(out)).toEqual({ Rote_Bete: 'B', Haus: 'H', Qwrtz: null, 'x[y': null, 'a|b': null });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(new URL(fetch.mock.calls[0][0]).searchParams.get('titles')).toBe('Rote_Bete|Haus|Qwrtz|x[y');
  });

  it('asks again for pages a cut-short response left out, but not for ones it never sends', async () => {
    const page = (title: string, content?: string) =>
      content === undefined ? { pageid: 1, ns: 0, title } : { pageid: 1, ns: 0, title, revisions: [{ slots: { main: { content } } }] };
    const replies = [
      { query: { pages: [page('A', 'a'), page('B'), page('C')] } },
      { query: { pages: [page('B', 'b'), page('C')] } },
      { query: { pages: [page('C')] } },
    ];
    const fetch = vi.fn(async () => json(replies.shift()));
    vi.stubGlobal('fetch', fetch);
    const out = await fetchWikitexts(['A', 'B', 'C']);
    expect(Object.fromEntries(out)).toEqual({ A: 'a', B: 'b' });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('reports a rate limit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'ratelimited' } })));
    await expect(fetchWikitexts(['A'])).rejects.toBeInstanceOf(RateLimitError);
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 429)));
    await expect(fetchWikitexts(['A'])).rejects.toBeInstanceOf(RateLimitError);
  });

  it('splits titles into requests of 50', () => {
    const titles = Array.from({ length: 120 }, (_, i) => `T${i}`);
    expect(titleChunks(titles).map((c) => c.length)).toEqual([50, 50, 20]);
    expect(titleChunks(Array.from({ length: 50 }, (_, i) => 'Ä'.repeat(40) + i)).length).toBeGreaterThan(1);
  });
});
