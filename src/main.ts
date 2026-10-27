import { mount } from 'svelte';
import { registerSW } from 'virtual:pwa-register';
import './styles/app.css';
import App from './App.svelte';
import { loadSettings } from './lib/settings.svelte';
import { initTheme } from './lib/theme.svelte';
import { requestPersistence } from './lib/db/schema';
import { replace } from './lib/router.svelte';
import { extractSharedTerm, isShareLaunch } from './lib/share';
import './lib/install.svelte'; // listen for beforeinstallprompt from the start

registerSW({ immediate: true });
void requestPersistence();

/** Android "Share to Deutsch" opens `<base>?text=…`: drop the query, then add the word. */
function takeSharedText() {
  const params = new URLSearchParams(location.search);
  if (!isShareLaunch(params)) return;
  const term = extractSharedTerm(params);
  history.replaceState(history.state, '', location.pathname + location.hash);
  if (term) replace(`/share?${new URLSearchParams({ term })}`);
}

loadSettings().finally(() => {
  initTheme();
  takeSharedText();
  mount(App, { target: document.getElementById('app')! });
});
