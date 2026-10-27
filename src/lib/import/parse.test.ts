import { describe, expect, it } from 'vitest';
import { detectSeparators, parseImport } from './parse';

describe('parseImport', () => {
  it('parses the Quizlet tab format', () => {
    const text = 'der Tisch\tстол\r\ndas Haus, die Häuser\tдом\n\ngehen\tидти\n';
    const rows = parseImport(text, { termSep: '\t', rowSep: '\n' });
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ term: 'der Tisch', translation: 'стол' });
    expect(rows[0].parsed).toMatchObject({ term: 'Tisch', pos: 'noun', genders: ['m'] });
    expect(rows[1].parsed).toMatchObject({ term: 'Haus', genders: ['n'], plural: 'Häuser' });
    expect(rows[2]).toMatchObject({ term: 'gehen', translation: 'идти' });
    expect(rows[2].parsed).toEqual({ term: 'gehen', genders: [] });
  });

  it('parses " - " bulk lists, including en dashes, and trims', () => {
    const text = '  Haus - house \nSchule – school\nder Weg - the way - path';
    const rows = parseImport(text, { termSep: ' - ', rowSep: '\n' });
    expect(rows.map((r) => [r.term, r.translation])).toEqual([
      ['Haus', 'house'],
      ['Schule', 'school'],
      ['der Weg', 'the way - path'],
    ]);
  });

  it('splits on the first term separator only', () => {
    const rows = parseImport('Tisch, table, desk', { termSep: ',', rowSep: '\n' });
    expect(rows[0]).toMatchObject({ term: 'Tisch', translation: 'table, desk' });
  });

  it('supports custom separators', () => {
    const rows = parseImport('Haus=house;; Baum=tree ;Katze', { termSep: '=', rowSep: ';' });
    expect(rows.map((r) => [r.term, r.translation])).toEqual([
      ['Haus', 'house'],
      ['Baum', 'tree'],
      ['Katze', ''],
    ]);
    const multi = parseImport('Hund :: dog ## Maus :: mouse', { termSep: '::', rowSep: '##' });
    expect(multi.map((r) => r.translation)).toEqual(['dog', 'mouse']);
  });

  it('swaps columns', () => {
    const rows = parseImport('to go\tgehen, ging, ist gegangen\ntable\tder Tisch', {
      termSep: '\t',
      rowSep: '\n',
      swap: true,
    });
    expect(rows[0]).toMatchObject({ term: 'gehen, ging, ist gegangen', translation: 'to go' });
    expect(rows[0].parsed).toMatchObject({
      term: 'gehen',
      pos: 'verb',
      praeteritum: 'ging',
      partizip2: 'gegangen',
      auxiliary: 'sein',
    });
    expect(rows[1].parsed).toMatchObject({ term: 'Tisch', genders: ['m'] });
  });

  it('parses verb forms and multi-gender nouns', () => {
    const rows = parseImport('machen, machte, hat gemacht\tделать\nder/das Teil\tчасть', {
      termSep: '\t',
      rowSep: '\n',
    });
    expect(rows[0].parsed).toMatchObject({ term: 'machen', pos: 'verb', auxiliary: 'haben', partizip2: 'gemacht' });
    expect(rows[1].parsed).toMatchObject({ term: 'Teil', genders: ['m', 'n'] });
  });

  it('skips empty rows', () => {
    expect(parseImport('\n\n  \n\t\n', { termSep: '\t', rowSep: '\n' })).toEqual([]);
  });
});

describe('detectSeparators', () => {
  it('prefers tabs', () => {
    expect(detectSeparators('Haus - x\thouse\nBaum\ttree')).toEqual({ termSep: '\t', rowSep: '\n' });
  });
  it('detects " - " lists', () => {
    expect(detectSeparators('Haus - house\nBaum - tree')).toEqual({ termSep: ' - ', rowSep: '\n' });
    expect(detectSeparators('Haus – house')).toMatchObject({ termSep: ' - ' });
  });
  it('falls back to comma', () => {
    expect(detectSeparators('Haus, house\nBaum, tree')).toEqual({ termSep: ',', rowSep: '\n' });
  });
  it('detects semicolon rows on a single line', () => {
    expect(detectSeparators('Haus, house; Baum, tree')).toEqual({ termSep: ',', rowSep: ';' });
  });
  it('does not treat hyphenated words as " - "', () => {
    expect(detectSeparators('E-Mail, email')).toMatchObject({ termSep: ',' });
  });
});
