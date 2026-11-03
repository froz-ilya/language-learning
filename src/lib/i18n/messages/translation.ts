/** The German half of a catalog file: the same keys as the English one, none missing or extra. */
export type Translation<T> = { [K in keyof T]: string };

type PluralBase<K> = K extends `${infer B}.other` ? B : never;

/**
 * The Russian half: the English keys, plus `.few` and `.many` for every plural message, since
 * Russian has more plural forms (1 слово, 2 слова, 5 слов). `.other` is for fractions.
 */
export type RuTranslation<T> = Translation<T> & { [K in `${PluralBase<keyof T & string>}.${'few' | 'many'}`]: string };
