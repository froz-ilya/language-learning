import { describe, expect, it } from 'vitest';
import { parseImport } from './parse';
import { markDuplicates } from './duplicates';

const rows = (text: string) => parseImport(text, { termSep: ',', rowSep: '\n' });

describe('markDuplicates', () => {
  it('marks repeated rows, keeping the first occurrence', () => {
    const r = rows('aufregend,волнующий\ndrehen,вращать\nmutig,смелый\nAufregend,захватывающий\ndrehen,крутить');
    expect(markDuplicates(r)).toEqual([null, null, null, 'paste', 'paste']);
  });

  it('compares the parsed term, so articles and forms do not hide a repeat', () => {
    const r = rows('der Tisch,стол\nder Tisch, die Tische,стол\ngehen, ging, ist gegangen,идти\ngehen,идти');
    expect(markDuplicates(r)).toEqual([null, 'paste', null, 'paste']);
  });

  it('treats nouns with different typed articles as different words', () => {
    const r = rows('der See,озеро\ndie See,море\nSee,озеро\ndie See,море');
    expect(markDuplicates(r)).toEqual([null, null, 'paste', 'paste']);
  });

  it('skips words the target set already has', () => {
    const existing = [
      { term: 'Serie', genders: ['f' as const] },
      { term: 'See', genders: ['m' as const] },
    ];
    const r = rows('die Serie,сериал\nserie,сериал\ndie See,море\nder See,озеро\nSee,озеро\nlachen,смеяться');
    expect(markDuplicates(r, existing)).toEqual(['set', 'set', null, 'set', 'set', null]);
  });

  it('marks the two repeats in the sample list', () => {
    const text = [
      'die Serie, die Serien,сериал',
      'drehen,вращать, крутить',
      'aufregend,волнующий, захватывающий',
      'wundert,удивляться',
      'aufregend,волнующий, захватывающий',
      'drehen,вращать, крутить',
      'die Handlung, en,действие, поступок',
    ].join('\n');
    const r = rows(text);
    const marks = markDuplicates(r);
    expect(marks.filter(Boolean)).toHaveLength(2);
    expect(r.filter((_, i) => marks[i]).map((x) => x.parsed.term)).toEqual(['aufregend', 'drehen']);
  });
});
