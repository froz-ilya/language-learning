/** A piece of a sentence: plain text, the verb ('v') or the connector ('c'). */
export interface Segment {
  text: string;
  kind?: 'v' | 'c';
}

interface Range {
  start: number;
  end: number;
  kind: 'v' | 'c';
}

/** Every place `word` stands as a whole word of `text`, not as part of a longer one. */
function occurrences(text: string, word: string, flags: string): { start: number; end: number }[] {
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, `gu${flags}`);
  return [...text.matchAll(re)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
}

/**
 * Splits a sentence around its connector and verbs. The connector matches whatever its case. A
 * verb is written as in the sentence and looked for from the connector onward, so the same word
 * in the clause before it stays plain; when it stands only before the connector, or the sentence
 * has no connector, that place is the one meant. `answer`, the word a pick exercise asked for, is
 * marked like the connector: it isn't always the connector ("Wenn …, dann …").
 */
export function highlightSegments(text: string, connector = '', verbs: string[] = [], answer = ''): Segment[] {
  if (!text) return [];
  const ranges: Range[] = [];
  const c = connector.trim() ? occurrences(text, connector.trim(), 'i')[0] : undefined;
  if (c) ranges.push({ ...c, kind: 'c' });
  const from = c?.end ?? 0;
  const free = (r: { start: number; end: number }) => ranges.every((o) => r.end <= o.start || r.start >= o.end);

  // Usually the connector itself, already marked: a second "weil" further on isn't the answer.
  const sameWord = answer.trim().toLocaleLowerCase('de') === connector.trim().toLocaleLowerCase('de');
  const asked = answer.trim() && !(c && sameWord) ? occurrences(text, answer.trim(), 'i').find(free) : undefined;
  if (asked) ranges.push({ ...asked, kind: 'c' });

  for (const verb of verbs) {
    if (!verb.trim()) continue;
    const found = occurrences(text, verb.trim(), '').filter(free);
    const hit = found.find((r) => r.start >= from) ?? found[0];
    if (hit) ranges.push({ ...hit, kind: 'v' });
  }

  const segments: Segment[] = [];
  let at = 0;
  for (const r of ranges.sort((a, b) => a.start - b.start)) {
    if (r.start > at) segments.push({ text: text.slice(at, r.start) });
    segments.push({ text: text.slice(r.start, r.end), kind: r.kind });
    at = r.end;
  }
  if (at < text.length) segments.push({ text: text.slice(at) });
  return segments;
}
