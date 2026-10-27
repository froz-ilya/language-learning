// Tests for the level-preset build pipeline (scripts/levels/lib/*.mjs) on real, trimmed
// kaikki.org lines (German Wiktionary, CC BY-SA) in scripts/levels/__fixtures__/.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  cleanExample,
  cleanTranslation,
  mergeLemma,
  parseKaikkiEntry,
} from '../../../scripts/levels/lib/extract.mjs';
import { candidates, exclusionReason, groupTranslations, lemmaCounts, rankLemmas } from '../../../scripts/levels/lib/rank.mjs';
import { buildLevels, groupTopics, topicOf } from '../../../scripts/levels/lib/levels.mjs';
import { levelOf } from '../../../scripts/levels/lib/words.mjs';
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
    expect(t.tr.en[0]).toBe('table');
    expect(t.tr.ru[0]).toBe('стол');
    expect(t.examples[0]).toBe('Der Tisch ist für die vielen Personen heute zu klein.');
    expect(t.forms).toContain('tische');
  });

  it('reads verb Präteritum, Partizip II and auxiliary', () => {
    expect(lemma('gehen')).toMatchObject({ pos: 'verb', praeteritum: 'ging', partizip2: 'gegangen', auxiliary: 'sein' });
    expect(lemma('anrufen')).toMatchObject({ praeteritum: 'rief an', partizip2: 'angerufen', auxiliary: 'haben' });
    expect(lemma('gehen').tr.en.slice(0, 2)).toEqual(['go', 'walk']);
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

  it('takes translations from the first plain senses only', () => {
    // Mutter: sense 1 gives мать, мама; "матка" (sense 2) is not needed.
    const mother = parsed.find((r) => r?.kind === 'lemma' && r.word === 'Mutter' && r.rawPos === 'noun');
    expect(mother.tr.ru).toEqual(['мать', 'мама']);
    const kommen: Any = parseKaikkiEntry({
      word: 'kommen',
      pos: 'verb',
      lang_code: 'de',
      senses: [
        { glosses: ['einen Ort erreichen'], tags: ['intransitive', 'regional'], sense_index: '1' },
        { glosses: ['beginnen'], sense_index: '2' },
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
    expect(kommen.tr.ru).toEqual(['прибывать', 'приходить']);
    expect(kommen.tr.en).toEqual(['horse']);
  });

  it('merges homonyms without mixing their translations', () => {
    const [mother, nut] = parsed.filter((r) => r?.kind === 'lemma' && r.word === 'Mutter' && r.rawPos === 'noun');
    const m = mergeLemma(mother, nut);
    expect(m.plural).toBe('Mütter');
    expect(m.tr.en).toEqual(['mother']);
  });
});

describe('cleaning', () => {
  it('normalises translations', () => {
    expect(cleanTranslation('call ( against )', 'en')).toBe('call');
    expect(cleanTranslation('to go', 'en')).toBe('go');
    expect(cleanTranslation('come on !', 'en')).toBe('come on');
    expect(cleanTranslation('or ; or else', 'en')).toBe('or');
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
    tr: { en: [word], ru: [word] },
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
      'schon|particle': rec('schon', 'particle', { tr: { en: ['indeed'], ru: ['же'] } }),
      'schon|adv': rec('schon', 'adv', { tr: { en: ['already'], ru: ['уже'] } }),
    };
    expect(groupTranslations(['schon|particle', 'schon|adv'], l, 'en')).toEqual(['already', 'indeed']);
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
      { ...base, term: 'sein', rawPos: 'verb', pos: 'verb', tr: { ru: ['быть'], en: ['be'] }, rank: 1, example: 'Ich bin da.', example_en: 'I am here.', example_ru: '' },
      { ...base, term: 'sein', rawPos: 'pron', pos: 'other', tr: { ru: ['его'], en: ['his', 'its', 'one’s', 'x'] }, rank: 2, topic: 'Funktionswörter' },
    ];
    const { files, index } = buildLevels(words, 'src');
    const a1 = files[0].words;
    expect(a1.map((w: Any) => w.id)).toEqual(['A1:sein', 'A1:sein#pron']);
    expect(a1[0].example).toEqual({ de: 'Ich bin da.', en: 'I am here.' });
    expect(a1[1].tr.en).toBe('his, its, one’s');
    expect(a1[1].example).toBeUndefined();
    expect(index.levels[0]).toMatchObject({ code: 'A1', words: 2 });
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
});
