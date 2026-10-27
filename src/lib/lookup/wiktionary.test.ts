import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseEntry, stripMarkup, templateParams } from './wiktionary';

const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/${name}.wikitext`, import.meta.url), 'utf8');
const entry = (name: string) => parseEntry(name, fixture(name))!;

describe('parseEntry', () => {
  it('reads a neuter noun with plural and translations', () => {
    const e = entry('Haus');
    expect(e.pos).toBe('noun');
    expect(e.genders).toEqual(['n']);
    expect(e.plural).toBe('Häuser');
    expect(e.translations.en[0]).toBe('house');
    expect(e.translations.ru[0]).toBe('дом');
    expect(e.examples.length).toBeGreaterThan(0);
  });

  it('reads a masculine noun', () => {
    const e = entry('Tisch');
    expect(e.genders).toEqual(['m']);
    expect(e.plural).toBe('Tische');
    expect(e.translations.ru).toContain('стол');
  });

  it('merges nouns with two genders', () => {
    expect(entry('See').genders).toEqual(['m', 'f']);
    expect(entry('Teil').genders.sort()).toEqual(['m', 'n']);
  });

  it('reads verb forms', () => {
    const e = entry('gehen');
    expect(e.pos).toBe('verb');
    expect(e.praeteritum).toBe('ging');
    expect(e.partizip2).toBe('gegangen');
    expect(e.auxiliary).toBe('sein');
    expect(e.translations.en).toContain('go');
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

describe('helpers', () => {
  it('keeps pipes inside values', () => {
    const p = templateParams('{{Deutsch Verb Übersicht\n|Hilfsverb=sein\n|Bild=a.gif|mini|1|Text\n}}', 'Deutsch Verb Übersicht');
    expect(p).toEqual({ Hilfsverb: 'sein', Bild: 'a.gif|mini|1|Text' });
  });

  it('strips markup', () => {
    expect(stripMarkup("Ich ''gehe'' über die [[Straße]]&nbsp;… [[Haus|Häuser]]{{Ref|x}}")).toBe('Ich gehe über die Straße … Häuser');
  });
});
