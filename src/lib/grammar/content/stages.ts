import type { GrammarStage } from '../types';

/**
 * The learning path. Every stage belongs to one word-order group, so one rule covers all its words;
 * each is a few words that get confused, and the earlier words it mixes in.
 */
export const GRAMMAR_STAGES: GrammarStage[] = [
  {
    id: 1,
    topic: 'verb-second',
    words: ['und', 'oder', 'aber'],
    partners: [],
    contrast: {
      ru: 'und добавляет, oder даёт выбор, aber противопоставляет.',
      en: 'und adds something, oder gives a choice, aber sets up a contrast.',
      de: 'und fügt etwas hinzu, oder gibt eine Wahl, aber drückt einen Gegensatz aus.',
    },
  },
  {
    id: 2,
    topic: 'verb-second',
    words: ['sondern', 'denn'],
    partners: ['aber'],
    contrast: {
      ru: 'sondern стоит только после отрицания и заменяет то, что отрицали. Иначе нужно aber. denn называет причину.',
      en: 'sondern comes only after a negative and replaces what was denied. Otherwise use aber. denn gives the reason.',
      de: 'sondern steht nur nach einer Verneinung und ersetzt das Verneinte. Sonst nimmst du aber. denn nennt den Grund.',
    },
  },
  {
    id: 3,
    topic: 'verb-end',
    words: ['weil', 'obwohl'],
    partners: ['denn', 'aber'],
    contrast: {
      ru: 'weil называет причину. denn значит то же, но глагол остаётся на втором месте. obwohl — «хотя»: Es regnet, aber ich komme = Ich komme, obwohl es regnet.',
      en: 'weil gives the reason; denn means the same but keeps the verb second. obwohl means "although": Es regnet, aber ich komme = Ich komme, obwohl es regnet.',
      de: 'weil nennt den Grund; denn bedeutet das Gleiche, aber das Verb bleibt auf Platz 2. Mit obwohl: Es regnet, aber ich komme = Ich komme, obwohl es regnet.',
    },
  },
  {
    id: 4,
    topic: 'verb-end',
    words: ['dass', 'ob'],
    partners: ['weil'],
    contrast: {
      ru: 'dass — это «что», ob — это «ли»: вопрос, на который отвечают «да» или «нет».',
      en: 'dass states something; ob passes on a yes/no question.',
      de: 'dass sagt etwas aus, ob gibt eine Ja-Nein-Frage weiter.',
    },
  },
  {
    id: 5,
    topic: 'verb-end',
    words: ['wenn', 'als'],
    partners: ['weil'],
    contrast: {
      ru: 'wenn — настоящее, будущее, условие и всё, что повторялось в прошлом. als — одно событие или один период в прошлом. Вопрос «когда?» — это wann.',
      en: 'wenn is for the present, the future, conditions and things repeated in the past; als for one event or period in the past. The question "when?" is wann.',
      de: 'wenn: Gegenwart, Zukunft, Bedingungen und Wiederholtes in der Vergangenheit. als: ein einmaliges Ereignis oder ein Zeitraum in der Vergangenheit. Fragst du nach der Zeit: wann.',
    },
  },
  {
    id: 6,
    topic: 'verb-end',
    words: ['bevor', 'nachdem'],
    partners: ['als', 'wenn'],
    contrast: {
      ru: 'bevor вводит то, что идёт позже, nachdem — то, что уже закончилось. Поэтому время после nachdem на шаг раньше: Perfekt при Präsens, Plusquamperfekt при Präteritum.',
      en: 'bevor introduces what comes later, nachdem what is already finished. So nachdem takes the tense one step back: Perfekt for Präsens, Plusquamperfekt for Präteritum.',
      de: 'bevor leitet ein, was später passiert, nachdem, was schon abgeschlossen ist. Darum geht nachdem eine Zeitstufe zurück: Perfekt zum Präsens, Plusquamperfekt zum Präteritum.',
    },
  },
  {
    id: 7,
    topic: 'verb-after',
    words: ['deshalb', 'deswegen', 'dann'],
    partners: ['denn', 'weil'],
    contrast: {
      ru: 'deshalb и deswegen значат одно и то же: после них идёт следствие, а после weil и denn — причина. dann — «потом» или «тогда», не путай его с denn.',
      en: 'deshalb and deswegen mean the same and give the result; weil and denn give the reason. dann means "then": don\'t mix it up with denn.',
      de: 'deshalb und deswegen bedeuten das Gleiche und nennen die Folge, weil und denn den Grund. dann heißt „danach“ oder „in dem Fall“: Verwechsle es nicht mit denn.',
    },
  },
  {
    id: 8,
    topic: 'verb-after',
    words: ['trotzdem', 'sonst', 'außerdem'],
    partners: ['obwohl', 'deshalb'],
    contrast: {
      ru: 'trotzdem передаёт ту же мысль, что obwohl, но глагол идёт сразу за ним. sonst показывает, что будет, если этого не сделать. außerdem добавляет что-то ещё.',
      en: "trotzdem is the same idea as obwohl, but the verb comes right after it. sonst says what happens if you don't do it. außerdem adds one more point.",
      de: 'trotzdem ist der gleiche Gedanke wie obwohl, aber das Verb kommt direkt danach. sonst sagt, was passiert, wenn du es nicht machst. außerdem fügt noch etwas hinzu.',
    },
  },
];

export function stageById(id: number): GrammarStage | undefined {
  return GRAMMAR_STAGES.find((s) => s.id === id);
}
