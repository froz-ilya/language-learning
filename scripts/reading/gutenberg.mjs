#!/usr/bin/env node
// @ts-nocheck
// Bundles curated short public-domain German texts from Project Gutenberg into
// public/reading/gutenberg.json (Gutenberg's book files can't be fetched from the browser).
//   node scripts/reading/gutenberg.mjs [--offline]
// Book files are downloaded once (a handful of requests, a few seconds apart) and cached in
// scripts/reading/.cache/ (gitignored). Stories are cut out of the books by their headings,
// the Gutenberg header/footer is stripped, and long texts are split into parts of ≤1,500 words.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractSection, splitParts, stripGutenberg, toParagraphs, wordCount } from './lib/text.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, '.cache');
const ROOT = path.resolve(HERE, '../..');
const OUT = path.join(ROOT, 'public/reading/gutenberg.json');
const OFFLINE = process.argv.includes('--offline');
const PAUSE_MS = 3000;
const MAX_WORDS = 1500;
const LICENSE = 'Public domain (Project Gutenberg)';
const USER_AGENT = 'DeutschLernen PWA build script (one-off download of a few public-domain texts)';

/** Gutenberg books we cut stories out of. */
const BOOKS = {
  grimm: { id: 77905, author: 'Brüder Grimm', work: 'Deutsche Märchen (1921)' },
  andersen: { id: 19163, author: 'Hans Christian Andersen', work: 'Märchen für Kinder' },
  hebel: { id: 7810, author: 'Johann Peter Hebel', work: 'Schatzkästlein des rheinischen Hausfreundes' },
  landarzt: { id: 21989, author: 'Franz Kafka', work: 'Ein Landarzt. Kleine Erzählungen (1919)' },
  betrachtung: { id: 23532, author: 'Franz Kafka', work: 'Betrachtung (1913)' },
  verwandlung: { id: 22367, author: 'Franz Kafka', work: 'Die Verwandlung (1915)' },
  kleist: { id: 6645, author: 'Heinrich von Kleist', work: 'Ausgewählte Schriften' },
};

/**
 * Curated picks: [book, heading in the book, display title, slug, level, end heading?].
 * Levels are a rough guide (fairy tales are easier than Kafka or Kleist); the reader also
 * estimates a level from the text itself.
 */
const PICKS = [
  ['grimm', 'Der Froschkönig oder der eiserne Heinrich', 'Der Froschkönig', 'grimm-froschkoenig', 'B1'],
  ['grimm', 'Rotkäppchen', 'Rotkäppchen', 'grimm-rotkaeppchen', 'B1'],
  ['grimm', 'Hänsel und Gretel', 'Hänsel und Gretel', 'grimm-haensel-und-gretel', 'B1'],
  ['grimm', 'Die Bremer Stadtmusikanten', 'Die Bremer Stadtmusikanten', 'grimm-bremer-stadtmusikanten', 'B1'],
  ['grimm', 'Der Wolf und die sieben jungen Geisslein', 'Der Wolf und die sieben jungen Geißlein', 'grimm-wolf-geisslein', 'B1'],
  ['grimm', 'König Drosselbart', 'König Drosselbart', 'grimm-koenig-drosselbart', 'B1'],
  ['grimm', 'Frau Holle', 'Frau Holle', 'grimm-frau-holle', 'B1'],
  ['grimm', 'Rumpelstilzchen', 'Rumpelstilzchen', 'grimm-rumpelstilzchen', 'B1'],
  ['grimm', 'Dornröschen', 'Dornröschen', 'grimm-dornroeschen', 'B1'],
  ['grimm', 'Aschenputtel', 'Aschenputtel', 'grimm-aschenputtel', 'B1'],
  ['grimm', 'Hans im Glück', 'Hans im Glück', 'grimm-hans-im-glueck', 'B1'],
  ['grimm', 'Das tapfere Schneiderlein', 'Das tapfere Schneiderlein', 'grimm-tapferes-schneiderlein', 'B1'],
  ['andersen', 'Das kleine Mädchen mit den Schwefelhölzern.', 'Das kleine Mädchen mit den Schwefelhölzern', 'andersen-schwefelhoelzer', 'B1'],
  ['andersen', 'Das häßliche Entlein.', 'Das hässliche Entlein', 'andersen-entlein', 'B1'],
  ['andersen', 'Der standhafte Zinnsoldat.', 'Der standhafte Zinnsoldat', 'andersen-zinnsoldat', 'B1'],
  ['andersen', 'Die Theekanne.', 'Die Teekanne', 'andersen-teekanne', 'B1'],
  ['andersen', 'Der Schneemann.', 'Der Schneemann', 'andersen-schneemann', 'B1'],
  ['andersen', 'Fünf in einer Schote.', 'Fünf aus einer Erbsenschote', 'andersen-erbsenschote', 'B1'],
  ['hebel', 'Kannitverstan', 'Kannitverstan', 'hebel-kannitverstan', 'B2'],
  ['hebel', 'Unverhofftes Wiedersehen', 'Unverhofftes Wiedersehen', 'hebel-unverhofftes-wiedersehen', 'B2'],
  ['hebel', 'Der kluge Richter', 'Der kluge Richter', 'hebel-kluge-richter', 'B2'],
  ['hebel', 'Das wohlfeile Mittagessen', 'Das wohlfeile Mittagessen', 'hebel-mittagessen', 'B2'],
  ['hebel', 'Seltsamer Spazierritt', 'Seltsamer Spazierritt', 'hebel-spazierritt', 'B2'],
  ['hebel', 'Der Zahnarzt', 'Der Zahnarzt', 'hebel-zahnarzt', 'B2'],
  ['hebel', 'Drei Wünsche', 'Drei Wünsche', 'hebel-drei-wuensche', 'B2'],
  ['landarzt', 'Vor dem Gesetz.', 'Vor dem Gesetz', 'kafka-vor-dem-gesetz', 'C1'],
  ['landarzt', 'Eine kaiserliche Botschaft.', 'Eine kaiserliche Botschaft', 'kafka-kaiserliche-botschaft', 'C1'],
  ['landarzt', 'Das nächste Dorf.', 'Das nächste Dorf', 'kafka-naechstes-dorf', 'C1'],
  ['landarzt', 'Auf der Galerie.', 'Auf der Galerie', 'kafka-galerie', 'C1'],
  ['landarzt', 'Der neue Advokat.', 'Der neue Advokat', 'kafka-neuer-advokat', 'C1'],
  ['landarzt', 'Die Sorge des Hausvaters.', 'Die Sorge des Hausvaters', 'kafka-hausvater', 'C1'],
  ['landarzt', 'Ein Traum.', 'Ein Traum', 'kafka-ein-traum', 'C1', 'Ein Bericht für eine Akademie.'],
  ['betrachtung', 'Kinder auf der Landstraße', 'Kinder auf der Landstraße', 'kafka-kinder-landstrasse', 'C1'],
  ['betrachtung', 'Der plötzliche Spaziergang', 'Der plötzliche Spaziergang', 'kafka-spaziergang', 'C1'],
  ['betrachtung', 'Wunsch, Indianer zu werden', 'Wunsch, Indianer zu werden', 'kafka-indianer', 'C1'],
  ['betrachtung', 'Die Bäume', 'Die Bäume', 'kafka-baeume', 'C1'],
  ['verwandlung', 'I.', 'Die Verwandlung – Teil I', 'kafka-verwandlung-i', 'C1'],
  ['verwandlung', 'II.', 'Die Verwandlung – Teil II', 'kafka-verwandlung-ii', 'C1'],
  ['verwandlung', 'III.', 'Die Verwandlung – Teil III', 'kafka-verwandlung-iii', 'C1'],
  ['kleist', 'Das Bettelweib von Locarno', 'Das Bettelweib von Locarno', 'kleist-bettelweib', 'C2'],
  ['kleist', 'Das Erdbeben in Chili', 'Das Erdbeben in Chili', 'kleist-erdbeben', 'C2'],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastRequest = 0;

async function bookLines(book) {
  fs.mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, `pg${book.id}.txt`);
  if (!fs.existsSync(file)) {
    if (OFFLINE) throw new Error(`missing ${file} (offline)`);
    const wait = lastRequest + PAUSE_MS - Date.now();
    if (wait > 0) await sleep(wait);
    const url = `https://www.gutenberg.org/cache/epub/${book.id}/pg${book.id}.txt`;
    console.log(`Downloading ${url}`);
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    lastRequest = Date.now();
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    fs.writeFileSync(file, await res.text());
  }
  return stripGutenberg(fs.readFileSync(file, 'utf8'));
}

function snippetOf(paras) {
  const first = paras.find((p) => wordCount(p) >= 5) ?? paras[0] ?? '';
  // First sentence (not cut after an abbreviation like "Dr." or an initial like "K.").
  const sentence = first.match(/^.{20,200}?[^\s.]{3}[.!?](?=\s|$)/u)?.[0];
  return sentence ?? `${first.slice(0, 160).replace(/\s+\S*$/, '')}…`;
}

async function main() {
  const texts = [];
  const lines = {};
  for (const [bookKey, heading, title, slug, level, until] of PICKS) {
    const book = BOOKS[bookKey];
    lines[bookKey] ??= await bookLines(book);
    const paras = toParagraphs(extractSection(lines[bookKey], heading, until));
    if (!paras.length) throw new Error(`empty: ${title}`);
    const parts = splitParts(paras, MAX_WORDS);
    parts.forEach((p, i) => {
      const multi = parts.length > 1;
      texts.push({
        id: multi ? `${slug}-${i + 1}` : slug,
        title: multi ? `${title} (${i + 1}/${parts.length})` : title,
        author: book.author,
        work: book.work,
        url: `https://www.gutenberg.org/ebooks/${book.id}`,
        level,
        words: p.reduce((n, x) => n + wordCount(x), 0),
        snippet: snippetOf(p),
        paragraphs: p,
      });
    });
  }
  const out = { version: 1, license: LICENSE, texts };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const json = JSON.stringify(out);
  fs.writeFileSync(OUT, json);
  const words = texts.reduce((n, t) => n + t.words, 0);
  console.log(`${PICKS.length} texts → ${texts.length} parts, ${words} words, ${(json.length / 1024).toFixed(0)} KB → ${path.relative(ROOT, OUT)}`);
  if (json.length > 1024 * 1024) throw new Error('gutenberg.json is over 1 MB: drop some picks');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
