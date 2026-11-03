import type { AreaId, EndingTopic, GrammarExercise, GrammarStage, GrammarTopic, OrderTopic } from '../types';
import { adjDer } from './adjDer';
import { adjEin } from './adjEin';
import { adjNone } from './adjNone';
import { verbAfter } from './verbAfter';
import { verbEnd } from './verbEnd';
import { GRAMMAR_STAGES } from './stages';
import { verbSecond } from './verbSecond';

export { GRAMMAR_STAGES, stageById } from './stages';

export const ORDER_TOPICS: OrderTopic[] = [verbSecond, verbEnd, verbAfter];
export const ENDING_TOPICS: EndingTopic[] = [adjDer, adjEin, adjNone];
export const GRAMMAR_TOPICS: GrammarTopic[] = [...ORDER_TOPICS, ...ENDING_TOPICS];

export function topicById(id: string): GrammarTopic | undefined {
  return GRAMMAR_TOPICS.find((t) => t.id === id);
}

export function allExercises(): GrammarExercise[] {
  return GRAMMAR_TOPICS.flatMap((t) => t.exercises);
}

/**
 * The areas of the tab, each a page of its own with its topics and its part of the path, so the
 * tab stays short as areas are added. An area's stages keep their ids (routes and progress use
 * them) but are numbered from 1 within the area.
 */
export interface GrammarArea {
  id: AreaId;
  topics: GrammarTopic[];
  stages: GrammarStage[];
}

export const AREA_IDS: AreaId[] = ['order', 'endings'];

export const GRAMMAR_AREAS: GrammarArea[] = AREA_IDS.map((id) => {
  const topics = GRAMMAR_TOPICS.filter((t) => t.area === id);
  return { id, topics, stages: GRAMMAR_STAGES.filter((s) => topics.some((t) => t.id === s.topic)) };
});

export function areaById(id: string): GrammarArea | undefined {
  return GRAMMAR_AREAS.find((a) => a.id === id);
}

/** The area a topic or stage belongs to. */
export function areaOf(topicId: string): GrammarArea | undefined {
  return GRAMMAR_AREAS.find((a) => a.topics.some((t) => t.id === topicId));
}

/** A stage's number within its area, from 1. By id: a stage may come back from live() as a copy. */
export function stageNumber(stage: GrammarStage): number {
  return (areaOf(stage.topic)?.stages.findIndex((s) => s.id === stage.id) ?? -1) + 1 || stage.id;
}

export function areaExercises(area: GrammarArea): GrammarExercise[] {
  return area.topics.flatMap((t) => t.exercises);
}
