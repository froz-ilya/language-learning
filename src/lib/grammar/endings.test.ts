// Spot checks of the ending tables against phrases every textbook prints.
import { describe, expect, it } from 'vitest';
import { adjectiveEnding, determinerEnding, endingOptions, expectedEnding } from './endings';
import type { Case, Gender } from './types';

/** "d|en rot|en Hund": a phrase built from the tables. */
function phrase(det: string, stem: string, adj: string, c: Case, g: Gender): string {
  const d = det === '' ? '' : `${stem}${expectedEnding({ role: 'det' }, { det, case: c, gender: g })}`;
  return [d, `${adj}${expectedEnding({ role: 'adj' }, { det, case: c, gender: g })}`].filter(Boolean).join(' ');
}

describe('ending tables', () => {
  it('give the classic phrases', () => {
    expect(phrase('der', 'd', 'rot', 'nom', 'm')).toBe('der rote');
    expect(phrase('der', 'd', 'rot', 'akk', 'm')).toBe('den roten');
    expect(phrase('der', 'd', 'rot', 'akk', 'n')).toBe('das rote');
    expect(phrase('der', 'd', 'rot', 'dat', 'f')).toBe('der roten');
    expect(phrase('der', 'd', 'rot', 'nom', 'pl')).toBe('die roten');
    expect(phrase('der', 'd', 'rot', 'gen', 'm')).toBe('des roten');
    expect(phrase('dieser', 'dies', 'alt', 'nom', 'n')).toBe('dieses alte');
    expect(phrase('alle', 'all', 'gut', 'dat', 'pl')).toBe('allen guten');
    expect(phrase('ein', 'ein', 'rot', 'nom', 'm')).toBe('ein roter');
    expect(phrase('ein', 'ein', 'rot', 'akk', 'm')).toBe('einen roten');
    expect(phrase('ein', 'ein', 'rot', 'akk', 'n')).toBe('ein rotes');
    expect(phrase('ein', 'ein', 'rot', 'dat', 'f')).toBe('einer roten');
    expect(phrase('mein', 'mein', 'alt', 'nom', 'pl')).toBe('meine alten');
    expect(phrase('kein', 'kein', 'gut', 'gen', 'pl')).toBe('keiner guten');
    expect(phrase('', '', 'heiß', 'nom', 'm')).toBe('heißer');
    expect(phrase('', '', 'kalt', 'akk', 'n')).toBe('kaltes');
    expect(phrase('', '', 'heiß', 'dat', 'n')).toBe('heißem');
    expect(phrase('', '', 'groß', 'dat', 'f')).toBe('großer');
    expect(phrase('', '', 'schlecht', 'gen', 'n')).toBe('schlechten');
    expect(phrase('', '', 'gut', 'gen', 'f')).toBe('guter');
    expect(phrase('', '', 'neu', 'nom', 'pl')).toBe('neue');
    expect(phrase('', '', 'neu', 'dat', 'pl')).toBe('neuen');
  });

  it('refuse phrases that do not exist', () => {
    expect(determinerEnding('ein', 'nom', 'pl')).toBeUndefined();
    expect(determinerEnding('jeder', 'nom', 'pl')).toBeUndefined();
    expect(determinerEnding('alle', 'nom', 'm')).toBeUndefined();
    expect(determinerEnding('manche', 'nom', 'pl')).toBeUndefined();
    expect(expectedEnding({ role: 'adj' }, { det: 'ein', case: 'nom', gender: 'pl' })).toBeUndefined();
    expect(expectedEnding({ role: 'adj' }, { det: 'jemand', case: 'nom', gender: 'm' })).toBeUndefined();
  });

  it('offer every ending a word could take', () => {
    expect(endingOptions({ role: 'adj' }, 'der')).toEqual(['e', 'en', 'er', 'es', 'em']);
    expect(endingOptions({ role: 'det' }, 'der')).toContain('ie');
    expect(endingOptions({ role: 'det' }, 'mein')).toContain('');
    expect(adjectiveEnding('none', 'gen', 'pl')).toBe('er');
  });
});
