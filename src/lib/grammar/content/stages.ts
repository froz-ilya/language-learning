import type { GrammarStage } from '../types';

/**
 * The learning path. Every stage belongs to one topic, so one rule covers all its words; each is a
 * few words that get confused, and the earlier words it mixes in. For the ending topics (9–14) the
 * "words" are cases ("der-akk"), the patterns of the topic.
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
      ru: 'weil называет причину; denn значит то же, но глагол остаётся на втором месте. obwohl — «хотя»: Es regnet, aber ich komme = Ich komme, obwohl es regnet.',
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
      ru: 'dass что-то утверждает («что»), ob передаёт вопрос «да или нет» («ли»).',
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
  {
    id: 9,
    topic: 'adj-der',
    words: ['der-nom', 'der-akk'],
    partners: [],
    contrast: {
      ru: 'После der, die, das прилагательное получает -e. Только в мужском роде в винительном падеже меняется всё: der rote Hund → den roten Hund.',
      en: 'After der, die, das the adjective takes -e. Only the masculine accusative changes: der rote Hund → den roten Hund.',
      de: 'Nach der, die, das bekommt das Adjektiv -e. Nur im Akkusativ maskulin ändert sich alles: der rote Hund → den roten Hund.',
    },
  },
  {
    id: 10,
    topic: 'adj-der',
    words: ['der-dat', 'der-gen'],
    partners: ['der-akk'],
    contrast: {
      ru: 'В дательном и родительном падеже после der всегда -en: mit dem roten Auto, wegen des kalten Wetters. Во множественном числе тоже: die roten Autos.',
      en: 'In the dative and genitive, after der it is always -en: mit dem roten Auto, wegen des kalten Wetters. The plural too: die roten Autos.',
      de: 'Im Dativ und Genitiv steht nach der immer -en: mit dem roten Auto, wegen des kalten Wetters. Im Plural auch: die roten Autos.',
    },
  },
  {
    id: 11,
    topic: 'adj-ein',
    words: ['ein-nom', 'ein-akk'],
    partners: ['der-nom', 'der-akk'],
    contrast: {
      ru: 'У ein нет окончания в трёх местах, и тогда род показывает прилагательное: ein roter Hund, ein rotes Auto. Сравни: der rote Hund, das rote Auto.',
      en: 'ein has no ending in three places, so the adjective shows the gender: ein roter Hund, ein rotes Auto. Compare der rote Hund, das rote Auto.',
      de: 'ein hat an drei Stellen keine Endung, darum zeigt das Adjektiv das Genus: ein roter Hund, ein rotes Auto. Vergleiche: der rote Hund, das rote Auto.',
    },
  },
  {
    id: 12,
    topic: 'adj-ein',
    words: ['ein-dat', 'ein-gen'],
    partners: ['der-dat'],
    contrast: {
      ru: 'В дательном и родительном падеже ein ведёт себя как der, и прилагательное снова получает -en: mit einem roten Auto, mit dem roten Auto.',
      en: 'In the dative and genitive ein behaves like der, and the adjective takes -en again: mit einem roten Auto, mit dem roten Auto.',
      de: 'Im Dativ und Genitiv verhält sich ein wie der, und das Adjektiv bekommt wieder -en: mit einem roten Auto, mit dem roten Auto.',
    },
  },
  {
    id: 13,
    topic: 'adj-none',
    words: ['none-nom', 'none-akk'],
    partners: ['ein-nom', 'ein-akk'],
    contrast: {
      ru: 'Без артикля окончание артикля берёт прилагательное: der Kaffee → heißer Kaffee, das Wasser → kaltes Wasser, den Saft → frischen Saft.',
      en: 'With no article the adjective takes the article’s ending: der Kaffee → heißer Kaffee, das Wasser → kaltes Wasser, den Saft → frischen Saft.',
      de: 'Ohne Artikel übernimmt das Adjektiv die Endung des Artikels: der Kaffee → heißer Kaffee, das Wasser → kaltes Wasser, den Saft → frischen Saft.',
    },
  },
  {
    id: 14,
    topic: 'adj-none',
    words: ['none-dat', 'none-gen'],
    partners: ['ein-dat', 'der-dat'],
    contrast: {
      ru: 'В дательном падеже без артикля прилагательное получает окончание dem или der: mit heißem Wasser, mit großer Freude. После артикля было бы -en: mit dem heißen Wasser.',
      en: 'In the dative with no article the adjective takes the ending of dem or der: mit heißem Wasser, mit großer Freude. After an article it would be -en: mit dem heißen Wasser.',
      de: 'Im Dativ ohne Artikel bekommt das Adjektiv die Endung von dem oder der: mit heißem Wasser, mit großer Freude. Nach einem Artikel wäre es -en: mit dem heißen Wasser.',
    },
  },
];

export function stageById(id: number): GrammarStage | undefined {
  return GRAMMAR_STAGES.find((s) => s.id === id);
}
