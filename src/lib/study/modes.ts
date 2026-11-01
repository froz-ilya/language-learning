import type { Grade } from 'ts-fsrs';
import { t } from '../i18n.svelte';
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

function mode(id: StudyMode, info: Omit<ModeInfo, 'name' | 'description'>): ModeInfo {
  return {
    get name() {
      return t(`study.mode.${id}.name`);
    },
    get description() {
      return t(`study.mode.${id}.desc`);
    },
    ...info,
  };
}

export const MODE_INFO: Record<StudyMode, ModeInfo> = {
  flashcards: mode('flashcards', { icon: 'cards', usesDirection: true }),
  write: mode('write', { icon: 'edit', usesDirection: true }),
  choice: mode('choice', { icon: 'check', usesDirection: true }),
  match: mode('match', { icon: 'sparkle', usesDirection: false }),
  listen: mode('listen', { icon: 'speaker', usesDirection: false }),
  articles: mode('articles', { badge: 'der', usesDirection: false }),
  verbs: mode('verbs', { icon: 'refresh', usesDirection: false }),
  pronouns: mode('pronouns', { badge: 'sich', usesDirection: false }),
};

/** Props shared by the queue-based mode components. */
export interface ModeProps {
  item: StudyItem;
  /** Called once per question, as soon as the answer is known (records SRS / re-queues). */
  onanswer: (grade: Grade, correct: boolean) => void;
  /** Move on to the next question. */
  onnext: () => void;
}
