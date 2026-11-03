<script lang="ts">
  import Header from '../components/Header.svelte';
  import Icon from '../components/Icon.svelte';
  import { loadSettings, saveSettings, settings } from '../lib/settings.svelte';
  import { germanVoices, iosVoiceNote, isSpeechSupported, speak, voiceLabel, voiceTip } from '../lib/speech/tts';
  import { isAndroid, canVibrate } from '../lib/platform';
  import { install, promptInstall, showIOSInstallHint } from '../lib/install.svelte';
  import { importBackup } from '../lib/db/backup';
  import { lastBackupLabel, runBackup } from '../lib/backupReminder';
  import { providerStatus, resetProviders, type ProviderState } from '../lib/sources/chain';
  import { slide } from 'svelte/transition';
  import { dur } from '../lib/motion';
  import { confirmAction, showToast } from '../lib/ui/dialogs.svelte';
  import { levelIndex } from '../components/library/actions';
  import { i18n, locale, t, tn, tParts } from '../lib/i18n.svelte';
  import type { Direction, Lang, Strictness, ThemeSetting, UiLangSetting } from '../lib/types';

  function set<K extends keyof typeof settings>(key: K, value: (typeof settings)[K]) {
    settings[key] = value;
    void saveSettings();
  }

  // ---------- Voices ----------

  let voices = $state<{ uri: string; label: string }[]>([]);
  /** The voice list has had time to load (event fired or a second passed). */
  let voicesLoaded = $state(false);
  function refreshVoices() {
    voices = germanVoices().map((v) => ({ uri: v.voiceURI, label: voiceLabel(v) }));
  }
  function onVoicesChanged() {
    refreshVoices();
    voicesLoaded = true;
  }
  $effect(() => {
    refreshVoices();
    if (germanVoices().length) voicesLoaded = true;
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    synth?.addEventListener?.('voiceschanged', onVoicesChanged);
    // iOS sometimes fills the list late without firing the event.
    const timer = setTimeout(onVoicesChanged, 1000);
    return () => {
      synth?.removeEventListener?.('voiceschanged', onVoicesChanged);
      clearTimeout(timer);
    };
  });
  const noGermanVoice = $derived(voicesLoaded && !voices.length);
  const rateLabel = $derived(settings.rate.toLocaleString(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const android = isAndroid();

  // ---------- App ----------

  const iosInstallHint = showIOSInstallHint();
  const vibrationSupported = canVibrate();

  async function installApp() {
    const outcome = await promptInstall();
    if (outcome === 'accepted') showToast(t('settings.app.installing'));
  }

  // ---------- Backup ----------

  /** A function, so the message follows the language if it changes while it's on screen. */
  let backupMsg = $state<(() => string) | null>(null);
  let backupErr = $state(false);
  let pendingRestore = $state<{ name: string; text: string } | null>(null);
  let fileInput = $state<HTMLInputElement>();
  let busy = $state(false);

  function report(msg: (() => string) | null, err = false) {
    backupMsg = msg;
    backupErr = err;
  }

  /** Ticks every few seconds so "Last backup" and the Sources list stay fresh. */
  let now = $state(Date.now());
  $effect(() => {
    const id = setInterval(() => (now = Date.now()), 3000);
    return () => clearInterval(id);
  });
  const lastBackup = $derived(lastBackupLabel(settings.lastBackupAt, now));

  async function backupNow() {
    busy = true;
    report(null);
    try {
      // runBackup toasts "Backup saved" / the error itself; a cancelled share sheet changes nothing.
      const result = await runBackup();
      if (result === 'failed') report(() => t('settings.backup.failedRetry'), true);
    } finally {
      busy = false;
    }
  }

  const REMINDER_DAYS = $derived<{ days: number; label: string }[]>([
    { days: 0, label: t('settings.backup.off') },
    { days: 3, label: tn('common.days', 3) },
    { days: 5, label: tn('common.days', 5) },
    { days: 7, label: tn('common.days', 7) },
  ]);

  function setReminder(days: number) {
    settings.backupEvery = days;
    settings.backupSnoozeUntil = 0;
    void saveSettings();
  }

  // ---------- Sources ----------

  let providers = $state<ProviderState[]>([]);
  function refreshProviders() {
    try {
      providers = providerStatus();
    } catch (e) {
      console.warn('providerStatus failed', e);
      providers = [];
    }
  }
  $effect(() => {
    void now; // re-read on every tick while the page is open
    refreshProviders();
  });

  function retryAll() {
    resetProviders();
    refreshProviders();
    showToast(t('settings.sources.retrying'));
  }

  const clock = (ts: number) => new Date(ts).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });

  async function onFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    report(null);
    try {
      pendingRestore = { name: file.name, text: await file.text() };
    } catch (err) {
      const error = (err as Error).message;
      report(() => t('settings.restore.unreadable', { error }), true);
    }
  }

  async function restore(mode: 'replace' | 'merge') {
    if (!pendingRestore) return;
    if (
      mode === 'replace' &&
      !(await confirmAction({
        title: t('settings.restore.confirmTitle'),
        message: t('settings.restore.confirmMessage'),
        confirmLabel: t('settings.restore.replace'),
        destructive: true,
      }))
    )
      return;
    busy = true;
    try {
      const { cards } = await importBackup(pendingRestore.text, mode);
      if (mode === 'replace') await loadSettings();
      report(() => tn(mode === 'replace' ? 'settings.restore.restored' : 'settings.restore.merged', cards));
      showToast(t('settings.restore.done'));
      pendingRestore = null;
    } catch (e) {
      const error = (e as Error).message;
      report(() => t('settings.restore.failed', { error }), true);
    } finally {
      busy = false;
    }
  }

  // ---------- Storage ----------

  let persisted = $state<boolean | null>(null);
  let usageMb = $state<number | null>(null);
  $effect(() => {
    navigator.storage
      ?.persisted?.()
      .then((p) => (persisted = p))
      .catch(() => {});
    navigator.storage
      ?.estimate?.()
      .then((e) => {
        if (e.usage !== undefined) usageMb = e.usage / 1024 / 1024;
      })
      .catch(() => {});
  });
  const usage = $derived(usageMb?.toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }));

  // ---------- About ----------

  // The generated text is English; German and Russian have their own copy in the catalog.
  let generatedSources = $state('');
  levelIndex().then((i) => {
    if (i?.sources) generatedSources = i.sources;
  });
  const sources = $derived((i18n.lang === 'en' && generatedSources) || t('settings.about.sources'));

  const CREDITS = $derived<{ name: string; what: string; license: string }[]>([
    { name: 'MiniKlexikon & Klexikon', what: t('settings.credits.encyclopedia'), license: 'CC BY-SA 4.0' },
    { name: 'Wikinews', what: t('settings.credits.news'), license: 'CC BY 2.5' },
    { name: 'tagesschau', what: t('settings.credits.news'), license: '© ARD' },
    { name: 'Deutsche Welle', what: t('settings.credits.news'), license: '© DW' },
    { name: 'Wikipedia', what: t('settings.credits.articles'), license: 'CC BY-SA 4.0' },
    { name: 'Project Gutenberg', what: t('settings.credits.stories'), license: t('settings.credits.publicDomain') },
    { name: 'Wiktionary via kaikki.org', what: t('settings.sources.local'), license: 'CC BY-SA' },
    { name: 'Goethe-Institut via DWDS', what: t('settings.credits.wordLists'), license: '© Goethe-Institut' },
    { name: 'DAFlex (CEFRLex)', what: t('settings.credits.estimates'), license: 'CC BY-NC-SA 4.0' },
    { name: 'FrequencyWords', what: t('settings.credits.frequency'), license: 'CC BY-SA' },
    { name: 'MyMemory', what: t('settings.credits.fallback'), license: 'Translated.net' },
  ]);

  const THEMES = $derived<{ id: ThemeSetting; label: string }[]>([
    { id: 'auto', label: t('settings.auto') },
    { id: 'light', label: t('settings.appearance.light') },
    { id: 'dark', label: t('settings.appearance.dark') },
  ]);
  // Each language is written in its own language whatever the interface language is.
  const UI_LANGS = $derived<{ id: UiLangSetting; label: string }[]>([
    { id: 'auto', label: t('settings.auto') },
    { id: 'en', label: 'English' },
    { id: 'de', label: 'Deutsch' },
    { id: 'ru', label: 'Русский' },
  ]);
  const NEW_PER_SESSION = [5, 10, 15, 20];
  const NEW_PER_DAY = [10, 20, 30, 50, 0];

  const LANGS = $derived<{ id: Lang; label: string }[]>([
    { id: 'ru', label: t('common.russian') },
    { id: 'en', label: t('common.english') },
  ]);
  const STRICT = $derived<{ id: Strictness; label: string }[]>([
    { id: 'lenient', label: t('settings.checking.lenient') },
    { id: 'strict', label: t('settings.checking.strict') },
  ]);
  const DIRECTIONS = $derived<{ id: Direction; label: string }[]>([
    { id: 'de-x', label: t('settings.direction.fromGerman') },
    { id: 'x-de', label: t('settings.direction.toGerman') },
    { id: 'mixed', label: t('settings.direction.mixed') },
  ]);
</script>

<div class="page">
  <Header title={t('settings.title')} backTo="/" />

  <section class="section">
    <h2 class="section-title">{t('settings.appearance.title')}</h2>
    <div class="segmented" role="radiogroup" aria-label={t('settings.appearance.theme')}>
      {#each THEMES as theme}
        <button role="radio" aria-checked={settings.theme === theme.id} class:active={settings.theme === theme.id} onclick={() => set('theme', theme.id)}>{theme.label}</button>
      {/each}
    </div>
    <p class="hint small muted">{t('settings.appearance.hint')}</p>
  </section>

  <section class="section">
    <h2 class="section-title">{t('settings.language.title')}</h2>
    <div class="segmented" role="radiogroup" aria-label={t('settings.language.title')}>
      {#each UI_LANGS as l}
        <button role="radio" aria-checked={settings.uiLang === l.id} class:active={settings.uiLang === l.id} onclick={() => set('uiLang', l.id)}>{l.label}</button>
      {/each}
    </div>
    <p class="hint small muted">{t('settings.language.hint')}</p>
  </section>

  <section class="section">
    <h2 class="section-title">{t('settings.learning.title')}</h2>
    <div class="list">
      <div class="list-item column">
        <div class="row full">
          <span class="grow">{t('settings.learning.newPerSession')}</span>
          <span class="muted">{settings.newPerSession}</span>
        </div>
        <div class="segmented full" role="radiogroup" aria-label={t('settings.learning.newPerSession')}>
          {#each NEW_PER_SESSION as n}
            <button role="radio" aria-checked={settings.newPerSession === n} class:active={settings.newPerSession === n} onclick={() => set('newPerSession', n)}>{n}</button>
          {/each}
        </div>
      </div>
      <div class="list-item column">
        <div class="row full">
          <span class="grow">{t('settings.learning.newPerDay')}</span>
          <span class="muted">{settings.newPerDay || t('settings.learning.noLimit')}</span>
        </div>
        <div class="segmented full" role="radiogroup" aria-label={t('settings.learning.newPerDay')}>
          {#each NEW_PER_DAY as n}
            <button role="radio" aria-checked={settings.newPerDay === n} aria-label={n ? undefined : t('settings.learning.noLimit')} class:active={settings.newPerDay === n} onclick={() => set('newPerDay', n)}>{n || '∞'}</button>
          {/each}
        </div>
      </div>
    </div>
    <p class="hint small muted">{t('settings.learning.hint')}</p>
  </section>

  <section class="section">
    <h2 class="section-title">{t('settings.translations.title')}</h2>
    <div class="segmented">
      {#each LANGS as l}
        <button class:active={settings.lang === l.id} onclick={() => set('lang', l.id)}>{l.label}</button>
      {/each}
    </div>
    <p class="hint small muted">{t('settings.translations.hint')}</p>
  </section>

  <section class="section">
    <h2 class="section-title">{t('settings.voice.title')}</h2>
    {#if !isSpeechSupported()}
      <div class="card small muted">{t('settings.voice.unsupported')}</div>
    {:else}
      <div class="list">
        <div class="list-item">
          <label for="voice" class="grow">{t('settings.voice.voice')}</label>
          <select id="voice" class="select" value={settings.voiceURI} onchange={(e) => set('voiceURI', e.currentTarget.value)}>
            <option value="" selected={!settings.voiceURI}>{t('settings.voice.default')}</option>
            {#each voices as v (v.uri)}
              <option value={v.uri} selected={v.uri === settings.voiceURI}>{v.label}</option>
            {/each}
          </select>
        </div>
        <div class="list-item column">
          <div class="row full">
            <label for="rate" class="grow">{t('settings.voice.rate')}</label>
            <span class="muted">{rateLabel}×</span>
          </div>
          <input
            id="rate"
            class="range"
            type="range"
            min="0.5"
            max="1.2"
            step="0.05"
            value={settings.rate}
            oninput={(e) => (settings.rate = Number(e.currentTarget.value))}
            onchange={() => void saveSettings()}
          />
        </div>
        <label class="list-item">
          <span class="grow">{t('settings.voice.autoplay')}</span>
          <input type="checkbox" class="switch" checked={settings.autoplay} onchange={(e) => set('autoplay', e.currentTarget.checked)} />
        </label>
        <button class="list-item test" onclick={() => speak('Guten Morgen! Wie geht es dir?')}>
          <Icon name="speaker" /> {t('settings.voice.test')}
        </button>
      </div>
      {#if noGermanVoice}
        <div class="card small voice-tip">{voiceTip()}</div>
      {:else if !android}
        <p class="hint small muted">{iosVoiceNote()}</p>
      {/if}
    {/if}
  </section>

  <section class="section">
    <h2 class="section-title">{t('settings.checking.title')}</h2>
    <div class="segmented">
      {#each STRICT as s}
        <button class:active={settings.strictness === s.id} onclick={() => set('strictness', s.id)}>{s.label}</button>
      {/each}
    </div>
    <p class="hint small muted">
      {settings.strictness === 'lenient' ? t('settings.checking.lenientHint') : t('settings.checking.strictHint')}
    </p>
    <div class="list">
      <label class="list-item">
        <span class="grow">{t('settings.checking.requireArticle')}</span>
        <input type="checkbox" class="switch" checked={settings.requireArticle} onchange={(e) => set('requireArticle', e.currentTarget.checked)} />
      </label>
      {#if vibrationSupported}
        <label class="list-item">
          <span class="grow">{t('settings.checking.vibration')}</span>
          <input type="checkbox" class="switch" checked={settings.vibration} onchange={(e) => set('vibration', e.currentTarget.checked)} />
        </label>
      {/if}
    </div>
  </section>

  {#if install.canInstall || iosInstallHint}
    <section class="section">
      <h2 class="section-title">{t('settings.app.title')}</h2>
      <div class="list">
        {#if install.canInstall}
          <button class="list-item" onclick={installApp}>
            <span class="accent"><Icon name="import" /></span>
            <span class="grow">{t('settings.app.install')}</span>
            <span class="muted small">{t('settings.app.worksOffline')}</span>
          </button>
        {:else}
          <div class="list-item static">
            <span class="accent"><Icon name="import" /></span>
            <span class="grow">{t('settings.app.iosHint')}</span>
          </div>
        {/if}
      </div>
    </section>
  {/if}

  <section class="section">
    <h2 class="section-title">{t('settings.direction.title')}</h2>
    <div class="segmented">
      {#each DIRECTIONS as d}
        <button class:active={settings.direction === d.id} onclick={() => set('direction', d.id)}>{d.label}</button>
      {/each}
    </div>
  </section>

  <section class="section">
    <h2 class="section-title">{t('settings.backup.title')}</h2>
    <div class="list">
      <button class="list-item" disabled={busy} onclick={backupNow}>
        <span class="accent"><Icon name="import" /></span>
        <span class="grow">{t('settings.backup.now')}</span>
        <span class="muted small">{t('settings.backup.last', { when: lastBackup })}</span>
      </button>
      <button class="list-item" disabled={busy} onclick={() => fileInput?.click()}>
        <span class="accent"><Icon name="refresh" /></span>
        <span class="grow">{t('settings.restore.action')}</span>
      </button>
      <div class="list-item column">
        <div class="row full">
          <span class="grow">{t('settings.backup.reminder')}</span>
          <span class="muted">{settings.backupEvery ? t('settings.backup.every', { n: settings.backupEvery }) : t('settings.backup.off')}</span>
        </div>
        <div class="segmented full" role="radiogroup" aria-label={t('settings.backup.reminder')}>
          {#each REMINDER_DAYS as r}
            <button role="radio" aria-checked={settings.backupEvery === r.days} class:active={settings.backupEvery === r.days} onclick={() => setReminder(r.days)}>{r.label}</button>
          {/each}
        </div>
      </div>
    </div>
    <p class="hint small muted">{t('settings.backup.hint')}</p>
    <input bind:this={fileInput} type="file" accept=".json,application/json" hidden onchange={onFile} />

    {#if pendingRestore}
      <div class="card restore stack" transition:slide={{ duration: dur(220) }}>
        <div class="small">{#each tParts('settings.restore.file') as p}{#if p.slot}<strong>{pendingRestore.name}</strong>{:else}{p.text}{/if}{/each}</div>
        <button class="btn btn-block" disabled={busy} onclick={() => restore('merge')}>{t('settings.restore.merge')}</button>
        <button class="btn btn-block replace" disabled={busy} onclick={() => restore('replace')}>{t('settings.restore.replace')}</button>
        <button class="btn btn-ghost btn-block" disabled={busy} onclick={() => (pendingRestore = null)}>{t('common.cancel')}</button>
      </div>
    {/if}
    {#if backupMsg}<p class="hint small" class:bad={backupErr} class:good={!backupErr}>{backupMsg()}</p>{/if}
  </section>

  <section class="section">
    <h2 class="section-title">{t('settings.sources.title')}</h2>
    {#if providers.length}
      <div class="list">
        {#each providers as p (p.id)}
          <div class="list-item source">
            <div class="source-text">
              <span>{p.label}</span>
              {#if p.lastError}<span class="source-error">{p.lastError}</span>{/if}
            </div>
            {#if p.state === 'cooling'}
              <span class="pill pill-warn">{p.until ? t('settings.sources.pausedUntil', { time: clock(p.until) }) : t('settings.sources.paused')}</span>
            {:else}
              <span class="pill pill-good">{t('settings.sources.working')}</span>
            {/if}
          </div>
        {/each}
        <button class="list-item test" onclick={retryAll}>
          <Icon name="refresh" /> {t('settings.sources.retryAll')}
        </button>
      </div>
    {:else}
      <div class="card small muted">{t('settings.sources.none')}</div>
    {/if}
    <p class="hint small muted">{t('settings.sources.hint')}</p>
  </section>

  <section class="section">
    <h2 class="section-title">{t('settings.storage.title')}</h2>
    <div class="card small stack-sm">
      <div>{usage ? t('settings.storage.usage', { mb: usage }) : t('settings.storage.device')}</div>
      <div class="muted">
        {#if persisted === true}
          {t('settings.storage.protected')}
        {:else if persisted === false}
          {t('settings.storage.notProtected')}
        {:else}
          {t('settings.storage.unknown')}
        {/if}
      </div>
    </div>
  </section>

  <section class="section">
    <h2 class="section-title">{t('settings.about.title')}</h2>
    <div class="card small stack-sm beta-note">
      <div><span class="beta-tag">{t('settings.about.beta')}</span> {t('settings.about.betaNote')}</div>
      <div class="muted">{t('settings.about.deviceOnly')}</div>
    </div>
    <div class="card small muted stack-sm">
      <div>{sources}</div>
      <div>{t('settings.about.levels')}</div>
    </div>
    <div class="list credits">
      {#each CREDITS as c}
        <div class="list-item credit">
          <span class="credit-name">{c.name}</span>
          <span class="credit-what small muted">{c.what} · {c.license}</span>
        </div>
      {/each}
    </div>
  </section>
</div>

<style>
  .beta-note {
    margin-bottom: 10px;
  }
  .hint {
    margin: 8px 4px 12px;
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .select {
    max-width: 60%;
    border: 0;
    background: transparent;
    color: var(--muted);
    text-align: right;
    text-overflow: ellipsis;
    outline: none;
  }
  .column {
    flex-direction: column;
    align-items: stretch;
    cursor: default;
  }
  .column:active {
    background: none;
  }
  .full {
    width: 100%;
  }
  .range {
    width: 100%;
    accent-color: var(--accent);
  }
  .switch {
    width: 26px;
    height: 26px;
    accent-color: var(--accent);
    flex-shrink: 0;
  }
  .test {
    color: var(--accent);
    font-weight: 500;
  }
  .accent {
    color: var(--accent);
    display: inline-flex;
  }
  .restore {
    margin-top: 12px;
  }
  .replace {
    color: var(--bad);
  }
  .source {
    cursor: default;
    gap: 12px;
  }
  .source:active {
    background: none;
  }
  .source-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .source-error {
    font-size: 12px;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pill {
    flex-shrink: 0;
    padding: 3px 10px;
    border-radius: 999px;
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
  }
  .pill-good {
    color: var(--good);
    background: color-mix(in srgb, var(--good) 14%, transparent);
  }
  .pill-warn {
    color: var(--warn);
    background: color-mix(in srgb, var(--warn) 16%, transparent);
  }
  .credits {
    margin-top: 12px;
  }
  .credit {
    flex-direction: column;
    align-items: flex-start;
    gap: 0;
    cursor: default;
  }
  .credit:active {
    background: none;
  }
  .credit-name {
    font-weight: 500;
  }
  .stack-sm {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .voice-tip {
    margin-top: 12px;
    color: var(--muted);
  }
  .static {
    cursor: default;
  }
  .static:active {
    background: none;
  }
</style>
