import { db } from '../db/schema';
import { fillTiming, translateSentences } from '../lookup/lookup';
import type { Card, Example, Lang } from '../types';
import { findTranslatorSet } from './store';

/**
 * The sentence a word was read in goes onto its card untranslated: adding a word never waits for
 * the network. This fills in the translations in the background, for every word set linked to an
 * article and the translator's set, so a sentence added offline or while the services were down
 * gets one on a later run.
 */

/** Sentences sent in one go (about one request), with fillTiming's pause between them. */
const BATCH = 30;

const untranslated = (e: Example) => !!e.de.trim() && !e.tr?.trim();

/**
 * By the article link, not the Reading folder: a set the user moved stays the article's. Words
 * tapped in the translator are in its own set, found by name (see findTranslatorSet).
 */
async function cardsToTranslate(): Promise<Card[]> {
  const setIds = new Set<number>();
  await db.articles.each((a) => {
    if (a.setId) setIds.add(a.setId);
  });
  const translatorSet = await findTranslatorSet();
  if (translatorSet) setIds.add(translatorSet);
  if (!setIds.size) return [];
  return db.cards
    .where('setId')
    .anyOf([...setIds])
    .filter((c) => c.examples.some(untranslated))
    .toArray();
}

/** Into the cards as they are now: an example the user translated or changed meanwhile is kept. */
function saveTranslations(ids: number[], translations: Map<string, string>): Promise<void> {
  const translation = (e: Example) => (untranslated(e) ? translations.get(e.de) : undefined);
  return db.transaction('rw', db.cards, async () => {
    const cards = await db.cards.bulkGet(ids);
    const changed = cards.filter((c): c is Card => !!c && c.examples.some(translation));
    await db.cards.bulkPut(changed.map((c) => ({ ...c, examples: c.examples.map((e) => ({ ...e, ...(translation(e) ? { tr: translation(e) } : {}) })) })));
  });
}

async function translateMissing(lang: Lang): Promise<void> {
  const cards = await cardsToTranslate();
  const ids = cards.map((c) => c.id!);
  // A text's words often share a sentence: each is translated once.
  const sentences = [...new Set(cards.flatMap((c) => c.examples.filter(untranslated).map((e) => e.de)))];
  for (let i = 0; i < sentences.length; i += BATCH) {
    if (i) await new Promise((resolve) => setTimeout(resolve, fillTiming.batchGapMs));
    const batch = sentences.slice(i, i + BATCH);
    const lines = await translateSentences(batch, lang);
    const translations = new Map(batch.map((de, k) => [de, lines[k]]).filter(([, tr]) => tr) as [string, string][]);
    if (!translations.size) return; // Offline or no service answered: a later run does the rest.
    await saveTranslations(ids, translations);
  }
}

let running = false;
let wanted: Lang | null = null;

/**
 * Translate the examples still missing a translation. One run at a time: a call during a run
 * (another word was added) starts one more after it, which sees everything new.
 */
export async function translateArticleExamples(lang: Lang): Promise<void> {
  wanted = lang;
  if (running) return;
  running = true;
  try {
    while (wanted) {
      const next = wanted;
      wanted = null;
      await translateMissing(next);
    }
  } catch (e) {
    console.warn('example translation failed', e);
  } finally {
    running = false;
  }
}
