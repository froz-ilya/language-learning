/**
 * A piece of a sentence: plain text, the verb ('v') or the connector ('c'); an ending ('e'); the
 * noun a relative pronoun stands for ('n').
 */
export interface Segment {
  text: string;
  kind?: 'v' | 'c' | 'e' | 'n';
}

interface Range {
  start: number;
  end: number;
  kind: 'v' | 'c' | 'n';
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
 * marked like the connector: it isn't always the connector ("Wenn …, dann …"). With `noun`, the
 * noun a relative pronoun stands for, that noun is marked and the connector and answer are looked
 * for after it: in "Die Frau, die …" the pronoun is the second die.
 */
export function highlightSegments(text: string, connector = '', verbs: string[] = [], answer = '', noun = ''): Segment[] {
  if (!text) return [];
  const ranges: Range[] = [];
  const n = noun.trim() ? occurrences(text, noun.trim(), '')[0] : undefined;
  if (n) ranges.push({ ...n, kind: 'n' });
  const after = (r: { start: number }) => r.start >= (n?.end ?? 0);
  const c = connector.trim() ? occurrences(text, connector.trim(), 'i').find(after) : undefined;
  if (c) ranges.push({ ...c, kind: 'c' });
  const from = c?.end ?? 0;
  const free = (r: { start: number; end: number }) => ranges.every((o) => r.end <= o.start || r.start >= o.end);

  // Usually the connector itself, already marked: a second "weil" further on isn't the answer.
  const sameWord = answer.trim().toLocaleLowerCase('de') === connector.trim().toLocaleLowerCase('de');
  const asked = answer.trim() && !(c && sameWord) ? occurrences(text, answer.trim(), 'i').find((r) => after(r) && free(r)) : undefined;
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

/**
 * Splits a sentence around the endings of its marked words. A mark is a word with its ending split
 * off by "|" ("d|en", "rot|en"): the ending is marked 'e'. A word with no ending ("ein|") is marked
 * 'c' as a whole, so the missing ending shows too. Each mark takes the next place it stands, so two
 * equal words ("den … den") are marked in order.
 */
export function endingSegments(text: string, marks: string[] = []): Segment[] {
  if (!text) return [];
  const ranges: { start: number; end: number; kind: 'c' | 'e' }[] = [];
  let from = 0;
  for (const mark of marks) {
    const bar = mark.indexOf('|');
    if (bar < 0) continue;
    const stem = mark.slice(0, bar);
    const ending = mark.slice(bar + 1);
    const hit = occurrences(text, stem + ending, '').find((r) => r.start >= from && ranges.every((o) => r.end <= o.start || r.start >= o.end));
    if (!hit) continue;
    from = hit.end;
    ranges.push(ending ? { start: hit.start + stem.length, end: hit.end, kind: 'e' } : { ...hit, kind: 'c' });
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
