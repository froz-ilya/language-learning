/**
 * MediaWiki wikitext → plain paragraphs, good enough to rate an article's level (used by the
 * Klexikon catalog build, scripts/reading/klexikon.mjs). Templates, references, tables,
 * galleries, files/images, categories and interwiki links are dropped; link text is kept.
 * Same paragraph shape as htmlToParagraphs: "## " headings, stop at "Siehe auch", "Weblinks"…,
 * short list items (navigation) skipped.
 */
import { cleanText, countWords, decodeEntities, HEADING, isStopHeading, tidy } from './text';

const FILE_NS = /^(?:datei|file|bild|image|media|kategorie|category)\s*:/i;
/** Interwiki / language links ("[[en:Dog]]"): a short lower-case prefix. */
const INTERWIKI = /^[a-z]{2,3}(?:-[a-z]+)?\s*:/;

/** Remove every `open … close` block, nesting included ({{a|{{b}}}}); an unclosed one runs to the end of its line. */
function removeNested(s: string, open: string, close: string): string {
  let out = '';
  let depth = 0;
  let outer = 0;
  let i = 0;
  while (i < s.length) {
    if (s.startsWith(open, i)) {
      if (!depth) outer = i;
      depth++;
      i += open.length;
    } else if (depth && s.startsWith(close, i)) {
      depth--;
      i += close.length;
    } else {
      if (!depth) out += s[i];
      i++;
    }
  }
  if (depth) {
    // Unclosed: drop the rest of its line and go on after it.
    const nl = s.indexOf('\n', outer);
    if (nl >= 0) out += removeNested(s.slice(nl), open, close);
  }
  return out;
}

/** Wiki tables `{| … |}` (may be nested) → removed. */
function removeTables(s: string): string {
  const lines = s.split('\n');
  const out: string[] = [];
  let depth = 0;
  for (const l of lines) {
    const t = l.trimStart();
    if (t.startsWith('{|')) depth++;
    else if (depth && t.startsWith('|}')) {
      depth--;
      continue;
    }
    if (!depth) out.push(l);
  }
  return out.join('\n');
}

/** `[[…]]` links: files/categories/interwiki dropped (with nested links), others → their text. */
function replaceLinks(s: string): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const start = s.indexOf('[[', i);
    if (start < 0) {
      out += s.slice(i);
      break;
    }
    out += s.slice(i, start);
    const isFile = FILE_NS.test(s.slice(start + 2, start + 40).trimStart().replace(/^:/, ''));
    // Find the matching "]]" (links nest inside image captions).
    let depth = 0;
    let j = start;
    let end = -1;
    while (j < s.length) {
      if (s.startsWith('[[', j)) {
        depth++;
        j += 2;
      } else if (s.startsWith(']]', j)) {
        depth--;
        j += 2;
        if (!depth) {
          end = j;
          break;
        }
      } else if (s[j] === '\n' && depth === 1 && !isFile) {
        break; // an ordinary link never spans lines
      } else j++;
    }
    if (end < 0) {
      // Unclosed (a typo in the wiki): drop the brackets and go on with what follows.
      i = start + 2;
      continue;
    }
    const inner = s.slice(start + 2, end - 2);
    if (!isFile && !INTERWIKI.test(inner)) {
      const bar = inner.indexOf('|');
      const text = bar >= 0 ? inner.slice(bar + 1) : inner.replace(/^:/, '').replace(/#.*$/, '');
      out += replaceLinks(text);
    }
    i = end;
  }
  return out;
}

/** The markup-free text of a wikitext fragment (one line or paragraph). */
function inline(s: string): string {
  return cleanText(
    decodeEntities(
      s
        .replace(/\[(?:https?:)?\/\/[^\s\]]+\s+([^\]]*)\]/g, '$1')
        .replace(/\[(?:https?:)?\/\/[^\]]*\]/g, '')
        .replace(/'{2,}/g, '')
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]*>/g, '')
        // Leftovers of broken links ("Land|Länder]]", "Sand[[ und"): keep the shown text.
        .replace(/\[\[|\]\]/g, '')
        .replace(/[^\s|[\]]*\|(?=[^\s|])/g, ''),
    ),
  );
}

/** Wikitext of a whole article → paragraphs ("## " headings; references, templates, … removed). */
export function wikitextToParagraphs(wikitext: string): string[] {
  let s = wikitext.replace(/\r\n?/g, '\n');
  s = s
    .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .replace(/<ref\b[^>]*\/>/gi, '')
    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/<(gallery|math|chem|syntaxhighlight|source|pre|timeline|imagemap|score|graph|mapframe|references)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(?:references|gallery)\b[^>]*\/>/gi, '')
    .replace(/__[A-ZÄÖÜ_]+__/g, '');
  s = removeNested(s, '{{', '}}');
  s = removeTables(s);
  s = replaceLinks(s);

  const paragraphs: string[] = [];
  let buf: string[] = [];
  let stopped = false;
  const flush = () => {
    const text = inline(buf.join(' '));
    buf = [];
    if (text && /\p{L}/u.test(text)) paragraphs.push(text);
  };
  for (const raw of s.split('\n')) {
    if (stopped) break;
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const h = /^(={1,6})\s*(.*?)\s*\1$/.exec(line);
    if (h) {
      flush();
      const text = inline(h[2]);
      if (isStopHeading(text)) stopped = true;
      else if (text) paragraphs.push(HEADING + text);
      continue;
    }
    if (/^[*#:;]/.test(line)) {
      // List / indented item: its own paragraph; short items are navigation, not prose.
      flush();
      const text = inline(line.replace(/^[*#:;]+\s*/, ''));
      if (countWords(text) >= 4) paragraphs.push(text);
      continue;
    }
    if (/^-{4,}$/.test(line)) {
      flush();
      continue;
    }
    buf.push(line);
  }
  if (!stopped) flush();
  return tidy(paragraphs);
}
