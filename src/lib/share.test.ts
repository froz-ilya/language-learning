import { describe, expect, it } from 'vitest';
import { extractSharedTerm, isShareLaunch } from './share';

const term = (q: Record<string, string>) => extractSharedTerm(new URLSearchParams(q));

describe('extractSharedTerm', () => {
  it('keeps a single word or short phrase', () => {
    expect(term({ text: 'Fahrrad' })).toBe('Fahrrad');
    expect(term({ text: '  der Tisch ' })).toBe('der Tisch');
    expect(term({ text: 'sich freuen auf' })).toBe('sich freuen auf');
  });

  it('strips quotes and punctuation around the selection', () => {
    expect(term({ text: '„Schmetterling“,' })).toBe('Schmetterling');
    expect(term({ text: '"Haus."' })).toBe('Haus');
    expect(term({ text: '(gehen)' })).toBe('gehen');
  });

  it('uses the first non-empty line and ignores links', () => {
    expect(term({ text: '\n\nApfel\nBirne' })).toBe('Apfel');
    expect(term({ text: 'Zug https://example.com/x?y=1' })).toBe('Zug');
    expect(term({ text: 'https://example.com', title: 'Bahnhof' })).toBe('Bahnhof');
  });

  it('falls back to the title', () => {
    expect(term({ title: 'Wörterbuch', url: 'https://de.wiktionary.org/wiki/Wörterbuch' })).toBe('Wörterbuch');
  });

  it('keeps only the first word of long text, capped at 60 chars', () => {
    expect(term({ text: 'Gestern bin ich mit dem Fahrrad zur Arbeit gefahren, weil es schön war.' })).toBe('Gestern');
    expect(term({ text: 'x'.repeat(80) })).toBe('x'.repeat(60));
  });

  it('returns empty when nothing usable was shared', () => {
    expect(term({})).toBe('');
    expect(term({ url: 'https://example.com' })).toBe('');
    expect(term({ text: ' … ', title: '' })).toBe('');
  });
});

describe('isShareLaunch', () => {
  it('spots share target parameters', () => {
    expect(isShareLaunch(new URLSearchParams('text=Haus'))).toBe(true);
    expect(isShareLaunch(new URLSearchParams('url=x'))).toBe(true);
    expect(isShareLaunch(new URLSearchParams(''))).toBe(false);
    expect(isShareLaunch(new URLSearchParams('utm_source=a'))).toBe(false);
  });
});
