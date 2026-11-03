import { ENDING_TOPICS, ORDER_TOPICS } from '../../lib/grammar/content';
import { CASE_NAMES } from '../../lib/grammar/endings';
import type { AreaId, Case, Connector, EndingPattern, GrammarStage } from '../../lib/grammar/types';
import { t } from '../../lib/i18n.svelte';

/** A connector by the word as it is written in the topics. */
export function connectorOf(word: string): Connector | undefined {
  return ORDER_TOPICS.flatMap((topic) => topic.connectors).find((c) => c.word === word);
}

/** An ending pattern by its id ("ein-akk"). */
export function patternOf(id: string): EndingPattern | undefined {
  return ENDING_TOPICS.flatMap((topic) => topic.patterns).find((p) => p.id === id);
}

/** The case of a pattern id, read from the id itself, so it works before the content has it. */
export function caseOf(id: string): Case | undefined {
  const c = id.slice(id.lastIndexOf('-') + 1);
  return c in CASE_NAMES ? (c as Case) : undefined;
}

/** How a stage word is shown: a connector as written, a pattern as its German case name. */
export function wordTitle(word: string): string {
  const c = patternOf(word)?.case ?? caseOf(word);
  return c ? CASE_NAMES[c] : word;
}

/** How the determiner of a declension is named, German: taught terms, not interface text. */
const DECLENSION_NAMES: Record<string, string> = { der: 'der', ein: 'ein', none: 'ohne Artikel' };

/** A word's own title where its stage isn't in sight: "weil", or for a pattern "ein · Dativ". */
export function wordFullTitle(word: string): string {
  const c = patternOf(word)?.case ?? caseOf(word);
  const name = DECLENSION_NAMES[word.slice(0, word.indexOf('-'))];
  return c && name ? `${name} · ${CASE_NAMES[c]}` : word;
}

/** A stage's words in one line, German ("weil · obwohl", "Nominativ · Akkusativ"). */
export function stageTitle(stage: GrammarStage): string {
  return stage.words.map(wordTitle).join(' · ');
}

/** An area's name and one-line description, in the interface language. */
export function areaTitle(id: AreaId): string {
  return id === 'order' ? t('grammar.areaOrder') : t('grammar.areaEndings');
}

/** For a switch between areas, where the full name doesn't fit. */
export function areaShort(id: AreaId): string {
  return id === 'order' ? t('grammar.areaOrder') : t('grammar.areaEndingsShort');
}

export function areaSub(id: AreaId): string {
  return id === 'order' ? t('grammar.areaOrderSub') : t('grammar.areaEndingsSub');
}
