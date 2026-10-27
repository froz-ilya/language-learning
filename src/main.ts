import { mount } from 'svelte';
import { registerSW } from 'virtual:pwa-register';
import './styles/app.css';
import App from './App.svelte';
import { loadSettings } from './lib/settings.svelte';
import { requestPersistence } from './lib/db/schema';

registerSW({ immediate: true });
void requestPersistence();

loadSettings().finally(() => {
  mount(App, { target: document.getElementById('app')! });
});
