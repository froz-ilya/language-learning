import type { Lang } from '../types';

/**
 * Grammar: sentence-level practice, separate from word cards. Topics are authored data in
 * content/, one per word-order pattern; sentences are invented for this app.
 */

export type OrderTopicId = 'verb-second' | 'verb-end' | 'verb-after';
export type EndingTopicId = 'adj-der' | 'adj-ein' | 'adj-none';
export type TopicId = OrderTopicId | EndingTopicId;

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
  /** 1…14, the position on the path. */
  id: number;
  /** The topic: every word of a stage follows this one rule. */
  topic: TopicId;
  /** Its connectors as written in the topics, or for an ending topic its pattern ids ("der-akk"). */
  words: string[];
  /** Earlier words a stage session mixes in, because they get confused with this stage's. */
  partners: string[];
  /** One line: the contrast this stage is about. */
  contrast: RuleText;
}

interface ExerciseBase {
  /** Stable: progress is tied to it. Never change or reuse an id ("weil-3", "adj-ein-akk-2"). */
  id: string;
  /**
   * What this practises, the key the path groups by: one of the topic's connectors, or for an
   * ending topic one of its patterns ("ein-akk").
   */
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

/** Grammatical case and gender of a noun phrase; 'pl' is the plural of any gender. */
export type Case = 'nom' | 'akk' | 'dat' | 'gen';
export type Gender = 'm' | 'f' | 'n' | 'pl';
/** How an adjective is declined: after a der-word (weak), an ein-word (mixed), or no article (strong). */
export type Declension = 'der' | 'ein' | 'none';

/** One gap of an ending exercise: a word whose ending is missing. */
export interface EndingGap {
  /** The word without its ending, as written in the sentence: "d", "dies", "ein", "unser", "neu", "teur". */
  stem: string;
  /** The ending; '' when there is none ("ein Tisch", "mein Bruder"). */
  answer: string;
  /** The determiner (der, dieser, ein, mein…) or an adjective; the content test checks the answer by it. */
  role: 'det' | 'adj';
}

/** Tap the endings into the gaps of one noun phrase: "Ich kaufe ein__ neu__ Tisch." */
export interface EndingExercise extends ExerciseBase {
  kind: 'ending';
  /** The sentence with each gap as {0}, {1}… in order: "Ich kaufe {0} {1} Tisch." */
  text: string;
  gaps: EndingGap[];
  /** The noun phrase the gaps are in. `det` is the determiner's dictionary form (DETERMINERS), '' for none. */
  phrase: { det: string; case: Case; gender: Gender };
}

export type GrammarExercise = BuildExercise | PickExercise | EndingExercise;

/** A sentence with endings to mark: each mark is a word of `de` with its ending split off by "|". */
export interface EndingExample {
  de: string;
  tr: Tr;
  /** "d|en", "rot|en", "ein|"; written exactly as the word stands in `de`. */
  marks: string[];
}

/** One case of an ending topic: the unit the path's stages are made of, like a connector. */
export interface EndingPattern {
  /** `${declension}-${case}`, e.g. "ein-akk": what its exercises carry as `connector`. */
  id: string;
  case: Case;
  /** One short line: the endings in this case and the one to watch. */
  rule: RuleText;
  example: EndingExample;
  /** A trap worth a line. */
  note?: RuleText;
}

interface TopicBase {
  title: RuleText;
  /** One sentence: what happens to the verb, or to the ending. */
  summary: RuleText;
  /** The pattern at a glance, e.g. "…, weil + subject + … + VERB". */
  formula: RuleText;
  /** Short explanation, one point per entry. */
  points: RuleText[];
  exercises: GrammarExercise[];
}

/** A word-order group: where the verb goes after its connectors. */
export interface OrderTopic extends TopicBase {
  area: 'order';
  id: OrderTopicId;
  connectors: Connector[];
  examples: RuleExample[];
}

/**
 * Adjective endings after one kind of determiner. The ending tables themselves are not authored:
 * they come from lib/grammar/endings.ts, which the content test also checks every answer with.
 */
export interface EndingTopic extends TopicBase {
  area: 'endings';
  id: EndingTopicId;
  declension: Declension;
  /** Its cases, in the order nom, akk, dat, gen. */
  patterns: EndingPattern[];
  examples: EndingExample[];
}

export type GrammarTopic = OrderTopic | EndingTopic;

/** A part of the tab with its own page, path and cheat sheet: word order, endings… */
export type AreaId = GrammarTopic['area'];

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
