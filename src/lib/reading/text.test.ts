import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  extractToParagraphs,
  firstSentence,
  headingText,
  htmlToParagraphs,
  isHeading,
  plainToParagraphs,
  sentenceAt,
  stripTags,
  tokenize,
  truncateParagraphs,
  countWords,
} from './text';

const fixture = (name: string) => {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '__fixtures__', name), 'utf8'));
  const t = data.parse.text;
  return typeof t === 'string' ? t : (t['*'] as string);
};

describe('htmlToParagraphs (recorded Klexikon parse output)', () => {
  const paras = htmlToParagraphs(fixture('klexikon-parse-Hund.json'), { useDom: false });
  const all = paras.join('\n');

  it('keeps the article text, starting with the first paragraph', () => {
    expect(paras[0]).toMatch(/^Hunde sind Säugetiere\./);
    expect(all).toContain('Polizeihunde gehorchen ihrem Herrn bedingungslos.');
    expect(paras.length).toBeGreaterThan(10);
  });

  it('keeps section headings as flagged short paragraphs', () => {
    const headings = paras.filter(isHeading).map(headingText);
    expect(headings).toEqual(['Wozu hält sich der Mensch Hunde?', 'Wie vermehren sich Hunde?']);
  });

  it('removes images, captions, galleries and edit links', () => {
    expect(all).not.toMatch(/Bearbeiten|Quelltext/);
    expect(all).not.toContain('eine der bekanntesten Hunderassen'); // figcaption
    expect(all).not.toContain('Ein Hund im Training'); // gallery text
    expect(all).not.toContain('[[Datei:'); // broken image markup in the source
    expect(all).toContain('Auch Drogenhunde sind eine Art von Polizeihunden.');
  });

  it('drops the boilerplate after the horizontal rule', () => {
    expect(all).not.toContain('Klexikon.de ist die Wikipedia für Kinder');
    expect(all).not.toContain('Suche diesen Artikel');
    expect(paras[paras.length - 1]).toMatch(/herausgefunden\.$/);
  });

  it('decodes entities and collapses whitespace', () => {
    for (const p of paras) {
      expect(p).not.toMatch(/&[a-z#0-9]+;|\s{2}|<|>/);
    }
  });
});

describe('htmlToParagraphs (Wikinews parse output)', () => {
  const paras = htmlToParagraphs(fixture('wikinews-parse-ICE.json'), { useDom: false });
  it('drops the status box, centered title, share box and "Links" section', () => {
    expect(paras[0]).toMatch(/^Lüneburg \(Niedersachsen\), 03\.05\.2026 – Bei Lüneburg/);
    const all = paras.join('\n');
    expect(all).not.toMatch(/Veröffentlicht|Kommentar abgeben|Diskussionsseite|Facebook/);
    expect(paras).toHaveLength(5);
  });
});

describe('htmlToParagraphs rules', () => {
  const html = `<div class="mw-parser-output">
    <table class="infobox"><tr><td>Infobox text</td></tr></table>
    <p>Der <b>Tisch</b> ist ein Möbelstück.<sup class="reference">[1]</sup> Man isst&nbsp;daran.</p>
    <div class="thumb"><div class="thumbcaption">Ein Tisch</div></div>
    <ul><li>Ein Tisch hat meistens vier Beine.</li><li>Kurz</li></ul>
    <div class="mw-heading mw-heading2"><h2 id="Geschichte">Geschichte</h2><span class="mw-editsection">[<a>Bearbeiten</a>]</span></div>
    <p>Tische gibt es seit der Antike.</p>
    <h2>Leer</h2>
    <h2><span class="mw-headline">Siehe auch</span></h2>
    <ul><li>Stuhl und Bank und Schrank</li></ul>
    <p>Nicht mehr dabei.</p>
  </div>`;
  const paras = htmlToParagraphs(html, { useDom: false });

  it('applies the cleanup rules', () => {
    expect(paras).toEqual([
      'Der Tisch ist ein Möbelstück. Man isst daran.',
      'Ein Tisch hat meistens vier Beine.',
      '## Geschichte',
      'Tische gibt es seit der Antike.',
    ]);
  });

  it('turns <br> into spaces (MiniKlexikon writes one sentence per line)', () => {
    expect(htmlToParagraphs('<p>Hunde sind Tiere.<br />Sie bellen.\n</p>', { useDom: false })).toEqual([
      'Hunde sind Tiere. Sie bellen.',
    ]);
  });
});

describe('extracts', () => {
  const extract = [
    'Der Haushund ist ein Haustier.',
    'Er stammt vom Wolf ab.',
    '',
    '',
    '== Merkmale ==',
    '',
    '',
    '=== Zähne ===',
    'Hunde haben 42 Zähne.',
    '',
    '== Leer ==',
    '== Literatur ==',
    'Ein Buch über Hunde. Verlag, 1990.',
  ].join('\n');

  it('splits lines into paragraphs, flags headings and stops at Literatur', () => {
    expect(extractToParagraphs(extract)).toEqual([
      'Der Haushund ist ein Haustier.',
      'Er stammt vom Wolf ab.',
      '## Zähne',
      'Hunde haben 42 Zähne.',
    ]);
  });

  it('truncates at about N words on paragraph boundaries', () => {
    const paras = ['eins zwei drei', '## Teil', 'vier fünf', 'sechs sieben acht', 'neun'];
    expect(truncateParagraphs(paras, 4)).toEqual(['eins zwei drei', '## Teil', 'vier fünf']);
    expect(truncateParagraphs(['a b', '## Ende'], 2)).toEqual(['a b']);
  });
});

describe('small helpers', () => {
  it('plainToParagraphs splits on blank lines, else on lines', () => {
    expect(plainToParagraphs('Eins zwei.\nDrei.\n\nVier.')).toEqual(['Eins zwei. Drei.', 'Vier.']);
    expect(plainToParagraphs('Eins.\nZwei.\n')).toEqual(['Eins.', 'Zwei.']);
    expect(plainToParagraphs('  \n ')).toEqual([]);
  });

  it('stripTags cleans search snippets', () => {
    expect(stripTags('Der <span class="searchmatch">Hund</span> &amp; die Katze')).toBe('Der Hund & die Katze');
  });

  it('firstSentence skips abbreviations and shortens', () => {
    expect(firstSentence('Wir haben einen neuen Advokaten, den Dr. Bucephalus. Er ist neu.')).toBe(
      'Wir haben einen neuen Advokaten, den Dr. Bucephalus.',
    );
    expect(firstSentence('a '.repeat(200), 20).length).toBeLessThanOrEqual(21);
  });

  it('sentenceAt finds the sentence around an offset', () => {
    const p = 'Es war einmal ein König. Er hatte drei Töchter! Die jüngste war schön.';
    expect(sentenceAt(p, p.indexOf('drei'))).toBe('Er hatte drei Töchter!');
    expect(sentenceAt(p, 0)).toBe('Es war einmal ein König.');
    expect(sentenceAt(p, p.length - 3)).toBe('Die jüngste war schön.');
  });

  it('countWords counts words, not numbers or punctuation', () => {
    expect(countWords('Am 3. Mai – 15.000 Volt-Leitung, geht’s los!')).toBe(5);
  });
});

describe('tokenize', () => {
  const words = (s: string) => tokenize(s).filter((t) => t.word).map((t) => t.text);

  it('is lossless', () => {
    const s = '„Hänsel und Gretel“ – ein Märchen (1812), 15.000-Volt-Oberleitung!  Ja?';
    expect(tokenize(s).map((t) => t.text).join('')).toBe(s);
  });

  it('keeps umlauts, ß, hyphenated words and contractions together', () => {
    expect(words('Die Säuge-Tiere aßen Grüße, geht’s dir\'s gut?')).toEqual([
      'Die',
      'Säuge-Tiere',
      'aßen',
      'Grüße',
      'geht’s',
      "dir's",
      'gut',
    ]);
  });

  it('separates punctuation, numbers and dangling hyphens', () => {
    const t = tokenize('Ober- und Unterkiefer, 42 Zähne.');
    expect(t.filter((x) => x.word).map((x) => x.text)).toEqual(['Ober', 'und', 'Unterkiefer', 'Zähne']);
    expect(t.filter((x) => !x.word).map((x) => x.text)).toEqual(['- ', ' ', ', 42 ', '.']);
  });

  it('handles empty input', () => {
    expect(tokenize('')).toEqual([]);
  });
});
