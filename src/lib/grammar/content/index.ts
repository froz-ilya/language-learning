import type { GrammarExercise, GrammarTopic } from '../types';
import { verbAfter } from './verbAfter';
import { verbEnd } from './verbEnd';
import { verbSecond } from './verbSecond';

export { GRAMMAR_STAGES, stageById } from './stages';

export const GRAMMAR_TOPICS: GrammarTopic[] = [verbSecond, verbEnd, verbAfter];

export function topicById(id: string): GrammarTopic | undefined {
  return GRAMMAR_TOPICS.find((t) => t.id === id);
}

export function allExercises(): GrammarExercise[] {
  return GRAMMAR_TOPICS.flatMap((t) => t.exercises);
}
