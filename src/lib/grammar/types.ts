import type { Lang } from '../types';

/**
 * Grammar: sentence-level practice, separate from word cards. Topics are authored data in
 * content/, one per word-order pattern; sentences are invented for this app.
 */

export type TopicId = 'verb-second' | 'verb-end' | 'verb-after';

/** A translation of German text, in the language words are translated into. */
export type Tr = Record<Lang, string>;

/**
 * Explanatory text, shown in the interface language (`x[i18n.lang]`). Teaching content, so it is
 * data and not an i18n key.
 */
export type RuleText = Record<Lang | 'de', string>;

export interface RuleExample {
  de: string;
  tr: Tr;
  /** Words of `de` to highlight, exactly as written there. */
  connector: string;
  verbs: string[];
}

export interface Connector {
  word: string;
  meaning: Tr;
  /** A trap worth a line, e.g. wenn vs. als. */
  note?: RuleText;
  /** One typical sentence, for the cheat sheet. */
  example: RuleExample;
  /** Whether a sentence can begin with this word, and the word order then. */
  start: SentenceStart;
}

export interface SentenceStart {
  /** yes: normal. rare: correct, but unusual or spoken. no: not at the start. */
  use: 'yes' | 'rare' | 'no';
  /** One short line: what to do, or what to use instead. */
  rule: RuleText;
  /** The order from the start of the sentence, split on " + "; the verb in capitals. Not with `no`. */
  formula?: RuleText;
  /** Starts with this word. Not with `no`. */
  example?: RuleExample;
}

/**
 * One step of the learning path: a few words that belong together. A list of words, so progress
 * (stored per exercise) needs no change when stages do.
 */
export interface GrammarStage {
  /** 1…8, the position on the path. */
  id: number;
  /** The word-order group: every word of a stage follows this one rule. */
  topic: TopicId;
  /** Its connectors, as written in the topics. */
  words: string[];
  /** Earlier words a stage session mixes in, because they get confused with this stage's. */
  partners: string[];
  /** One line: the contrast this stage is about. */
  contrast: RuleText;
}

interface ExerciseBase {
  /** Stable: progress is tied to it. Never change or reuse an id ("weil-3"). */
  id: string;
  /** The word this practises, one of the topic's connectors. */
  connector: string;
  /** 1: one simple verb. 2: modal, Perfekt, separable verb, or the clause comes first. */
  level: 1 | 2;
  /** Translation of the whole sentence. */
  tr: Tr;
  /** Verb forms to highlight in the finished sentence, exactly as written ("muss", "arbeiten"). */
  verbs?: string[];
}

/** Tap the shuffled words into the right order. */
export interface BuildExercise extends ExerciseBase {
  kind: 'build';
  /** Fixed text shown before the tiles, usually the first clause or sentence. */
  given?: string;
  /**
   * What follows `given`, complete with capitals and punctuation. Every accepted order; the first
   * is the model answer. All must contain exactly the same words.
   */
  answers: string[];
  /** The tile for the first word keeps its capital: a noun, a name or "Sie". */
  keepFirstCap?: boolean;
}

/** Pick the word that fits the blank. */
export interface PickExercise extends ExerciseBase {
  kind: 'pick';
  /** The sentence before and after the blank. */
  before: string;
  after: string;
  /** Lower-case unless it is a noun: the capital at the start of a sentence is added on display. */
  answer: string;
  /** 3 or 4 words including the answer; only the answer may be correct. */
  options: string[];
}

export type GrammarExercise = BuildExercise | PickExercise;

export interface GrammarTopic {
  id: TopicId;
  title: RuleText;
  /** One sentence: what happens to the verb. */
  summary: RuleText;
  /** The pattern at a glance, e.g. "…, weil + subject + … + VERB". */
  formula: RuleText;
  /** Short explanation, one point per entry. */
  points: RuleText[];
  connectors: Connector[];
  examples: RuleExample[];
  exercises: GrammarExercise[];
}

/** Stored per exercise in db.grammar; an exercise never practised has no row. */
export interface GrammarProgress {
  id: string;
  /** Spacing step, 0 after a mistake. */
  box: number;
  /** Next review, ms since epoch. */
  due: number;
  lastAt: number;
  right: number;
  wrong: number;
}
