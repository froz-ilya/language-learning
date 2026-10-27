/**
 * Text processing for the reader: MediaWiki HTML / plain extracts → paragraphs, and
 * paragraphs → tappable word tokens.
 *
 * Paragraphs are plain strings; section headings are kept as short paragraphs prefixed with
 * HEADING ("## Ernährung"), see isHeading()/headingText().
 */

export const HEADING = '## ';

export const isHeading = (p: string) => p.startsWith(HEADING);
export const headingText = (p: string) => (isHeading(p) ? p.slice(HEADING.length) : p);

/** Sections from here on are references, links, galleries etc.: everything after is dropped. */
const STOP_SECTIONS = new Set([
  'siehe auch',
  'weblinks',
  'einzelnachweise',
  'literatur',
  'quellen',
  'quelle',
  'links',
  'anmerkungen',
  'fußnoten',
  'belege',
  'themenverwandte artikel',
  'externe links',
  'verwandte themen',
  'weitere artikel',
  'mehr zum thema',
  'filme',
  'film',
  'audio',
  'bilder',
]);

const isStopHeading = (text: string) => STOP_SECTIONS.has(text.trim().replace(/[:.]$/, '').toLowerCase());

export const countWords = (text: string) => (text.match(/\p{L}[\p{L}\p{M}'’-]*/gu) ?? []).length;

function cleanText(s: string): string {
  return s
    // Broken image markup that leaked into the text ("[[Datei:x.jpg|mini|caption]]", sometimes
    // unclosed until the end of the line).
    .replace(/\[\[(?:Datei|File|Bild|Image):[^\]\n]*(?:\]\]|\n|$)/gi, ' ')
    .replace(/\[\s*(?:Bearbeiten|Quelltext bearbeiten)[^\]]*\]/g, '')
    .replace(/\[(?:\d+|[a-z]|Anm\.\s*\d+)\]/g, '')
    .replace(/[   ]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\(\s*\)/g, '')
    .trim();
}

// ---------------------------------------------------------------------------------------------
// HTML → paragraphs. Two front ends (DOMParser in the browser, a small tag scanner elsewhere)
// feed the same event consumer, so both apply exactly the same rules.
// ---------------------------------------------------------------------------------------------

type Attr = (name: string) => string | null;

/** Elements removed with everything inside them. */
const REMOVED_TAGS = new Set([
  'script',
  'style',
  'table',
  'figure',
  'figcaption',
  'img',
  'sup',
  'math',
  'noscript',
  'form',
  'input',
  'button',
  'center',
  'audio',
  'video',
  'svg',
  'caption',
  'map',
  'link',
  'meta',
  'gallery',
]);

const REMOVED_CLASSES = [
  'mw-editsection',
  'reference',
  'references',
  'mw-references-wrap',
  'infobox',
  'navbox',
  'navigation-box',
  'toc',
  'thumb',
  'gallery',
  'gallerybox',
  'gallerytext',
  'metadata',
  'noprint',
  'hatnote',
  'mw-empty-elt',
  'mw-cite-backlink',
  'error',
  'mbox',
  'ambox',
  'sisterproject',
  'current',
  'mw-kartographer-maplink',
  'mw-inputbox-centered',
];

function isRemoved(tag: string, attr: Attr): boolean {
  if (REMOVED_TAGS.has(tag)) return true;
  const cls = attr('class');
  if (cls) {
    const list = cls.split(/\s+/);
    if (REMOVED_CLASSES.some((c) => list.includes(c))) return true;
  }
  const role = attr('role');
  if (role === 'navigation' || role === 'note') return true;
  if (attr('id') === 'toc') return true;
  // Bordered boxes (Wikinews status / share / comment boxes, notices).
  if (tag === 'div' && /border\s*:/i.test(attr('style') ?? '')) return true;
  return false;
}

const BLOCK_TAGS = new Set([
  'p',
  'div',
  'li',
  'ul',
  'ol',
  'dl',
  'dd',
  'dt',
  'blockquote',
  'section',
  'pre',
  'tr',
  'td',
  'th',
  'article',
  'main',
  'body',
]);
const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'wbr', 'source', 'col', 'area', 'embed', 'track']);

interface Sink {
  open(tag: string, attr: Attr): void;
  close(tag: string): void;
  text(s: string): void;
}

/** Collects paragraphs from open/close/text events. */
class Collector implements Sink {
  paragraphs: string[] = [];
  private skip = 0;
  private stopped = false;
  private buf = '';
  private heading = 0;
  /** Nesting depth of list items, so a <p> inside an <li> doesn't split it. */
  private inItem = 0;

  open(tag: string, attr: Attr) {
    if (this.stopped) return;
    if (this.skip || isRemoved(tag, attr)) {
      this.skip++;
      return;
    }
    if (tag === 'hr') {
      // Klexikon/MiniKlexikon put their boilerplate footer after a rule.
      this.flush();
      this.stopped = true;
    } else if (tag === 'br') {
      this.buf += ' ';
    } else if (HEADING_TAGS.has(tag)) {
      this.flush();
      this.heading++;
    } else if (BLOCK_TAGS.has(tag)) {
      if (!this.inItem) this.flush();
      if (tag === 'li' || tag === 'dd') this.inItem++;
    }
  }

  close(tag: string) {
    if (this.stopped) return;
    if (this.skip) {
      this.skip--;
      return;
    }
    if (HEADING_TAGS.has(tag)) {
      const text = cleanText(this.buf);
      this.buf = '';
      this.heading = Math.max(0, this.heading - 1);
      if (!text) return;
      if (isStopHeading(text)) this.stopped = true;
      else this.paragraphs.push(HEADING + text);
    } else if (BLOCK_TAGS.has(tag)) {
      if (tag === 'li' || tag === 'dd') {
        this.inItem = Math.max(0, this.inItem - 1);
        if (!this.inItem) this.flush(true);
      } else if (!this.inItem) this.flush();
    }
  }

  text(s: string) {
    if (this.stopped || this.skip) return;
    this.buf += s;
  }

  private flush(listItem = false) {
    const text = cleanText(this.buf);
    this.buf = '';
    if (!text || !/\p{L}/u.test(text)) return;
    // Short list items are usually navigation or link lists, not prose.
    if (listItem && countWords(text) < 4) return;
    this.paragraphs.push(text);
  }

  finish(): string[] {
    if (!this.stopped) this.flush();
    return tidy(this.paragraphs);
  }
}

/** Drop headings with no text under them (before the next heading of any level, or at the end). */
function tidy(paras: string[]): string[] {
  const out: string[] = [];
  for (const p of paras) {
    if (isHeading(p) && out.length && isHeading(out[out.length - 1])) out.pop();
    out.push(p);
  }
  while (out.length && isHeading(out[out.length - 1])) out.pop();
  return out;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  shy: '',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  bdquo: '„',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  sbquo: '‚',
  auml: 'ä',
  ouml: 'ö',
  uuml: 'ü',
  Auml: 'Ä',
  Ouml: 'Ö',
  Uuml: 'Ü',
  szlig: 'ß',
  eacute: 'é',
  egrave: 'è',
  middot: '·',
  thinsp: ' ',
  zwj: '',
  zwnj: '',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

function parseAttrs(src: string): Attr {
  const attrs = new Map<string, string>();
  const re = /([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) attrs.set(m[1].toLowerCase(), decodeEntities(m[2] ?? m[3] ?? m[4] ?? ''));
  return (name) => attrs.get(name) ?? null;
}

/** Regex tag scanner (no DOM needed). Emits balanced open/close events for MediaWiki output. */
function scanHtml(html: string, sink: Sink) {
  const stack: string[] = [];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!(?:[^>])*>|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+|<)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const [, slash, rawTag, rest, text] = m;
    if (text !== undefined) {
      sink.text(decodeEntities(text));
      continue;
    }
    if (!rawTag) continue; // comment / doctype
    const tag = rawTag.toLowerCase();
    if (!slash) {
      const attr = parseAttrs(rest ?? '');
      sink.open(tag, attr);
      if (VOID_TAGS.has(tag) || /\/\s*$/.test(rest ?? '')) sink.close(tag);
      else if (tag === 'script' || tag === 'style') {
        // Raw text elements: skip to their end tag.
        const end = html.toLowerCase().indexOf(`</${tag}`, re.lastIndex);
        re.lastIndex = end < 0 ? html.length : end;
        stack.push(tag);
      } else stack.push(tag);
    } else {
      const i = stack.lastIndexOf(tag);
      if (i < 0) continue; // stray end tag
      while (stack.length > i) sink.close(stack.pop()!);
    }
  }
  while (stack.length) sink.close(stack.pop()!);
}

function walkDom(node: Node, sink: Sink) {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 3) sink.text(child.nodeValue ?? '');
    else if (child.nodeType === 1) {
      const el = child as Element;
      const tag = el.tagName.toLowerCase();
      sink.open(tag, (n) => el.getAttribute(n));
      walkDom(el, sink);
      sink.close(tag);
    }
  }
}

/**
 * MediaWiki parser HTML → readable paragraphs. Drops tables, infoboxes, navboxes, references,
 * images and captions, galleries, edit links, and everything from "Siehe auch"/"Weblinks"/… or
 * a horizontal rule on. Headings become HEADING-prefixed paragraphs.
 */
export function htmlToParagraphs(html: string, opts: { useDom?: boolean } = {}): string[] {
  const sink = new Collector();
  const useDom = opts.useDom ?? typeof DOMParser !== 'undefined';
  if (useDom) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    walkDom(doc.body, sink);
  } else {
    scanHtml(html, sink);
  }
  return sink.finish();
}

/** Strip tags from a short HTML fragment (search snippets). */
export function stripTags(html: string): string {
  return cleanText(decodeEntities(html.replace(/<[^>]*>/g, '')));
}

// ---------------------------------------------------------------------------------------------
// Plain-text extracts (Wikipedia TextExtracts with exsectionformat=wiki)
// ---------------------------------------------------------------------------------------------

/** "== Heading ==" sections and one paragraph per line; stops at "Literatur", "Weblinks", … */
export function extractToParagraphs(extract: string): string[] {
  const out: string[] = [];
  for (const raw of extract.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const h = /^(={2,6})\s*(.*?)\s*\1$/.exec(line);
    if (h) {
      if (isStopHeading(h[2])) break;
      if (h[2]) out.push(HEADING + cleanText(h[2]));
      continue;
    }
    const text = cleanText(line);
    if (/\p{L}/u.test(text)) out.push(text);
  }
  return tidy(out);
}

/** Keep whole paragraphs up to about `maxWords` words (the paragraph that crosses the limit is kept). */
export function truncateParagraphs(paras: string[], maxWords = 1500): string[] {
  const out: string[] = [];
  let n = 0;
  for (const p of paras) {
    if (n >= maxWords) break;
    out.push(p);
    if (!isHeading(p)) n += countWords(p);
  }
  return tidy(out);
}

/** User-pasted text → paragraphs (blank lines separate paragraphs; else every line is one). */
export function plainToParagraphs(text: string): string[] {
  const t = text.replace(/\r\n?/g, '\n').trim();
  if (!t) return [];
  const blocks = /\n\s*\n/.test(t) ? t.split(/\n\s*\n/) : t.split('\n');
  return blocks.map((b) => b.replace(/\s+/g, ' ').trim()).filter((b) => /\p{L}/u.test(b));
}

/** First sentence of a text, for list snippets (at most ~160 chars). */
export function firstSentence(text: string, max = 160): string {
  const t = text.replace(/\s+/g, ' ').trim();
  const m = /^.{15,}?[^\s.]{3}[.!?](?=\s|$)/u.exec(t);
  const s = m ? m[0] : t;
  if (s.length <= max) return s;
  return `${s.slice(0, max).replace(/\s+\S*$/, '')}…`;
}

// ---------------------------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------------------------

export interface Token {
  text: string;
  /** A word (letters, possibly with inner hyphens/apostrophes): tappable. */
  word: boolean;
}

const TOKEN_RE = /\p{L}[\p{L}\p{M}]*(?:[-'’]\p{L}[\p{L}\p{M}]*)*|[^\p{L}]+/gu;

/**
 * Split a paragraph into word and non-word tokens; joining all token texts gives the input
 * back. Hyphenated words ("Säuge-Tiere") and contractions ("geht's") stay one token; numbers
 * and punctuation are non-word tokens.
 */
export function tokenize(paragraph: string): Token[] {
  const tokens: Token[] = [];
  for (const m of paragraph.matchAll(TOKEN_RE)) {
    tokens.push({ text: m[0], word: /^\p{L}/u.test(m[0]) });
  }
  return tokens;
}

/** The sentence of `paragraph` that contains the character at `offset` (for card examples). */
export function sentenceAt(paragraph: string, offset: number, max = 220): string {
  const ends = /[.!?…]+[»«"“”’)]*\s+/g;
  let start = 0;
  let end = paragraph.length;
  let m: RegExpExecArray | null;
  while ((m = ends.exec(paragraph))) {
    const stop = m.index + m[0].length;
    if (stop <= offset) start = stop;
    else {
      end = m.index + m[0].trimEnd().length;
      break;
    }
  }
  const s = paragraph.slice(start, end).trim();
  if (s.length <= max) return s;
  // Too long: a window around the word.
  const rel = offset - start;
  const from = Math.max(0, rel - max / 2);
  const cut = s.slice(from, from + max).replace(/^\S*\s/, from > 0 ? '' : '$&').replace(/\s\S*$/, '');
  return `${from > 0 ? '…' : ''}${cut}…`;
}
