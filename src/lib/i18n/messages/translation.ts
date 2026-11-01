/** The German half of a catalog file: the same keys as the English one, none missing or extra. */
export type Translation<T> = { [K in keyof T]: string };
