import { googleTranslate, type GoogleLang, type GoogleResult } from '../../lookup/google';
import type { Provider } from '../chain';

export interface TextQuery {
  text: string;
  from: GoogleLang;
  to: GoogleLang;
}

/** Google Translate (free gtx endpoint): text plus dictionary alternatives for single words. */
export const googleText: Provider<TextQuery, GoogleResult> = {
  id: 'google',
  run: ({ text, from, to }, signal) => googleTranslate(text, from, to, signal),
};
