<script lang="ts">
  import Header from '../components/Header.svelte';
  import { replace } from '../lib/router.svelte';
  import { createPasted, articlePath } from '../lib/reading/store';
  import { countWords } from '../lib/reading/text';
  import { showToast } from '../lib/ui/dialogs.svelte';

  const MAX_WORDS = 5000;
  const canReadClipboard = typeof navigator !== 'undefined' && typeof navigator.clipboard?.readText === 'function';

  let title = $state('');
  let text = $state('');
  let busy = $state(false);

  const words = $derived(countWords(text));
  const tooLong = $derived(words > MAX_WORDS);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!words || tooLong || busy) return;
    busy = true;
    try {
      const id = await createPasted(title, text);
      // Replace this page so "back" from the reader returns to the Read tab.
      replace(articlePath(id));
    } catch (err) {
      showToast(`Couldn’t save the text: ${(err as Error).message}`);
      busy = false;
    }
  }

  async function pasteFromClipboard() {
    try {
      const clip = await navigator.clipboard.readText();
      if (clip.trim()) text = text.trim() ? `${text.trim()}\n\n${clip}` : clip;
    } catch {
      showToast('Long-press the text box and choose Paste');
    }
  }
</script>

<div class="page">
  <Header title="Your text" backTo="/read" />

  <form class="stack" onsubmit={submit}>
    <div class="field">
      <label for="paste-title">Title</label>
      <input id="paste-title" class="input" bind:value={title} placeholder="Optional, e.g. “Brief von Oma”" maxlength="120" autocomplete="off" />
    </div>
    <div class="field">
      <div class="label-row">
        <label for="paste-text">German text</label>
        {#if canReadClipboard}
          <button type="button" class="btn-link" onclick={pasteFromClipboard}>Paste</button>
        {/if}
      </div>
      <textarea
        id="paste-text"
        class="input text"
        bind:value={text}
        placeholder="Paste or type German text here. Blank lines start a new paragraph."
        lang="de"
        spellcheck="false"
      ></textarea>
      <div class="count small" class:bad={tooLong}>
        {words.toLocaleString()} {words === 1 ? 'word' : 'words'}{tooLong ? ` · at most ${MAX_WORDS.toLocaleString()}` : ''}
      </div>
    </div>
    <button class="btn btn-primary btn-lg btn-block" type="submit" disabled={!words || tooLong || busy}>Read</button>
    <p class="muted small hint">The text stays on this device. Tap any word in the reader to see its translation and add it to a word set.</p>
  </form>
</div>

<style>
  .label-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .label-row label {
    font-size: 13px;
    font-weight: 600;
    color: var(--muted);
    margin-left: 4px;
  }
  .btn-link {
    border: 0;
    background: none;
    color: var(--accent);
    font-weight: 600;
    font-size: 15px;
    padding: 4px 6px;
    cursor: pointer;
  }
  textarea.text {
    min-height: 45vh;
    min-height: 45dvh;
    line-height: 1.5;
  }
  .count {
    text-align: right;
    color: var(--muted);
    margin-right: 4px;
  }
  .count.bad {
    color: var(--bad);
  }
  .hint {
    margin: 0 4px;
  }
</style>
