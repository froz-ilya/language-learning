// Tests for the level-preset build pipeline (scripts/levels/lib/*.mjs) on real, trimmed
// kaikki.org lines (German Wiktionary, CC BY-SA) in scripts/levels/__fixtures__/.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  addArticle,
  articleRecord,
  cleanExample,
  cleanTranslation,
  formatMeanings,
  limitMeanings,
  mergeLemma,
  parseKaikkiEntry,
  parseMeanings,
  sameMeaning,
  similarWord,
} from '../../../scripts/levels/lib/extract.mjs';
import {
  articleCounts,
  candidates,
  exclusionReason,
  groupTranslations,
  lemmaCounts,
  mainArticles,
  rankLemmas,
  tieRank,
} from '../../../scripts/levels/lib/rank.mjs';
import { buildLevels, groupTopics, topicOf } from '../../../scripts/levels/lib/levels.mjs';
import { articleWords, baseWords, levelOf } from '../../../scripts/levels/lib/words.mjs';
import { splitLines } from '../../../scripts/levels/lib/google.mjs';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const lines: Any[] = readFileSync(new URL('../../../scripts/levels/__fixtures__/kaikki-sample.jsonl', import.meta.url), 'utf8')
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l));
const parsed: Any[] = lines.map((l) => parseKaikkiEntry(l));
const lemma = (word: string, pos?: string): Any =>
  parsed.find((r) => r?.kind === 'lemma' && r.word === word && (!pos || r.rawPos === pos));
const form = (word: string): Any[] => parsed.filter((r) => r?.kind === 'form' && r.word === word);

describe('parseKaikkiEntry', () => {
  it('reads noun gender, plural, translations and an own example', () => {
    const t = lemma('Tisch');
    expect(t).toMatchObject({ pos: 'noun', genders: ['m'], plural: 'Tische' });
    // Single-meaning words stay one meaning.
    expect(t.tr.en).toEqual([['table']]);
    expect(t.tr.ru).toEqual([['стол']]);
    expect(t.examples[0]).toBe('Der Tisch ist für die vielen Personen heute zu klein.');
    expect(t.forms).toContain('tische');
  });

  it('reads verb Präteritum, Partizip II and auxiliary', () => {
    expect(lemma('gehen')).toMatchObject({ pos: 'verb', praeteritum: 'ging', partizip2: 'gegangen', auxiliary: 'sein' });
    expect(lemma('anrufen')).toMatchObject({ praeteritum: 'rief an', partizip2: 'angerufen', auxiliary: 'haben' });
    expect(lemma('gehen').tr.en[0]).toEqual(['go', 'walk']);
    expect(lemma('gehen').forms).toContain('geht');
    // Imperatives are not used to map tokens ("geh!" is rare, "schon!" would steal "schon").
    expect(lemma('gehen').forms).not.toContain('geh');
  });

  it('maps inflected forms to lemmas, also via the gloss', () => {
    expect(form('ging')[0].lemmas).toEqual(['gehen']);
    expect(form('Häuser')[0].lemmas).toEqual(['Haus']);
    expect(form('bin')[0].lemmas).toEqual(['sein']);
    expect(form('schon')[0]).toMatchObject({ lemmas: ['schonen'], imperative: true });
  });

  it('flags offensive words, interjections and nominalised adjectives', () => {
    expect(lemma('Scheiße').offensive).toBe(true);
    expect(lemma('Tisch').offensive).toBe(false);
    expect(lemma('hallo')).toMatchObject({ rawPos: 'intj', pos: 'other' });
    expect(lemma('Letzter').nominalised).toBe(true);
    expect(lemma('Mutter', 'name')).toBeTruthy();
  });

  it('groups translations by meaning, from the senses that matter', () => {
    // Mutter: мать, мама (sense 1), then the uterus sense — one meaning each.
    const mother = parsed.find((r) => r?.kind === 'lemma' && r.word === 'Mutter' && r.rawPos === 'noun');
    expect(mother.tr.ru[0]).toEqual(['мать', 'мама']);
    expect(mother.tr.ru.length).toBeLessThanOrEqual(3);
    const kommen: Any = parseKaikkiEntry({
      word: 'kommen',
      pos: 'verb',
      lang_code: 'de',
      senses: [
        { glosses: ['einen Ort erreichen'], tags: ['intransitive', 'regional'], sense_index: '1' },
        { glosses: ['beginnen'], sense_index: '2' },
        { glosses: ['Springer'], tags: ['colloquial'], sense_index: '3' },
        { glosses: ['einen Orgasmus haben'], tags: ['colloquial', 'vulgar'], sense_index: '4' },
      ],
      translations: [
        { lang_code: 'ru', word: 'прибывать', sense_index: '1' },
        { lang_code: 'ru', word: 'приходить', sense_index: '1' },
        { lang_code: 'ru', word: 'кончить', sense_index: '4' },
        { lang_code: 'en', word: 'horse', sense_index: '1' },
        { lang_code: 'en', word: 'equidae', sense_index: '2', raw_tags: ['Pl.,'] },
        { lang_code: 'en', word: 'knight', sense_index: '3' },
      ],
    });
    // Sense 1 is never marginal; labelled senses (3, 4) and labelled-only senses (2) add nothing.
    expect(kommen.tr.ru).toEqual([['прибывать', 'приходить']]);
    expect(kommen.tr.en).toEqual([['horse']]);
  });

  // Folge: consequence / sequence / episode of a series, as Wiktionary orders them. The weight of
  // a sense is how many languages translate it; light senses ("Zug": groove) are left out.
  const tr = (n: string, lang: string, word: string) => ({ lang_code: lang, word, sense_index: n });
  const others = (n: string, count: number) => ['fr', 'es', 'it', 'pl', 'nl', 'sv', 'cs', 'fi'].slice(0, count).map((l) => tr(n, l, 'x'));
  const folge: Any = {
    word: 'Folge',
    pos: 'noun',
    lang_code: 'de',
    tags: ['feminine'],
    senses: ['1', '2', '3', '4', '5'].map((n) => ({ glosses: [`sense ${n}`], sense_index: n })),
    translations: [
      tr('1', 'en', 'consequence'), tr('1', 'ru', 'последствие'), tr('1', 'ru', 'результат'), ...others('1', 6),
      tr('2', 'en', 'order'), tr('2', 'en', 'sequence'), tr('2', 'ru', 'череда'), tr('2', 'ru', 'ряд'), tr('2', 'ru', 'серия'), ...others('2', 6),
      tr('3', 'en', 'episode'), tr('3', 'ru', 'эпизод'), tr('3', 'ru', 'серия'), ...others('3', 7),
      tr('4', 'en', 'sequence'), tr('4', 'ru', 'последовательность'), ...others('4', 5),
      tr('5', 'en', 'result'), tr('5', 'ru', 'исход'),
    ],
  };

  it('keeps up to three meanings of two synonyms in sense order (Folge)', () => {
    const f: Any = parseKaikkiEntry(folge);
    expect(f.tr.ru).toEqual([['последствие', 'результат'], ['череда', 'ряд'], ['эпизод', 'серия']]);
    expect(f.tr.en).toEqual([['consequence'], ['order', 'sequence'], ['episode']]);
    expect(formatMeanings(f.tr.ru)).toBe('последствие, результат; череда, ряд; эпизод, серия');
  });

  it('skips a meaning whose words are used already and light senses', () => {
    const house: Any = parseKaikkiEntry({
      word: 'Haus',
      pos: 'noun',
      lang_code: 'de',
      senses: ['1', '2', '3'].map((n) => ({ glosses: [`sense ${n}`], sense_index: n })),
      translations: [
        tr('1', 'ru', 'дом'), tr('1', 'en', 'house'), ...others('1', 8),
        tr('2', 'ru', 'дом'), tr('2', 'en', 'house'), ...others('2', 6),
        // Translated into 2 languages only, against 10 for sense 1: not a meaning of its own.
        tr('3', 'ru', 'раковина'), tr('3', 'en', 'shell'),
      ],
    });
    expect(house.tr.ru).toEqual([['дом']]);
    expect(house.tr.en).toEqual([['house']]);
  });

  it('merges same-gender homonyms meaning by meaning, not other genders', () => {
    const [mother, nut] = parsed.filter((r) => r?.kind === 'lemma' && r.word === 'Mutter' && r.rawPos === 'noun');
    const m = mergeLemma(mother, nut);
    expect(m.plural).toBe('Mütter');
    // "Bank" (bench) + "Bank" (bank) works the same way.
    expect(m.tr.en).toEqual([['mother'], ['nut']]);
    expect(m.tr.ru[0]).toEqual(['мать', 'мама']);
    expect(m.tr.ru[1]).toEqual(['гайка']);
    // der Leiter (leader) and die Leiter (ladder) are different words: the first one keeps its own.
    const leader = { ...mother, word: 'Leiter', genders: ['m'], tr: { en: [['leader']], ru: [['руководитель']] } };
    const ladder = { ...nut, word: 'Leiter', genders: ['f'], tr: { en: [['ladder']], ru: [] } };
    expect(mergeLemma(leader, ladder).tr).toEqual({ en: [['leader']], ru: [['руководитель']] });
    expect(mergeLemma({ ...leader, tr: { en: [], ru: [] } }, ladder).tr.en).toEqual([['ladder']]);
  });
});

describe('meanings', () => {
  it('drops near-duplicates and caps meanings and synonyms', () => {
    expect(similarWord('current', 'electric current')).toBe(true);
    expect(similarWord('ток', 'электрический ток')).toBe(true);
    expect(similarWord('current', 'currency')).toBe(false);
    expect(limitMeanings([['current', 'stream', 'flow'], ['river'], ['electric current'], ['power']])).toEqual([
      ['current', 'stream'],
      ['river'],
      ['power'],
    ]);
    // A single meaning keeps three synonyms.
    expect(limitMeanings([['мать', 'мама', 'матерь', 'мамочка']])).toEqual([['мать', 'мама', 'матерь']]);
    expect(limitMeanings([['дом'], ['дом']])).toEqual([['дом']]);
  });

  it('formats and parses "a, b; c"', () => {
    expect(formatMeanings([['последствие', 'результат'], ['серия', 'эпизод'], ['ряд']])).toBe('последствие, результат; серия, эпизод; ряд');
    expect(formatMeanings([['стол']])).toBe('стол');
    expect(formatMeanings([])).toBe('');
    expect(parseMeanings('bench; bank')).toEqual([['bench'], ['bank']]);
    expect(parseMeanings('stay, remain')).toEqual([['stay', 'remain']]);
  });
});

describe('cleaning', () => {
  it('normalises translations', () => {
    expect(cleanTranslation('call ( against )', 'en')).toBe('call');
    expect(cleanTranslation('to go', 'en')).toBe('go');
    expect(cleanTranslation('come on !', 'en')).toBe('come on');
    expect(cleanTranslation('or ; or else', 'en')).toBe('or');
    expect(cleanTranslation('make do (with) ,', 'en')).toBe('make do');
    expect(cleanTranslation('мочь „dürfen“', 'ru')).toBe('мочь');
    expect(cleanTranslation('идти (Uhr)', 'ru')).toBe('идти');
    expect(cleanTranslation('заве́дующий', 'ru')).toBe('заведующий');
    expect(cleanTranslation('café', 'en')).toBe('café');
  });
  it('strips quotes and date prefixes from examples', () => {
    expect(cleanExample('„Ich gehe.“')).toBe('Ich gehe.');
    expect(cleanExample('[2023:] Auf der Erde leben Menschen.')).toBe('Auf der Erde leben Menschen.');
  });
});

describe('ranking', () => {
  const rec = (word: string, rawPos: string, extra: Any = {}): Any => ({
    word,
    rawPos,
    pos: ['noun', 'verb', 'adj'].includes(rawPos) ? rawPos : 'other',
    tr: { en: [[word]], ru: [[word]] },
    tags: [],
    senses: 2,
    trCount: 4,
    offensive: false,
    ...extra,
  });
  const lemmas: Any = {
    'schon|adv': rec('schon', 'adv'),
    'schonen|verb': rec('schonen', 'verb'),
    'lieben|verb': rec('lieben', 'verb'),
    'Liebe|noun': rec('Liebe', 'noun'),
    'gut|adj': rec('gut', 'adj'),
    'Guter|noun': rec('Guter', 'noun', { nominalised: true }),
  };
  const dict = {
    lemmas,
    forms: {
      schon: ['schon|adv', '!schonen|?verb'],
      schont: ['schonen|verb'],
      liebe: ['lieben|?verb', 'Liebe|noun'],
      liebst: ['lieben|?verb'],
      gute: ['gut|?adj', 'Guter|noun'],
    } as Record<string, string[]>,
  };
  const freq: [string, number][] = [
    ['schon', 1000],
    ['schont', 10],
    ['liebe', 1000],
    ['liebst', 5000],
    ['gute', 500],
  ];
  const cands = candidates(freq, dict);

  it('drops imperative-only and nominalised readings', () => {
    expect(cands.get('schon')).toEqual(['schon|adv']);
    expect(cands.get('gute')).toEqual(['gut|adj']);
  });

  it('keeps a floor share for a noun whose base form is also a verb form', () => {
    const totals = lemmaCounts(freq, cands, lemmas);
    expect(totals.get('Liebe|noun')).toBeCloseTo(300, 0);
    expect(totals.get('lieben|verb')).toBeCloseTo(5700, 0);
  });

  it('ranks, groups and excludes', () => {
    const totals = lemmaCounts(freq, cands, lemmas);
    const ranked = rankLemmas(totals, lemmas);
    expect(ranked[0].key).toBe('lieben|verb');
    expect(exclusionReason(rec('Scheiße', 'noun', { offensive: true }))).toBe('offensive');
    expect(exclusionReason(rec('der', 'det'))).toBe('article');
    expect(exclusionReason(rec('Berlin', 'name'))).toBe('pos:name');
    expect(exclusionReason(rec('Sie', 'pron'))).toBe('capitalised non-noun');
    expect(exclusionReason(rec('Haus', 'noun', { tr: { en: [], ru: [] } }))).toBe('no translation');
    expect(exclusionReason(rec('Haus', 'noun'))).toBe('');
  });

  it('puts the adverb reading before the modal particle', () => {
    const l: Any = {
      'schon|particle': rec('schon', 'particle', { tr: { en: [['indeed']], ru: [['же']] } }),
      'schon|adv': rec('schon', 'adv', { tr: { en: [['already'], ['yet']], ru: [['уже']] } }),
    };
    // Each reading is a meaning of the card.
    expect(groupTranslations(['schon|particle', 'schon|adv'], l, 'en')).toEqual([['already'], ['indeed'], ['yet']]);
    expect(groupTranslations(['schon|adv'], l, 'ru')).toEqual([['уже']]);
  });
});

describe('articles with different meanings', () => {
  // Compact records as parseKaikkiEntry makes them (one per Wiktionary entry).
  const noun = (word: string, g: string, ru: string[][], en: string[][], extra: Any = {}): Any => ({
    kind: 'lemma',
    word,
    rawPos: 'noun',
    pos: 'noun',
    genders: g ? [g] : [],
    plural: '',
    praeteritum: '',
    partizip2: '',
    auxiliary: '',
    tr: { ru, en },
    examples: [],
    forms: [word.toLowerCase()],
    offensive: false,
    tags: [],
    senses: 1,
    trCount: 2,
    ...extra,
  });
  const collect = (...recs: Any[]) => recs.reduce((list, r) => addArticle(list, r), [] as Any[]);

  it('splits a noun only when the article and the meaning differ', () => {
    const see = collect(
      noun('See', 'm', [['озеро']], [['lake']], { plural: 'Seen' }),
      noun('See', 'f', [['море']], [['sea']]),
    );
    expect(see.map((a: Any) => [a.genders, a.tr.ru])).toEqual([
      [['m'], [['озеро']]],
      [['f'], [['море']]],
    ]);
    // Several meanings with one article stay one word ("die Bank": bench; bank).
    const bank = collect(noun('Bank', 'f', [['скамейка']], [['bench']]), noun('Bank', 'f', [['банк']], [['bank']]));
    expect(bank).toHaveLength(1);
    expect(bank[0].tr.ru).toEqual([['скамейка'], ['банк']]);
    // Gender variants of one meaning stay one word (der/das Teil: часть).
    const teil = collect(noun('Teil', 'n', [['часть']], [['part', 'piece']]), noun('Teil', 'm', [['часть']], [['part'], ['portion']]));
    expect(teil).toHaveLength(1);
    expect(teil[0].genders).toEqual(['n']);
    // An entry without translations can't be told apart: it joins (der Hut + die Hut).
    expect(collect(noun('Hut', 'm', [['шляпа']], [['hat']]), noun('Hut', 'f', [], []))).toHaveLength(1);
  });

  it('keeps homonyms of each article together (das Band ×2, der Band, die Band)', () => {
    const band = collect(
      noun('Band', 'n', [['лента']], [['ribbon']]),
      noun('Band', 'm', [['том']], [['volume']]),
      noun('Band', 'f', [['группа']], [['band']]),
      noun('Band', 'n', [['узы']], [['bond']]),
    );
    expect(band.map((a: Any) => a.genders[0])).toEqual(['n', 'm', 'f']);
    expect(band[0].tr.ru).toEqual([['лента'], ['узы']]);
    expect(articleRecord(band[1])).toEqual({
      genders: ['m'],
      plural: '',
      tr: { ru: [['том']], en: [['volume']] },
      examples: [],
      forms: ['band'],
      offensive: false,
      senses: 1,
      trCount: 2,
    });
  });

  it('compares first meanings in any language both have', () => {
    expect(sameMeaning(noun('Kristall', 'm', [['кристалл']], [['crystal']]), noun('Kristall', 'n', [], [['crystal']]))).toBe(true);
    expect(sameMeaning(noun('Golf', 'm', [['залив'], ['гольф']], [['gulf']]), noun('Golf', 'n', [['гольф']], [['golf']]))).toBe(false);
  });

  it('uses the main article’s own translations, plural and examples for the ranked word', () => {
    // dict.json as buildDict writes it: the merged record (as before) plus `articles`.
    const recs = [
      noun('Steuer', 'n', [['руль']], [['rudder']], { plural: 'Steuer' }),
      noun('Steuer', 'f', [['налог']], [['tax']], { plural: 'Steuern', examples: ['Steuern zahlen.'] }),
    ];
    const lemmas: Any = { 'Steuer|noun': { ...mergeLemma(recs[0], recs[1]), articles: collect(...recs).map(articleRecord) } };
    // The merged record (used for ranking) is unchanged, with the other article's example.
    expect(lemmas['Steuer|noun'].examples).toEqual(['Steuern zahlen.']);
    const main = mainArticles(lemmas)['Steuer|noun'];
    expect(main).toMatchObject({ genders: ['n'], plural: 'Steuer', tr: { ru: [['руль']], en: [['rudder']] }, examples: [] });
  });

  it('estimates the other articles’ counts from their own forms, or a fixed share', () => {
    const lemmas: Any = {
      'Gehalt|noun': {
        ...noun('Gehalt', 'm', [['содержание']], [['content']]),
        articles: [
          articleRecord(noun('Gehalt', 'm', [['содержание']], [['content']], { forms: ['gehalt', 'gehalte'] })),
          articleRecord(noun('Gehalt', 'n', [['зарплата']], [['salary']], { forms: ['gehalt', 'gehälter'] })),
        ],
      },
    };
    const freq: [string, number][] = [
      ['gehalt', 1000],
      ['gehälter', 300],
      ['gehalte', 10],
    ];
    const cands = new Map(freq.map(([t]) => [t, ['Gehalt|noun']]));
    const totals = new Map([['Gehalt|noun', 1310]]);
    const [n] = articleCounts(freq, cands, lemmas, totals).get('Gehalt|noun')!;
    expect(n.gender).toBe('n');
    // Evidence 300 vs 10, smoothed by an even prior worth 50 tokens.
    expect(n.count).toBe(Math.round((1310 * (300 + 25)) / 360));
    expect(articleCounts(freq, cands, lemmas, totals, { 'Gehalt|noun#n': 0.5 }).get('Gehalt|noun')![0].count).toBe(655);
    // Without evidence a much poorer entry is a minor reading and gets nothing.
    const tor: Any = {
      'Tor|noun': {
        ...noun('Tor', 'n', [['ворота']], [['gate']]),
        articles: [
          articleRecord(noun('Tor', 'n', [['ворота']], [['gate']], { forms: ['tor', 'tore'], senses: 4, trCount: 12 })),
          articleRecord(noun('Tor', 'm', [['глупец']], [['fool']], { forms: ['tor', 'tore'], senses: 1, trCount: 3 })),
        ],
      },
    };
    const tf: [string, number][] = [
      ['tor', 5000],
      ['tore', 1000],
    ];
    const tc = new Map(tf.map(([t]) => [t, ['Tor|noun']]));
    expect(articleCounts(tf, tc, tor, new Map([['Tor|noun', 6000]])).get('Tor|noun')).toEqual([{ gender: 'm', count: 0 }]);
  });

  it('places tie ranks without moving the others', () => {
    expect(tieRank([100, 50, 50, 10], 60)).toBe(2);
    expect(tieRank([100, 50, 50, 10], 50)).toBe(2);
    expect(tieRank([100, 50, 50, 10], 5)).toBe(5);
  });

  it('adds the other article as its own preset word with a new id; existing ids stay', () => {
    const lemmas: Any = {
      'Haus|noun': { ...noun('Haus', 'n', [['дом']], [['house']]), examples: ['Das Haus ist groß.'] },
      'See|noun': {
        ...mergeLemma(noun('See', 'm', [['озеро']], [['lake']], { plural: 'Seen' }), noun('See', 'f', [['море']], [['sea']])),
        articles: [
          articleRecord(noun('See', 'm', [['озеро']], [['lake']], { plural: 'Seen' })),
          articleRecord(noun('See', 'f', [['море']], [['sea']], { examples: ['Wir fahren an die See.'] })),
        ],
      },
      'Tisch|noun': noun('Tisch', 'm', [['стол']], [['table']]),
    };
    const ranked = [
      { key: 'Haus|noun', count: 900, members: ['Haus|noun'] },
      { key: 'See|noun', count: 800, members: ['See|noun'] },
      { key: 'Tisch|noun', count: 700, members: ['Tisch|noun'] },
    ];
    const words: Any[] = baseWords(ranked, mainArticles(lemmas));
    const counts = new Map([['See|noun', [{ gender: 'f', count: 700 }]]]);
    const added: Any[] = articleWords(ranked, lemmas, counts);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      key: 'See|noun#f',
      mainKey: 'See|noun',
      article: 'f',
      term: 'See',
      genders: ['f'],
      rank: 3,
      example: 'Wir fahren an die See.',
    });
    expect(added[0].tr).toEqual({ ru: [['море']], en: [['sea']] });
    // Excluded, or without both languages: not a preset word.
    expect(articleWords(ranked, lemmas, counts, {}, new Set(['See|noun#f']))).toEqual([]);
    const noRu: Any = { ...lemmas, 'See|noun': { ...lemmas['See|noun'], articles: [lemmas['See|noun'].articles[0], { ...lemmas['See|noun'].articles[1], tr: { ru: [], en: [['sea']] } }] } };
    expect(articleWords(ranked, noRu, counts)).toEqual([]);
    for (const w of [...words, ...added]) w.topic = 'Natur & Wetter';
    const { files } = buildLevels([...words, ...added], 'src');
    const a1 = files[0].words;
    expect(a1.map((w: Any) => w.id)).toEqual(['A1:Haus', 'A1:See', 'A1:Tisch', 'A1:See#f']);
    expect(a1.map((w: Any) => w.rank)).toEqual([1, 2, 3, 3]);
    expect(a1[1]).toMatchObject({ genders: ['m'], plural: 'Seen', tr: { ru: 'озеро', en: 'lake' } });
    expect(a1[3]).toMatchObject({ genders: ['f'], tr: { ru: 'море', en: 'sea' }, topic: a1[1].topic });
    const topics = { 'See|noun': 'Natur & Wetter', 'See|noun#f': 'Reisen & Urlaub' };
    expect(topicOf({ term: 'See', rawPos: 'noun', mainKey: 'See|noun', article: 'f' }, topics)).toBe('Reisen & Urlaub');
    expect(topicOf({ term: 'See', rawPos: 'noun' }, topics)).toBe('Natur & Wetter');
  });
});

describe('levels', () => {
  it('maps ranks to CEFR bands', () => {
    expect([1, 600, 601, 1300, 2500, 4000, 6000, 8000, 8001].map(levelOf)).toEqual([
      'A1', 'A1', 'A2', 'A2', 'B1', 'B2', 'C1', 'C2', null,
    ]);
  });

  it('falls back to a topic by part of speech', () => {
    const topics = { 'Brot|noun': 'Essen & Trinken' };
    expect(topicOf({ term: 'Brot', rawPos: 'noun' }, topics)).toBe('Essen & Trinken');
    expect(topicOf({ term: 'Idee', rawPos: 'noun' }, topics)).toBe('Abstrakte Begriffe');
    expect(topicOf({ term: 'gehen', rawPos: 'verb' }, topics)).toBe('Alltagsverben');
    expect(topicOf({ term: 'gut', rawPos: 'adj' }, topics)).toBe('Eigenschaften');
    expect(topicOf({ term: 'und', rawPos: 'conj' }, topics)).toBe('Funktionswörter');
  });

  it('merges small topics and splits large ones by frequency', () => {
    const words = [
      ...Array.from({ length: 90 }, (_, i) => ({ topic: 'Alltagsverben', rank: i + 1 })),
      ...Array.from({ length: 5 }, (_, i) => ({ topic: 'Natur & Wetter', rank: 100 + i })),
      ...Array.from({ length: 4 }, (_, i) => ({ topic: 'Tiere & Pflanzen', rank: 200 + i })),
    ];
    const sets = groupTopics(words);
    const count = (name: string) => [...sets.values()].filter((v) => v === name).length;
    expect(count('Alltagsverben')).toBe(30);
    expect(count('Alltagsverben 2')).toBe(30);
    expect(count('Alltagsverben 3')).toBe(30);
    // 4 plant words are too few for a set: they join the related "Natur & Wetter".
    expect(count('Natur & Wetter · Tiere & Pflanzen')).toBe(9);
    expect(count('Gemischt')).toBe(0);
    expect(sets.get(words[0])).toBe('Alltagsverben');
    expect(sets.get(words[89])).toBe('Alltagsverben 3');
  });

  it('builds files with unique ids and optional example translations', () => {
    const base = { genders: [], plural: '', praeteritum: '', partizip2: '', auxiliary: '', topic: 'Alltagsverben' };
    const words = [
      { ...base, term: 'sein', rawPos: 'verb', pos: 'verb', tr: { ru: [['быть']], en: [['be']] }, rank: 1, example: 'Ich bin da.', example_en: 'I am here.', example_ru: '' },
      { ...base, term: 'sein', rawPos: 'pron', pos: 'other', tr: { ru: [['его']], en: [['his', 'its', 'one’s', 'x']] }, rank: 2, topic: 'Funktionswörter' },
      { ...base, term: 'Folge', rawPos: 'noun', pos: 'noun', tr: { ru: [['последствие'], ['череда', 'ряд', 'серия'], ['эпизод'], ['x']], en: [] }, rank: 3 },
    ];
    const { files, index } = buildLevels(words, 'src');
    const a1 = files[0].words;
    expect(a1.map((w: Any) => w.id)).toEqual(['A1:sein', 'A1:sein#pron', 'A1:Folge']);
    expect(a1[0].example).toEqual({ de: 'Ich bin da.', en: 'I am here.' });
    expect(a1[1].tr.en).toBe('his, its, one’s');
    expect(a1[1].example).toBeUndefined();
    expect(a1[2].tr).toEqual({ ru: 'последствие; череда, ряд; эпизод', en: '' });
    expect(index.levels[0]).toMatchObject({ code: 'A1', words: 3 });
    expect(index.levels.map((l: Any) => l.code)).toEqual(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
  });
});

describe('google', () => {
  it('splits a multi-line response back into lines', () => {
    const data = [[['The house is big.\n', 'x'], ['I am going home. ', 'y'], ['He comes.', 'z']]];
    expect(splitLines(data, 2)).toEqual(['The house is big.', 'I am going home. He comes.']);
    expect(splitLines(data, 3)).toBeNull();
  });
});

describe('generated output', () => {
  it('index and A1 match the contract', () => {
    const index = JSON.parse(readFileSync(new URL('../../../public/levels/index.json', import.meta.url), 'utf8'));
    expect(index.levels.map((l: Any) => l.code)).toEqual(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
    expect(index.sources).toMatch(/FrequencyWords/);
    const a1 = JSON.parse(readFileSync(new URL('../../../public/levels/A1.json', import.meta.url), 'utf8'));
    expect(a1.level).toBe('A1');
    expect(a1.words).toHaveLength(index.levels[0].words);
    const terms = a1.words.map((w: Any) => w.term);
    for (const t of ['Haus', 'gehen', 'gut', 'Wasser']) expect(terms).toContain(t);
    const ids = new Set(index.levels.flatMap((l: Any) => JSON.parse(readFileSync(new URL(`../../../public/levels/${l.code}.json`, import.meta.url), 'utf8')).words.map((w: Any) => w.id)));
    expect(ids.size).toBe(index.levels.reduce((n: number, l: Any) => n + l.words, 0));
  });

  it('has separate words for articles with different meanings', () => {
    const all = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].flatMap(
      (c) => JSON.parse(readFileSync(new URL(`../../../public/levels/${c}.json`, import.meta.url), 'utf8')).words,
    );
    const byId = new Map(all.map((w: Any) => [w.id, w]));
    // Existing ids keep their article; the other article has an id of its own.
    expect(byId.get('A2:See')).toMatchObject({ genders: ['m'], tr: { ru: 'озеро' } });
    expect(byId.get('B2:See#f')).toMatchObject({ genders: ['f'], tr: { ru: 'море' } });
    expect(byId.get('B1:Steuer')).toMatchObject({ genders: ['n'] });
    expect(byId.get('B2:Steuer#f')).toMatchObject({ genders: ['f'], tr: { ru: 'налог' } });
    expect(byId.get('B2:Gehalt#n')).toMatchObject({ genders: ['n'], plural: 'Gehälter', tr: { ru: 'зарплата' } });
    // Gender variants and one-article homonyms stay one word.
    for (const t of ['Teil', 'Liter', 'Joghurt', 'Bank']) expect(all.filter((w: Any) => w.term === t)).toHaveLength(1);
  });
});
