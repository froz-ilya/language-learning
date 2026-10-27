<script lang="ts">
  import Header from '../components/Header.svelte';
  import Icon from '../components/Icon.svelte';
  import { loadSettings, saveSettings, settings } from '../lib/settings.svelte';
  import { IOS_VOICE_NOTE, germanVoices, isSpeechSupported, speak, voiceLabel, voiceTip } from '../lib/speech/tts';
  import { isAndroid, canVibrate } from '../lib/platform';
  import { install, promptInstall, showIOSInstallHint } from '../lib/install.svelte';
  import { importBackup } from '../lib/db/backup';
  import { lastBackupLabel, runBackup } from '../lib/backupReminder';
  import { providerStatus, resetProviders, type ProviderState } from '../lib/sources/chain';
  import { slide } from 'svelte/transition';
  import { dur } from '../lib/motion';
  import { confirmAction, showToast } from '../lib/ui/dialogs.svelte';
  import { levelIndex } from '../components/library/actions';
  import type { Direction, Lang, Strictness, ThemeSetting } from '../lib/types';

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
    const t = setTimeout(onVoicesChanged, 1000);
    return () => {
      synth?.removeEventListener?.('voiceschanged', onVoicesChanged);
      clearTimeout(t);
    };
  });
  const noGermanVoice = $derived(voicesLoaded && !voices.length);
  const android = isAndroid();

  // ---------- App ----------

  const iosInstallHint = showIOSInstallHint();
  const vibrationSupported = canVibrate();

  async function installApp() {
    const outcome = await promptInstall();
    if (outcome === 'accepted') showToast('Installing Deutsch…');
  }

  // ---------- Backup ----------

  let backupMsg = $state('');
  let backupErr = $state(false);
  let pendingRestore = $state<{ name: string; text: string } | null>(null);
  let fileInput = $state<HTMLInputElement>();
  let busy = $state(false);

  function report(msg: string, err = false) {
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
    report('');
    try {
      // runBackup toasts "Backup saved" / the error itself; a cancelled share sheet changes nothing.
      const result = await runBackup();
      if (result === 'failed') report('Backup failed. Please try again.', true);
    } finally {
      busy = false;
    }
  }

  const REMINDER_DAYS: { days: number; label: string }[] = [
    { days: 0, label: 'Off' },
    { days: 3, label: '3 days' },
    { days: 5, label: '5 days' },
    { days: 7, label: '7 days' },
  ];

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
    showToast('All sources will be tried again');
  }

  const clock = (ts: number) => new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  async function onFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    report('');
    try {
      pendingRestore = { name: file.name, text: await file.text() };
    } catch (err) {
      report(`Couldn't read the file: ${(err as Error).message}`, true);
    }
  }

  async function restore(mode: 'replace' | 'merge') {
    if (!pendingRestore) return;
    if (
      mode === 'replace' &&
      !(await confirmAction({
        title: 'Replace everything?',
        message: 'All current folders, sets, words and progress are replaced with the backup.',
        confirmLabel: 'Replace all',
        destructive: true,
      }))
    )
      return;
    busy = true;
    try {
      const { cards } = await importBackup(pendingRestore.text, mode);
      if (mode === 'replace') await loadSettings();
      report(`${mode === 'replace' ? 'Restored' : 'Merged'} ${cards} ${cards === 1 ? 'word' : 'words'}.`);
      showToast('Backup restored');
      pendingRestore = null;
    } catch (e) {
      report(`Restore failed: ${(e as Error).message}`, true);
    } finally {
      busy = false;
    }
  }

  // ---------- Storage ----------

  let persisted = $state<boolean | null>(null);
  let usage = $state('');
  $effect(() => {
    navigator.storage
      ?.persisted?.()
      .then((p) => (persisted = p))
      .catch(() => {});
    navigator.storage
      ?.estimate?.()
      .then((e) => {
        if (e.usage !== undefined) usage = `${(e.usage / 1024 / 1024).toFixed(1)} MB used`;
      })
      .catch(() => {});
  });

  // ---------- About ----------

  const FALLBACK_SOURCES =
    'Word frequency: FrequencyWords (OpenSubtitles, CC BY-SA) · Dictionary: Wiktionary (CC BY-SA) · Translations: Google Translate';
  let sources = $state(FALLBACK_SOURCES);
  levelIndex().then((i) => {
    if (i?.sources) sources = i.sources;
  });

  const CREDITS: { name: string; what: string; license: string }[] = [
    { name: 'MiniKlexikon & Klexikon', what: 'Reading: children’s encyclopedia', license: 'CC BY-SA 4.0' },
    { name: 'Wikinews', what: 'Reading: news', license: 'CC BY 2.5' },
    { name: 'Wikipedia', what: 'Reading: articles', license: 'CC BY-SA 4.0' },
    { name: 'Project Gutenberg', what: 'Reading: classic stories', license: 'Public domain' },
    { name: 'Wiktionary via kaikki.org', what: 'Offline dictionary', license: 'CC BY-SA' },
    { name: 'FrequencyWords', what: 'Word frequency', license: 'CC BY-SA' },
    { name: 'MyMemory', what: 'Translations (fallback)', license: 'Translated.net' },
  ];

  const THEMES: { id: ThemeSetting; label: string }[] = [
    { id: 'auto', label: 'Auto' },
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' },
  ];
  const NEW_PER_SESSION = [5, 10, 15, 20];

  const LANGS: { id: Lang; label: string }[] = [
    { id: 'ru', label: 'Russian' },
    { id: 'en', label: 'English' },
  ];
  const STRICT: { id: Strictness; label: string }[] = [
    { id: 'lenient', label: 'Lenient' },
    { id: 'strict', label: 'Strict' },
  ];
  const DIRECTIONS: { id: Direction; label: string }[] = [
    { id: 'de-x', label: 'German →' },
    { id: 'x-de', label: '→ German' },
    { id: 'mixed', label: 'Mixed' },
  ];
</script>

<div class="page">
  <Header title="Settings" />

  <section class="section">
    <h2 class="section-title">Appearance</h2>
    <div class="segmented" role="radiogroup" aria-label="Theme">
      {#each THEMES as t}
        <button role="radio" aria-checked={settings.theme === t.id} class:active={settings.theme === t.id} onclick={() => set('theme', t.id)}>{t.label}</button>
      {/each}
    </div>
    <p class="hint small muted">Auto follows your phone’s light or dark mode.</p>
  </section>

  <section class="section">
    <h2 class="section-title">Learning</h2>
    <div class="list">
      <div class="list-item column">
        <div class="row full">
          <span class="grow">New words per session</span>
          <span class="muted">{settings.newPerSession}</span>
        </div>
        <div class="segmented full" role="radiogroup" aria-label="New words per session">
          {#each NEW_PER_SESSION as n}
            <button role="radio" aria-checked={settings.newPerSession === n} class:active={settings.newPerSession === n} onclick={() => set('newPerSession', n)}>{n}</button>
          {/each}
        </div>
      </div>
    </div>
    <p class="hint small muted">How many never-seen words a session mixes in with your reviews. Fewer = calmer, more = faster.</p>
  </section>

  <section class="section">
    <h2 class="section-title">Translations</h2>
    <div class="segmented">
      {#each LANGS as l}
        <button class:active={settings.lang === l.id} onclick={() => set('lang', l.id)}>{l.label}</button>
      {/each}
    </div>
    <p class="hint small muted">Language for new translations and dictionary look-ups.</p>
  </section>

  <section class="section">
    <h2 class="section-title">Pronunciation</h2>
    {#if !isSpeechSupported()}
      <div class="card small muted">Speech isn't supported in this browser.</div>
    {:else}
      <div class="list">
        <div class="list-item">
          <label for="voice" class="grow">Voice</label>
          <select id="voice" class="select" value={settings.voiceURI} onchange={(e) => set('voiceURI', e.currentTarget.value)}>
            <option value="" selected={!settings.voiceURI}>Default</option>
            {#each voices as v (v.uri)}
              <option value={v.uri} selected={v.uri === settings.voiceURI}>{v.label}</option>
            {/each}
          </select>
        </div>
        <div class="list-item column">
          <div class="row full">
            <label for="rate" class="grow">Speech rate</label>
            <span class="muted">{settings.rate.toFixed(2)}×</span>
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
          <span class="grow">Autoplay pronunciation</span>
          <input type="checkbox" class="switch" checked={settings.autoplay} onchange={(e) => set('autoplay', e.currentTarget.checked)} />
        </label>
        <button class="list-item test" onclick={() => speak('Guten Morgen! Wie geht es dir?')}>
          <Icon name="speaker" /> Test voice
        </button>
      </div>
      {#if noGermanVoice}
        <div class="card small voice-tip">{voiceTip()}</div>
      {:else if !android}
        <p class="hint small muted">{IOS_VOICE_NOTE}</p>
      {/if}
    {/if}
  </section>

  <section class="section">
    <h2 class="section-title">Answer checking</h2>
    <div class="segmented">
      {#each STRICT as s}
        <button class:active={settings.strictness === s.id} onclick={() => set('strictness', s.id)}>{s.label}</button>
      {/each}
    </div>
    <p class="hint small muted">
      {settings.strictness === 'lenient' ? 'Small typos count as correct.' : 'Answers must be spelled exactly.'}
    </p>
    <div class="list">
      <label class="list-item">
        <span class="grow">Require article for nouns</span>
        <input type="checkbox" class="switch" checked={settings.requireArticle} onchange={(e) => set('requireArticle', e.currentTarget.checked)} />
      </label>
      {#if vibrationSupported}
        <label class="list-item">
          <span class="grow">Vibration on answers</span>
          <input type="checkbox" class="switch" checked={settings.vibration} onchange={(e) => set('vibration', e.currentTarget.checked)} />
        </label>
      {/if}
    </div>
  </section>

  {#if install.canInstall || iosInstallHint}
    <section class="section">
      <h2 class="section-title">App</h2>
      <div class="list">
        {#if install.canInstall}
          <button class="list-item" onclick={installApp}>
            <span class="accent"><Icon name="import" /></span>
            <span class="grow">Install app</span>
            <span class="muted small">Works offline</span>
          </button>
        {:else}
          <div class="list-item static">
            <span class="accent"><Icon name="import" /></span>
            <span class="grow">Install: Share → Add to Home Screen</span>
          </div>
        {/if}
      </div>
    </section>
  {/if}

  <section class="section">
    <h2 class="section-title">Default study direction</h2>
    <div class="segmented">
      {#each DIRECTIONS as d}
        <button class:active={settings.direction === d.id} onclick={() => set('direction', d.id)}>{d.label}</button>
      {/each}
    </div>
  </section>

  <section class="section">
    <h2 class="section-title">Backup</h2>
    <div class="list">
      <button class="list-item" disabled={busy} onclick={backupNow}>
        <span class="accent"><Icon name="import" /></span>
        <span class="grow">Back up now</span>
        <span class="muted small">Last backup: {lastBackup}</span>
      </button>
      <button class="list-item" disabled={busy} onclick={() => fileInput?.click()}>
        <span class="accent"><Icon name="refresh" /></span>
        <span class="grow">Restore from backup</span>
      </button>
      <div class="list-item column">
        <div class="row full">
          <span class="grow">Backup reminder</span>
          <span class="muted">{settings.backupEvery ? `Every ${settings.backupEvery} days` : 'Off'}</span>
        </div>
        <div class="segmented full" role="radiogroup" aria-label="Backup reminder">
          {#each REMINDER_DAYS as r}
            <button role="radio" aria-checked={settings.backupEvery === r.days} class:active={settings.backupEvery === r.days} onclick={() => setReminder(r.days)}>{r.label}</button>
          {/each}
        </div>
      </div>
    </div>
    <p class="hint small muted">Save the backup file to iCloud Drive or Files. The app reminds you when the last backup gets old.</p>
    <input bind:this={fileInput} type="file" accept=".json,application/json" hidden onchange={onFile} />

    {#if pendingRestore}
      <div class="card restore stack" transition:slide={{ duration: dur(220) }}>
        <div class="small">Restore <strong>{pendingRestore.name}</strong>:</div>
        <button class="btn btn-block" disabled={busy} onclick={() => restore('merge')}>Merge with current data</button>
        <button class="btn btn-block replace" disabled={busy} onclick={() => restore('replace')}>Replace all</button>
        <button class="btn btn-ghost btn-block" disabled={busy} onclick={() => (pendingRestore = null)}>Cancel</button>
      </div>
    {/if}
    {#if backupMsg}<p class="hint small" class:bad={backupErr} class:good={!backupErr}>{backupMsg}</p>{/if}
  </section>

  <section class="section">
    <h2 class="section-title">Sources</h2>
    {#if providers.length}
      <div class="list">
        {#each providers as p (p.id)}
          <div class="list-item source">
            <div class="source-text">
              <span>{p.label}</span>
              {#if p.lastError}<span class="source-error">{p.lastError}</span>{/if}
            </div>
            {#if p.state === 'cooling'}
              <span class="pill pill-warn">{p.until ? `Paused until ${clock(p.until)}` : 'Paused'}</span>
            {:else}
              <span class="pill pill-good">Working</span>
            {/if}
          </div>
        {/each}
        <button class="list-item test" onclick={retryAll}>
          <Icon name="refresh" /> Retry all
        </button>
      </div>
    {:else}
      <div class="card small muted">No online sources used yet.</div>
    {/if}
    <p class="hint small muted">
      Dictionary, translation and reading sources. When one fails or is busy, the app automatically tries the next one and
      pauses the failing source for a while.
    </p>
  </section>

  <section class="section">
    <h2 class="section-title">Storage</h2>
    <div class="card small stack-sm">
      <div>Stored on this device{usage ? ` · ${usage}` : ''}.</div>
      <div class="muted">
        {#if persisted === true}
          Protected from automatic clean-up.
        {:else if persisted === false}
          Not protected — iOS may clear it if storage runs low. Export a backup now and then.
        {:else}
          Export a backup now and then to keep your words safe.
        {/if}
      </div>
    </div>
  </section>

  <section class="section">
    <h2 class="section-title">About</h2>
    <div class="card small stack-sm beta-note">
      <div><span class="beta-tag">Beta</span> Deutsch is still in beta, so some things may not work yet.</div>
      <div class="muted">Your words live only on this device: export a backup now and then.</div>
    </div>
    <div class="card small muted stack-sm">
      <div>{sources}</div>
      <div>Levels are approximate, based on word frequency.</div>
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
