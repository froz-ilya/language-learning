import { db } from '../db/schema';
import { systemName } from '../i18n.svelte';
import type { Card, Lang } from '../types';
import type { Article } from './types';
import { translateArticleExamples } from './exampleTranslations';
import {
  addWordToArticle,
  addTappedWord,
  articleSetName,
  articleTitle,
  ensureArticleSet,
  ensureTranslatorSet,
  findTranslatorSet,
  TRANSLATOR_SET,
} from './store';

/** A word added by the word sheet: its card, the set it is in, and whether it was new there. */
export interface AddedWord {
  cardId: number;
  setId: number;
  created: boolean;
}

/**
 * Where the word sheet (components/reading/WordSheet.svelte) adds tapped words: an article's own
 * set in the reader, the translator's set in the translator.
 */
export interface WordTarget {
  /** The set's name to show (follows the interface language where the app named it). */
  readonly setName: string;
  /** The set's id, 0 while it doesn't exist yet. Reads only: use inside live() to follow it. */
  findSet(): Promise<number>;
  /** The set's id, created on first use. */
  ensureSet(): Promise<number>;
  /** Add a word (the same word already in the set is returned instead); `context` becomes its first example. */
  add(fields: Partial<Card> & { term: string }, context?: string): Promise<AddedWord>;
  /** After a card was created: fill in its example's translation in the background. */
  afterAdd(lang: Lang): void;
}

/** The article's word set, created on first add (named after the article, in the "Reading" folder). */
export function articleTarget(article: Article): WordTarget {
  return {
    get setName() {
      return articleSetName(articleTitle(article));
    },
    findSet: async () => (await db.articles.get(article.id))?.setId ?? 0,
    ensureSet: () => ensureArticleSet(article),
    add: (fields, context) => addWordToArticle(article, fields, context),
    afterAdd: (lang) => void translateArticleExamples(lang),
  };
}

/** The translator's word set "Translator" in the "Reading" folder, created on first add. */
export function translatorTarget(): WordTarget {
  return {
    get setName() {
      return systemName(TRANSLATOR_SET);
    },
    findSet: findTranslatorSet,
    ensureSet: ensureTranslatorSet,
    add: async (fields, context) => addTappedWord(await ensureTranslatorSet(), fields, context),
    afterAdd: (lang) => void translateArticleExamples(lang),
  };
}
