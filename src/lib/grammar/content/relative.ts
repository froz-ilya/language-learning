import type { RelativeTopic } from '../types';
import { relativeDatGen } from './relativeDatGen';
import { relativeNomAkk } from './relativeNomAkk';

/** Relative clauses: der, den, dem, dessen… as «который». The pronoun table is in endings.ts. */
export const relative: RelativeTopic = {
  area: 'relative',
  id: 'relative',
  title: {
    ru: 'Который: der, den, dem',
    en: 'Who, which: der, den, dem',
    de: 'Relativsätze: der, den, dem',
  },
  summary: {
    ru: 'Придаточное с «который» начинается с der, die или das. Род берётся от существительного, падеж — из самого придаточного, а глагол уходит в конец.',
    en: 'A clause with "who" or "which" starts with der, die or das. The gender comes from the noun, the case from the clause itself, and the verb goes to the end.',
    de: 'Ein Relativsatz beginnt mit der, die oder das. Das Genus kommt vom Nomen, der Kasus aus dem Relativsatz selbst, und das Verb steht am Ende.',
  },
  formula: {
    ru: 'существительное, + der / den / dem + … + VERB',
    en: 'noun, + der / den / dem + … + VERB',
    de: 'Nomen, + der / den / dem + … + VERB',
  },
  points: [
    {
      ru: 'Придаточное рассказывает о существительном, как «который» в русском: der Mann, der dort wohnt. Оно отделяется запятыми, и глагол стоит в конце, как после weil.',
      en: 'A relative clause tells more about a noun, like "who" or "which": der Mann, der dort wohnt. It is set off by commas, and the verb goes to the end, as after weil.',
      de: 'Ein Relativsatz sagt mehr über ein Nomen: der Mann, der dort wohnt. Er steht zwischen Kommas, und das Verb steht am Ende, wie nach weil.',
    },
    {
      ru: 'Род и число берутся от существительного, к которому относится слово: der Mann → der, die Frau → die, das Kind → das, die Leute → die.',
      en: 'The gender and number come from the noun it stands for: der Mann → der, die Frau → die, das Kind → das, die Leute → die.',
      de: 'Genus und Numerus kommen vom Nomen, für das das Pronomen steht: der Mann → der, die Frau → die, das Kind → das, die Leute → die.',
    },
    {
      ru: 'Падеж берётся из придаточного: что слово там делает. Как в русском: который (der), которого (den), которому (dem). der Mann, der hilft; der Mann, den ich kenne; der Mann, dem ich helfe.',
      en: 'The case comes from the clause: what the word does there. Subject: der Mann, der hilft. Object: der Mann, den ich kenne. After helfen, danken, gefallen: der Mann, dem ich helfe.',
      de: 'Der Kasus kommt aus dem Relativsatz: Was macht das Pronomen dort? Subjekt: der Mann, der hilft. Objekt: der Mann, den ich kenne. Nach helfen, danken, gefallen: der Mann, dem ich helfe.',
    },
    {
      ru: 'Проверка: поставь вместо него само существительное и сделай простое предложение. den ich kenne → ich kenne den Mann → den.',
      en: 'To check, put the noun in its place and make a plain sentence: den ich kenne → ich kenne den Mann → den.',
      de: 'Zum Prüfen setzt du das Nomen ein und machst einen einfachen Satz: den ich kenne → ich kenne den Mann → den.',
    },
    {
      ru: 'С предлогом падеж задаёт предлог, и предлог стоит перед словом, как в русском: die Frau, mit der ich arbeite — женщина, с которой я работаю.',
      en: 'With a preposition, the preposition decides the case and comes first: die Frau, mit der ich arbeite, "the woman I work with". It never goes to the end.',
      de: 'Mit Präposition bestimmt die Präposition den Kasus und steht vorne: die Frau, mit der ich arbeite. Sie steht nie am Ende.',
    },
    {
      ru: 'От артикля отличаются только denen в дательном падеже множественного числа и dessen, deren в родительном («чей», «у которого»): der Freund, dessen Auto kaputt ist.',
      en: 'Only denen in the dative plural and dessen, deren in the genitive differ from the article (dessen, deren mean "whose"): der Freund, dessen Auto kaputt ist.',
      de: 'Vom Artikel unterscheiden sich nur denen im Dativ Plural und dessen, deren im Genitiv: der Freund, dessen Auto kaputt ist.',
    },
  ],
  patterns: [
    {
      id: 'rel-nom',
      case: 'nom',
      rule: {
        ru: 'Слово — подлежащее придаточного: der, die, das, во множественном die. Так же, как артикль.',
        en: 'The pronoun is the subject of its clause: der, die, das, plural die. The same as the article.',
        de: 'Das Pronomen ist das Subjekt im Relativsatz: der, die, das, im Plural die. Genau wie der Artikel.',
      },
      example: {
        de: 'Der Mann, der neben uns wohnt, ist Arzt.',
        tr: { ru: 'Мужчина, который живёт рядом с нами, — врач.', en: 'The man who lives next door to us is a doctor.' },
        noun: 'Mann',
        pronoun: 'der',
        verbs: ['wohnt'],
      },
    },
    {
      id: 'rel-akk',
      case: 'akk',
      rule: {
        ru: 'Слово — дополнение (кого? что?): меняется только мужской род, der → den. die, das и множественное die остаются.',
        en: 'The pronoun is the object: only the masculine changes, der → den. die, das and plural die stay.',
        de: 'Das Pronomen ist das Objekt: Nur maskulin ändert sich, der → den. die, das und Plural die bleiben.',
      },
      example: {
        de: 'Das ist der Film, den wir gestern gesehen haben.',
        tr: { ru: 'Это фильм, который мы вчера смотрели.', en: "That's the film we saw yesterday." },
        noun: 'Film',
        pronoun: 'den',
        verbs: ['gesehen', 'haben'],
      },
      note: {
        ru: 'Подлежащее придаточного стоит после слова: den ich kenne — «которого я знаю». В английском слово можно опустить (the film we saw), в немецком никогда.',
        en: 'The subject of the clause comes after the pronoun: den ich kenne. English can leave the word out (the film we saw); German never does.',
        de: 'Das Subjekt des Relativsatzes steht nach dem Pronomen: den ich kenne. Weglassen kann man das Pronomen nie.',
      },
    },
    {
      id: 'rel-dat',
      case: 'dat',
      rule: {
        ru: 'Дательный падеж (кому?): dem, der, dem, во множественном denen, не den. Так же после mit, bei, von, zu, aus, nach.',
        en: 'Dative: dem, der, dem, and in the plural denen, not den. Also after mit, bei, von, zu, aus, nach.',
        de: 'Dativ: dem, der, dem, im Plural denen, nicht den. Auch nach mit, bei, von, zu, aus, nach.',
      },
      example: {
        de: 'Das ist die Kollegin, mit der ich jeden Tag arbeite.',
        tr: { ru: 'Это коллега, с которой я работаю каждый день.', en: "That's the colleague I work with every day." },
        noun: 'Kollegin',
        pronoun: 'der',
        verbs: ['arbeite'],
      },
      note: {
        ru: 'Множественное число: die Kinder, denen ich helfe — дети, которым я помогаю. Предлог всегда стоит перед словом: die Frau, mit der ich spreche.',
        en: 'Plural: die Kinder, denen ich helfe. The preposition always comes before the pronoun: die Frau, mit der ich spreche.',
        de: 'Plural: die Kinder, denen ich helfe. Die Präposition steht immer vor dem Pronomen: die Frau, mit der ich spreche.',
      },
    },
    {
      id: 'rel-gen',
      case: 'gen',
      rule: {
        ru: '«Чей», «у которого»: dessen для мужского и среднего рода, deren для женского и множественного. Существительное после него идёт без артикля.',
        en: '"Whose": dessen for masculine and neuter nouns, deren for feminine and plural. The noun after it has no article.',
        de: 'dessen nach maskulinen und neutralen Nomen, deren nach femininen und im Plural. Das Nomen danach hat keinen Artikel.',
      },
      example: {
        de: 'Ich habe einen Freund, dessen Schwester in Wien lebt.',
        tr: { ru: 'У меня есть друг, сестра которого живёт в Вене.', en: 'I have a friend whose sister lives in Vienna.' },
        noun: 'Freund',
        pronoun: 'dessen',
        verbs: ['lebt'],
      },
      note: {
        ru: 'dessen или deren выбирают по существительному до него, а не после: der Freund, dessen Schwester… (Freund → dessen, хотя Schwester женского рода).',
        en: 'dessen or deren depends on the noun before it, not the one after: der Freund, dessen Schwester… (Freund → dessen, though Schwester is feminine).',
        de: 'dessen oder deren richtet sich nach dem Nomen davor, nicht danach: der Freund, dessen Schwester… (Freund → dessen, obwohl Schwester feminin ist).',
      },
    },
  ],
  examples: [
    {
      de: 'Die Frau, die dort steht, ist meine Lehrerin.',
      tr: { ru: 'Женщина, которая там стоит, — моя учительница.', en: 'The woman standing over there is my teacher.' },
      noun: 'Frau',
      pronoun: 'die',
      verbs: ['steht'],
    },
    {
      de: 'Wir suchen den Schlüssel, den wir gestern verloren haben.',
      tr: { ru: 'Мы ищем ключ, который вчера потеряли.', en: "We're looking for the key we lost yesterday." },
      noun: 'Schlüssel',
      pronoun: 'den',
      verbs: ['verloren', 'haben'],
    },
    {
      de: 'Das sind die Nachbarn, denen wir oft helfen.',
      tr: { ru: 'Это соседи, которым мы часто помогаем.', en: 'Those are the neighbours we often help.' },
      noun: 'Nachbarn',
      pronoun: 'denen',
      verbs: ['helfen'],
    },
    {
      de: 'Das Haus, in dem wir wohnen, ist sehr alt.',
      tr: { ru: 'Дом, в котором мы живём, очень старый.', en: 'The house we live in is very old.' },
      noun: 'Haus',
      pronoun: 'dem',
      verbs: ['wohnen'],
    },
    {
      de: 'Kennst du die Frau, deren Hund so laut bellt?',
      tr: { ru: 'Ты знаешь женщину, чья собака так громко лает?', en: 'Do you know the woman whose dog barks so loudly?' },
      noun: 'Frau',
      pronoun: 'deren',
      verbs: ['bellt'],
    },
  ],
  exercises: [...relativeNomAkk, ...relativeDatGen],
};
