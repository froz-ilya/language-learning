import { describe, expect, it } from 'vitest';
import { checkForm, checkGerman, checkTranslation, normalize, translationAlternatives } from './answer';
import { compoundHeads, compoundPlural, displayTerm, displayVerbForms } from './articles';
import { parseGermanInput } from './parseTerm';

const tisch = { term: 'Tisch', pos: 'noun' as const, genders: ['m' as const] };
const teil = { term: 'Teil', pos: 'noun' as const, genders: ['m' as const, 'n' as const] };

describe('normalize', () => {
  it('treats ä/ae and ß/ss as equal', () => {
    expect(normalize('Mädchen')).toBe(normalize('maedchen'));
    expect(normalize('Straße!')).toBe('strasse');
  });
});

describe('checkGerman', () => {
  it('requires the article when asked to', () => {
    expect(checkGerman('der Tisch', tisch, 'lenient', true).verdict).toBe('correct');
    expect(checkGerman('Tisch', tisch, 'lenient', true)).toEqual({ verdict: 'wrong', articleProblem: 'missing' });
    expect(checkGerman('Tisch', tisch, 'lenient', false).verdict).toBe('correct');
    expect(checkGerman('die Tisch', tisch, 'lenient', true)).toEqual({ verdict: 'wrong', articleProblem: 'wrong' });
  });

  it('accepts any article of a multi-gender noun', () => {
    expect(checkGerman('das Teil', teil, 'strict', true).verdict).toBe('correct');
  });

  it('tolerates small typos only when lenient', () => {
    expect(checkGerman('der Tish', tisch, 'lenient', true).verdict).toBe('typo');
    expect(checkGerman('der Tish', tisch, 'strict', true).verdict).toBe('wrong');
  });
});

describe('checkTranslation', () => {
  it('accepts any listed alternative', () => {
    expect(checkTranslation('home', 'house, home', 'strict')).toBe('correct');
    expect(checkTranslation('go', 'to go; to walk', 'strict')).toBe('correct');
    expect(checkTranslation('дом', 'дом (здание)', 'strict')).toBe('correct');
  });

  it('splits alternatives', () => {
    expect(translationAlternatives('house, home; building (big)')).toEqual(['house', 'home', 'building']);
  });
});

it('checks verb forms strictly', () => {
  expect(checkForm('ging', 'ging')).toBe('correct');
  expect(checkForm('gang', 'ging')).toBe('wrong');
});

describe('parseGermanInput', () => {
  it('reads articles', () => {
    expect(parseGermanInput('der Tisch')).toMatchObject({ term: 'Tisch', pos: 'noun', genders: ['m'] });
    expect(parseGermanInput('der/das Teil').genders).toEqual(['m', 'n']);
    expect(parseGermanInput('das Haus, die Häuser')).toMatchObject({ term: 'Haus', plural: 'Häuser' });
  });

  it('reads verb forms', () => {
    expect(parseGermanInput('gehen, ging, ist gegangen')).toMatchObject({
      term: 'gehen',
      pos: 'verb',
      praeteritum: 'ging',
      partizip2: 'gegangen',
      auxiliary: 'sein',
    });
  });

  it('leaves plain words alone', () => {
    expect(parseGermanInput('  schön ')).toEqual({ term: 'schön', genders: [] });
  });
});

describe('articles', () => {
  it('displays terms and verb forms', () => {
    expect(displayTerm(teil)).toBe('der/das Teil');
    expect(displayVerbForms({ praeteritum: 'ging', partizip2: 'gegangen', auxiliary: 'sein' })).toBe('ging – ist gegangen');
  });

  it('builds compound candidates and plurals', () => {
    expect(compoundHeads('Hausschlüssel')).toContain('Schlüssel');
    expect(compoundPlural('Küchentisch', 'Tisch', 'Tische')).toBe('Küchentische');
  });
});
