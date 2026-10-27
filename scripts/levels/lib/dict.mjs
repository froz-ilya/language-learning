// @ts-nocheck
// Stage 1: stream the kaikki.org German Wiktionary dump into a compact dictionary index.
import fs from 'node:fs';
import readline from 'node:readline';
import zlib from 'node:zlib';
import { mergeLemma, parseKaikkiEntry } from './extract.mjs';

const PARADIGM_POS = new Set(['pron', 'det', 'article', 'num']);

/**
 * @param {string} dumpPath raw-wiktextract-data.jsonl.gz
 * @param {Set<string>} tokens lower-cased tokens of the frequency list (limits the form map)
 * @returns {Promise<{lemmas: Record<string, object>, forms: Record<string, string[]>}>}
 *   lemmas keyed "word|rawPos"; forms: token → ["word|rawPos" | "word|?<posHint>"]
 */
export async function buildDict(dumpPath, tokens, log = console.log) {
  const lemmas = new Map();
  const forms = new Map();
  const addForm = (token, target) => {
    if (!tokens.has(token)) return;
    let list = forms.get(token);
    if (!list) forms.set(token, (list = []));
    if (!list.includes(target)) list.push(target);
  };

  const input = fs.createReadStream(dumpPath).pipe(zlib.createGunzip());
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  let n = 0;
  for await (const line of rl) {
    if (++n % 200000 === 0) log(`  …${n} lines, ${lemmas.size} lemmas`);
    if (!line.includes('"lang_code": "de"')) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const rec = parseKaikkiEntry(entry);
    if (!rec) continue;
    if (rec.kind === 'form') {
      for (const l of rec.lemmas) addForm(rec.word.toLowerCase(), `${rec.imperative ? '!' : ''}${l}|?${rec.rawPos}`);
      continue;
    }
    const key = `${rec.word}|${rec.rawPos}`;
    // Pronoun/article paradigms list every person and case ("ich" lists "wir", "uns", …):
    // those forms are separate dictionary words, so only content words map their forms.
    rec.forms = PARADIGM_POS.has(rec.rawPos) ? [] : rec.forms.filter((f) => tokens.has(f));
    const prev = lemmas.get(key);
    lemmas.set(key, prev ? mergeLemma(prev, rec) : rec);
    addForm(rec.word.toLowerCase(), key);
    for (const f of rec.forms) addForm(f, key);
  }
  log(`  ${n} lines, ${lemmas.size} German lemma entries, ${forms.size} matched tokens`);
  return { lemmas: Object.fromEntries(lemmas), forms: Object.fromEntries(forms) };
}
