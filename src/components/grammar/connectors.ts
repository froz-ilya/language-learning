import { GRAMMAR_TOPICS } from '../../lib/grammar/content';
import type { Connector } from '../../lib/grammar/types';

/** A connector by the word as it is written in the topics. */
export function connectorOf(word: string): Connector | undefined {
  return GRAMMAR_TOPICS.flatMap((topic) => topic.connectors).find((c) => c.word === word);
}
