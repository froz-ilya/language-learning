// @ts-nocheck
// Plain-text helpers for Project Gutenberg books (pure; used by gutenberg.mjs).

/** Text between the "*** START OF …" and "*** END OF …" markers (header/footer stripped). */
export function stripGutenberg(raw) {
  const text = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^\*\*\*\s*START OF (THE|THIS) PROJECT GUTENBERG/i.test(l));
  let end = lines.findIndex((l) => /^\*\*\*\s*END OF (THE|THIS) PROJECT GUTENBERG/i.test(l));
  if (end < 0) end = lines.length;
  return lines.slice(start + 1, end);
}

const blank = (l) => l === undefined || !l.trim();
const isIllustration = (l) => /^\s*\[(Illustration|Abbildung)/i.test(l ?? '');

/** Normalise a heading for comparison: "Der·treue·Johannes." → "der treue johannes". */
export function headingKey(s) {
  return s
    .replace(/[·_~]/g, ' ')
    .replace(/[.:]+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Lines that look like section headings: short, followed by a blank line, and preceded by
 * two blank lines (or by an [Illustration] line and a blank one).
 */
export function findHeadings(lines) {
  const out = [];
  for (let i = 2; i < lines.length - 1; i++) {
    const t = lines[i].trim();
    if (!t || t.length > 70 || !blank(lines[i + 1])) continue;
    if (/^[»«"(\[]/.test(t)) continue;
    const before = blank(lines[i - 1]) && (blank(lines[i - 2]) || isIllustration(lines[i - 2]));
    if (before) out.push({ line: i, text: t, key: headingKey(t) });
  }
  return out;
}

/** Lines of the section titled `heading` (up to the next heading, or `until`). */
export function extractSection(lines, heading, until) {
  const headings = findHeadings(lines);
  const key = headingKey(heading);
  const idx = headings.findIndex((h) => h.key === key);
  if (idx < 0) throw new Error(`heading not found: ${heading}`);
  const start = headings[idx].line + 1;
  let end = lines.length;
  if (until) {
    const u = headings.find((h, j) => j > idx && h.key === headingKey(until));
    if (!u) throw new Error(`end heading not found: ${until}`);
    end = u.line;
  } else if (headings[idx + 1]) {
    end = headings[idx + 1].line;
  }
  return lines.slice(start, end);
}

/** Section lines → clean paragraphs (illustrations, emphasis markers and verse layout handled). */
export function toParagraphs(lines) {
  const paras = [];
  let buf = [];
  let inIllustration = false;
  const flush = () => {
    if (!buf.length) return;
    const verse = buf.length > 1 && buf.every((l) => /^\s{3,}\S/.test(l));
    const text = buf
      .map((l) => l.trim())
      .join(verse ? ' / ' : ' ')
      .replace(/~([^~]+)~/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      .replace(/\s*--\s*/g, ' – ')
      .replace(/\s+/g, ' ')
      .trim();
    const clean = text.replace(/^\[(.*)\]$/, '$1').trim();
    if (/\p{L}/u.test(clean)) paras.push(...splitLong(clean));
    buf = [];
  };
  for (const line of lines) {
    if (inIllustration) {
      if (line.includes(']')) inIllustration = false;
      continue;
    }
    if (isIllustration(line)) {
      flush();
      if (!line.includes(']')) inIllustration = true;
      continue;
    }
    if (blank(line)) flush();
    else buf.push(line);
  }
  flush();
  return paras;
}

/** Very long paragraphs (old prose often has page-long ones) → chunks of whole sentences. */
export function splitLong(para, max = 220) {
  if (wordCount(para) <= max) return [para];
  const sentences = para.split(/(?<=[.!?;][»«"“”]?)\s+(?=[»"„“(]?\p{Lu})/u);
  const out = [];
  let cur = '';
  for (const s of sentences) {
    if (cur && wordCount(cur) + wordCount(s) > max * 0.6 && wordCount(cur) >= max * 0.4) {
      out.push(cur);
      cur = s;
    } else cur = cur ? `${cur} ${s}` : s;
  }
  if (cur) out.push(cur);
  return out;
}

export const wordCount = (s) => (s.match(/\p{L}[\p{L}\p{M}'’-]*/gu) ?? []).length;

/** Split paragraphs into balanced parts of at most `max` words (paragraph boundaries). */
export function splitParts(paras, max = 1500) {
  const total = paras.reduce((n, p) => n + wordCount(p), 0);
  // A little slack so paragraph boundaries never force an extra tiny part.
  const parts = Math.max(1, Math.ceil(total / (max * 0.9)));
  const target = total / parts;
  const out = [[]];
  let n = 0;
  for (const p of paras) {
    const w = wordCount(p);
    const cur = out[out.length - 1];
    if (cur.length && (n + w > max || (out.length < parts && n + w / 2 > target))) {
      out.push([p]);
      n = w;
    } else {
      cur.push(p);
      n += w;
    }
  }
  return out;
}
