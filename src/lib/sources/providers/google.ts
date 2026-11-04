import { googleTranslate, type GoogleLang, type GoogleResult } from '../../lookup/google';
import type { Provider } from '../chain';

export interface TextQuery {
  text: string;
  from: GoogleLang;
  to: GoogleLang;
  /** Also ask for definitions and examples (see GoogleOptions.extras). */
  extras?: boolean;
}

/** Google Translate (free gtx endpoint): text plus dictionary alternatives for single words. */
export const googleText: Provider<TextQuery, GoogleResult> = {
  id: 'google',
  run: ({ text, from, to, extras }, signal) => googleTranslate(text, from, to, signal, { extras }),
};

/**
 * The same endpoint as Google's browser extension calls it (client=dict-chrome-ex): the same
 * answer as googleText, with a rate limit of its own, so it still answers when gtx is at 429.
 */
export const googleDictText: Provider<TextQuery, GoogleResult> = {
  id: 'google.dict',
  run: ({ text, from, to, extras }, signal) => googleTranslate(text, from, to, signal, { client: 'dict-chrome-ex', extras }),
};
