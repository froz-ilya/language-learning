import type { Grade } from 'ts-fsrs';
import type { StudyItem, StudyMode } from './session';

export interface ModeInfo {
  name: string;
  description: string;
  /** Icon name, or a short text badge. */
  icon?: 'cards' | 'edit' | 'check' | 'sparkle' | 'speaker' | 'refresh';
  badge?: string;
  /** Whether the DE/translation direction setting applies. */
  usesDirection: boolean;
}

export const MODE_INFO: Record<StudyMode, ModeInfo> = {
  flashcards: { name: 'Flashcards', description: 'Flip cards and rate how well you knew them', icon: 'cards', usesDirection: true },
  write: { name: 'Write', description: 'Type the answer', icon: 'edit', usesDirection: true },
  choice: { name: 'Multiple choice', description: 'Pick the right answer out of four', icon: 'check', usesDirection: true },
  match: { name: 'Match', description: 'Pair words with their translations', icon: 'sparkle', usesDirection: false },
  listen: { name: 'Listen', description: 'Hear the German word and type it', icon: 'speaker', usesDirection: false },
  articles: { name: 'Articles', description: 'der, die or das?', badge: 'der', usesDirection: false },
  verbs: { name: 'Verb forms', description: 'Präteritum, Partizip II, haben/sein', icon: 'refresh', usesDirection: false },
  pronouns: { name: 'Reflexive pronouns', description: 'mich or mir? Fill in the pronoun', badge: 'sich', usesDirection: false },
};

/** Props shared by the queue-based mode components. */
export interface ModeProps {
  item: StudyItem;
  /** Called once per question, as soon as the answer is known (records SRS / re-queues). */
  onanswer: (grade: Grade, correct: boolean) => void;
  /** Move on to the next question. */
  onnext: () => void;
}
