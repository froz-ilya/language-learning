import { resolveUiLang, setUiLang } from './i18n.svelte';
import { settings } from './settings.svelte';

function apply() {
  const lang = resolveUiLang(settings.uiLang, navigator.language);
  setUiLang(lang);
  document.documentElement.lang = lang;
}

/** Apply now, and again whenever the setting or the phone's language changes. */
export function initLanguage(): void {
  if (typeof document === 'undefined') return;
  $effect.root(() => {
    $effect(apply);
  });
  window.addEventListener('languagechange', apply);
}
