import { describe, expect, it } from 'vitest';
import { wikitextToParagraphs } from './wikitext';

describe('wikitextToParagraphs', () => {
  it('keeps link text, drops files, categories, templates and references', () => {
    const w = [
      '{{Infobox Land',
      '| Name = Australien',
      '| Karte = {{Karte|AU}}',
      '}}',
      '[[Datei:Australia.jpg|mini|So sieht [[Australien]] aus dem [[Weltall]] aus.]]',
      "Australien ist ein [[Land]].<ref>Quelle: {{Cite|x}}</ref> Die '''größte''' [[Stadt]] ist [[Sydney (Stadt)|Sydney]].",
      '<br/>Es gibt viele [[Insel]]n.<ref name="a" />',
      '',
      '[[Kategorie:Erdkunde]]',
      '[[en:Australia]]',
    ].join('\n');
    expect(wikitextToParagraphs(w)).toEqual(['Australien ist ein Land. Die größte Stadt ist Sydney. Es gibt viele Inseln.']);
  });

  it('makes headings, splits paragraphs on blank lines and stops at "Siehe auch"', () => {
    const w = 'Erster Absatz.\nNoch im ersten.\n\n== Wie lebt er? ==\nZweiter Absatz.\n\n== Siehe auch ==\nAnderes.';
    expect(wikitextToParagraphs(w)).toEqual(['Erster Absatz. Noch im ersten.', '## Wie lebt er?', 'Zweiter Absatz.']);
  });

  it('drops tables, galleries, comments and short list items; keeps prose list items', () => {
    const w = [
      'Text davor.',
      '{| class="wikitable"',
      '! Kopf',
      '|-',
      '| Zelle {{x}}',
      '|}',
      '<gallery>',
      'File:a.jpg|Bild [[A]]',
      '</gallery>',
      '<!-- versteckt -->',
      '* [[Hund]]',
      '* Der Hund ist ein treues Tier.',
      '__NOTOC__',
    ].join('\n');
    expect(wikitextToParagraphs(w)).toEqual(['Text davor.', 'Der Hund ist ein treues Tier.']);
  });

  it('copes with broken markup from the wiki (unclosed links and templates)', () => {
    expect(wikitextToParagraphs('Viele Land|Länder]] haben das. Sand[[ und [[Erdboden|Erde]] weg.')).toEqual([
      'Viele Länder haben das. Sand und Erde weg.',
    ]);
    expect(wikitextToParagraphs('Vorher. {{kaputt\nNachher kommt Text.')).toEqual(['Vorher. Nachher kommt Text.']);
  });

  it('turns external links into their label and decodes entities', () => {
    expect(wikitextToParagraphs('Siehe [https://example.org die Seite] und [https://x.org].&nbsp;Fertig &amp; gut.')).toEqual([
      'Siehe die Seite und. Fertig & gut.',
    ]);
  });

  it('drops headings without text under them', () => {
    expect(wikitextToParagraphs('Text.\n\n== Leer ==\n{{Vorlage}}\n\n== Voll ==\nMehr Text.')).toEqual(['Text.', '## Voll', 'Mehr Text.']);
  });
});
