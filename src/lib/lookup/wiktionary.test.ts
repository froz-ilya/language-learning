import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWikitexts, lineSegments, markerNumbers, parseEntry, RateLimitError, titleChunks, parseSenseTranslations, stripMarkup, templateParams } from './wiktionary';
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

  it('ties examples and translations to their sense', () => {
    const folge = entry('Folge');
    const sense = (n: number) => folge.senses!.find((s) => s.n === n)!;
    expect(folge.senses!.map((s) => s.n)).toEqual([1, 2, 3, 4]);
    expect(sense(1).translations.ru).toEqual(['последствие']);
    // A short self-made sentence comes before the quotes.
    expect(sense(1).examples[0]).toBe('Schulden waren die Folge der zu hohen Ausgaben.');
    expect(sense(2)).toEqual({
      n: 2,
      translations: { en: ['order'], ru: ['череда', 'ряд'] },
      examples: ['Nach einer Folge von mysteriösen Zwischenfällen wurde ein Ermittler mit deren Aufklärung beauftragt.'],
    });
    expect(sense(3).examples).toEqual(['Nach der dritten Folge wurde die Fernsehserie mangels Zuschauerinteresses abgesetzt.']);
    // Sense 4 has a translation but its only example is too long.
    expect(sense(4).examples).toEqual([]);
  });

  it('gives an example marked with several senses to each of them', () => {
    const haus = entry('Haus');
    const examples = (n: number) => haus.senses!.find((s) => s.n === n)!.examples;
    expect(examples(1)).toContain('Das Haus steht seit 1898.'); // [1, 2]
    expect(examples(2)).toEqual(expect.arrayContaining(['Das Haus steht seit 1898.', 'Mein Haus wird gerade renoviert.']));
    expect(examples(3)).toContain('Mein Haus wird gerade renoviert.'); // [2, 3]
    expect(examples(1)).not.toContain('Mein Haus wird gerade renoviert.');
    expect(haus.senses!.every((s) => s.examples.length <= 3)).toBe(true);
    // The block's own examples are unchanged.
    expect(haus.examples).toEqual(['Das Haus steht seit 1898.', 'Mein Haus wird gerade renoviert.', 'Kommst du mit nach Hause?']);
  });

  it('keeps senses of merged blocks apart (Bank: bench 1–6, bank 101–102)', () => {
    const bank = entry('Bank');
    expect(bank.senses!.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6, 101, 102]);
    const bench = bank.senses![0];
    expect(bench.translations.ru.slice(0, 2)).toEqual(['скамейка', 'скамья']);
    expect(bench.examples[0]).toBe('Sollen wir uns auf diese Bank setzen?');
    const money = bank.senses!.find((s) => s.n === 101)!;
    expect(money.translations).toEqual({ en: ['bank'], ru: ['банк'] });
    expect(money.examples[0]).toBe('Diese Bank wäre bei dem Großbrand gestern fast abgebrannt.');
  });

  it('gives each noun article its own senses (der See, die See)', () => {
    const see = entry('See');
    const [lake, sea] = see.articles!;
    expect(lake.senses!.map((s) => [s.n, s.translations.ru])).toEqual([[1, ['озеро']]]);
    expect(see.senses).toEqual(lake.senses);
    expect(sea.senses!.map((s) => s.n)).toEqual([1, 2, 3]);
    expect(sea.senses![0].translations.ru).toEqual(['море']);
    expect(sea.senses![1].examples).toContain('Schon seit Tagen umtoste uns die See.');
    expect(sea.senses!.flatMap((s) => s.examples).some((x) => x.includes('ausgetrocknet'))).toBe(false);
  });

  it('reads set phrases (infrage: infrage kommen, infrage stellen)', () => {
    const e = entry('infrage');
    // "''infrage'' kommen, [[infrage stellen|''infrage'' stellen]], stehen": "stehen" lacks the word.
    expect(e.phrases).toEqual([{ de: 'infrage kommen' }, { de: 'infrage stellen' }]);
    expect(e.senses).toEqual([
      {
        n: 1,
        translations: { en: ['contemplable', 'eligible', 'in question'], ru: [] },
        examples: ['Das kommt überhaupt nicht infrage.', 'Ich stelle das Ergebnis infrage.'],
      },
    ]);
  });

  it('reads phrases from collocations, idioms and "in der Wendung" definitions', () => {
    // Collocations first; at most three.
    expect(entry('Folge').phrases).toEqual([{ de: 'Folge leisten' }, { de: 'zur Folge haben' }, { de: 'in der Folge' }]);
    // Idioms keep their explanation as the note ("– immer wieder auf einen späteren Zeitpunkt verschieben").
    const bank = entry('Bank').phrases!;
    expect(bank.map((p) => p.de)).toEqual(['durch die Bank', 'etwas auf die lange Bank schieben', 'eine sichere Bank']);
    expect(bank[1].note).toBe('immer wieder auf einen späteren Zeitpunkt verschieben');
    expect(bank[2]).toEqual({ de: 'eine sichere Bank' });
    // ":[1] [[ein#Artikel|ein]] ''Haus'' [[abbrechen]], [[abreißen]], …": only parts with the word.
    expect(entry('Haus').phrases![0]).toEqual({ de: 'ein Haus abbrechen' });
    // ":[1] ''in der Wendung:'' jemandem den Garaus machen – ermorden, töten, umbringen"
    expect(entry('Garaus').phrases).toEqual([{ de: 'jemandem den Garaus machen', note: 'ermorden, töten, umbringen' }]);
    expect(entry('Hausschlüssel').phrases).toBeUndefined();
    for (const name of ['Haus', 'gehen', 'Tisch', 'Schlüssel', 'Teil', 'schön', 'anrufen']) {
      for (const { de: p, note } of entry(name).phrases ?? []) {
        expect(p.length).toBeLessThanOrEqual(60);
        expect(p.toLowerCase()).toContain(name.toLowerCase());
        expect(p).not.toMatch(/[[\]{}'–]/);
        if (note) expect(note).not.toMatch(/^[–—-]|[[\]{}]|''/);
      }
    }
  });

  it('reads quoted phrases of a definition that names them', () => {
    const page = [
      '== wett ({{Sprache|Deutsch}}) ==',
      '=== {{Wortart|Adjektiv|Deutsch}} ===',
      '{{Bedeutungen}}',
      ':[1] nur in den Wendungen ‚wett sein‘ und ‚[[wettmachen|wett machen]]‘: ausgeglichen',
      '',
    ].join('\n');
    expect(parseEntry('wett', page)!.phrases).toEqual([{ de: 'wett sein' }, { de: 'wett machen' }]);
  });

  it('has no senses when examples name no sense', () => {
    const page = [
      '== Dings ({{Sprache|Deutsch}}) ==',
      '=== {{Wortart|Substantiv|Deutsch}}, {{n}} ===',
      '{{Bedeutungen}}',
      ':irgendein Gegenstand',
      '',
      '{{Beispiele}}',
      ':Gib mir mal das Dings da.',
      '',
    ].join('\n');
    const e = parseEntry('Dings', page)!;
    expect(e.examples).toEqual(['Gib mir mal das Dings da.']);
    expect(e.senses).toBeUndefined();
    // A numbered sense the page ties nothing to is left out as well.
    const numbered = parseEntry('Dings', page.replace(':irgendein', ':[1] irgendein'))!;
    expect(numbered.senses).toBeUndefined();
    expect(numbered.examples).toEqual(['Gib mir mal das Dings da.']);
  });

  it('returns null without a German section', () => {
    expect(parseEntry('x', '== x ({{Sprache|Englisch}}) ==\n=== {{Wortart|Substantiv|Englisch}} ===')).toBeNull();
  });
});

describe('reflexive verbs and prepositions', () => {
  const senseOf = (e: ReturnType<typeof entry>, n: number) => e.senses!.find((s) => s.n === n)!;

  it('marks senses labelled {{K|refl.}} and reads their prepositions (freuen)', () => {
    const e = entry('freuen');
    expect(e.reflexive).toBe('also');
    expect(e.senses!.map((s) => [s.n, !!s.reflexive])).toEqual([
      [1, true],
      [2, true],
      [3, false],
    ]);
    // ''sich (über etwas) freuen:'', ''sich auf etwas freuen:''
    expect(senseOf(e, 1).preps).toEqual(['über + Akk']);
    expect(senseOf(e, 2).preps).toEqual(['auf + Akk']);
    expect(senseOf(e, 3).preps).toBeUndefined();
    expect(e.preps).toBe('über + Akk; auf + Akk');
    expect(e.reflexiveTranslations!.ru).toEqual([['радоваться']]);
    // "es freut mich" ([3]) has no Russian translation: all senses' meanings stay.
    expect(e.translations.ru).toEqual([['радоваться']]);
  });

  it('marks "reflexiv, …:" senses and keeps the others’ translations apart (treffen)', () => {
    const e = entry('treffen');
    expect(e.reflexive).toBe('also');
    expect(e.senses!.filter((s) => s.reflexive).map((s) => s.n)).toEqual([2, 5]);
    expect(senseOf(e, 2).examples).toEqual(['Die zwei Fußballmannschaften treffen sich auf dem Fußballfeld.']);
    expect(e.translations.ru).toEqual([['встретить'], ['попадать']]);
    expect(e.reflexiveTranslations).toEqual({ en: [], ru: [] });
    // "auf etwas oder jemandem aufprallen" is the definition, not how treffen is used.
    expect(e.preps).toBeUndefined();
  });

  it('calls a verb whose every sense is reflexive reflexive-only (beeilen)', () => {
    const e = entry('beeilen');
    expect(e.reflexive).toBe('only');
    expect(e.reflexiveTranslations!.ru).toEqual([['торопиться', 'спешить']]);
    expect(e.translations.ru).toEqual([['торопиться', 'спешить']]);
    // [1b] ''sich beeilen mit etwas''; not "um" of "sich beeilen, um (…) etwas zu machen" ([1a]).
    expect(e.preps).toBe('mit + Dat');
  });

  it('finds nothing reflexive in other verbs and words', () => {
    for (const name of ['gehen', 'anrufen', 'Haus', 'schön']) {
      const e = entry(name);
      expect(e.reflexive).toBeUndefined();
      expect(e.reflexiveTranslations).toBeUndefined();
      expect(e.senses?.some((s) => s.reflexive)).toBeFalsy();
      expect(e.preps).toBeUndefined();
    }
  });

  const verbPage = (word: string, meanings: string[], examples: string[] = []) =>
    [
      `== ${word} ({{Sprache|Deutsch}}) ==`,
      '=== {{Wortart|Verb|Deutsch}} ===',
      '{{Bedeutungen}}',
      ...meanings,
      '',
      '{{Beispiele}}',
      ...examples,
      '',
      '==== {{Übersetzungen}} ====',
      '{{Ü-Tabelle|1|G=x|Ü-Liste=',
      '*{{ru}}: {{Üt|ru|раз}}',
      '}}',
      '{{Ü-Tabelle|2|G=y|Ü-Liste=',
      '*{{ru}}: {{Üt|ru|два}}',
      '}}',
      '',
    ].join('\n');

  it('marks the senses under a "reflexiv:" heading', () => {
    const e = parseEntry('waschen', verbPage('waschen', ["''transitiv:''", ':[1] etwas sauber machen', "''reflexiv:''", ':[2] den eigenen Körper sauber machen'], [':[1] Ich wasche das Auto.', ':[2] Ich wasche mich.']))!;
    expect(e.senses!.map((s) => [s.n, !!s.reflexive])).toEqual([
      [1, false],
      [2, true],
    ]);
    expect(e.translations.ru).toEqual([['раз']]);
    expect(e.reflexiveTranslations!.ru).toEqual([['два']]);
  });

  it('reads prepositions from K parameters and explicit cases, and leaves an unclear case out', () => {
    const e = parseEntry(
      'denken',
      verbPage('denken', [
        ':[1] {{K|intrans.|Prä=an|Kas=Akk.}} gedanklich bei etwas sein',
        ":[2] ''an etwas denken:'' sich erinnern",
        ":[3] ''mit jemandem über etwas denken'' (an + Dativ) dies und das",
      ]),
    )!;
    expect(e.reflexive).toBeUndefined();
    expect(senseOf(e, 1).preps).toEqual(['an + Akk']);
    // "an etwas": Akk or Dat — not guessed.
    expect(senseOf(e, 2).preps).toBeUndefined();
    // Only the labels count, not the explanation after them.
    expect(senseOf(e, 3).preps).toEqual(['mit + Dat', 'über + Akk']);
    expect(e.preps).toBe('an + Akk; mit + Dat; über + Akk');
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

  it('reads sense markers', () => {
    expect(markerNumbers('1')).toEqual([1]);
    expect(markerNumbers('1, 2')).toEqual([1, 2]);
    expect(markerNumbers('1–3, 5')).toEqual([1, 2, 3, 5]);
    expect(markerNumbers('2a')).toEqual([2]);
    expect(markerNumbers('*')).toEqual([]);
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
