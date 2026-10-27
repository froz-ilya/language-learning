<script lang="ts">
  import NoteHint from './NoteHint.svelte';
  import Meanings from '../Meanings.svelte';
  import { displayPlural, displayVerbForms, speakableTerm } from '../../lib/german/articles';
  import { settings } from '../../lib/settings.svelte';
  import { speak } from '../../lib/speech/tts';
  import type { StudyItem } from '../../lib/study/session';
  import SpeakButton from '../SpeakButton.svelte';
  import Term from '../Term.svelte';

  /** A new word, shown in full once before it is asked. "Got it" is not graded. */
  let { item, onseen }: { item: StudyItem; onseen: () => void } = $props();

  const card = $derived(item.card);
  const plural = $derived(displayPlural(card));
  const verbForms = $derived(displayVerbForms(card));
  const examples = $derived(card.examples.filter((e) => e.de.trim()).slice(0, 2));

  $effect(() => {
    if (settings.autoplay) speak(speakableTerm(card));
  });

  let done = false;
  function gotIt() {
    if (done) return;
    done = true;
    onseen();
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      gotIt();
    }
  }
</script>

<svelte:window {onkeydown} />

<div class="stack">
  <div class="card intro">
    <div class="tag">New word</div>
    <div class="row center-row">
      <div class="big"><Term {card} /></div>
      <SpeakButton text={speakableTerm(card)} />
    </div>
    {#if card.translation}<div class="translation"><Meanings translation={card.translation} /></div>{/if}
    {#if plural || verbForms}
      <div class="forms">
        {#if plural}<div>Plural: <span lang="de">{plural}</span></div>{/if}
        {#if verbForms}<div lang="de">{verbForms}</div>{/if}
      </div>
    {/if}
    {#if examples.length}
      <div class="examples">
        {#each examples as ex}
          <div class="example">
            <div class="row ex-row">
              <div class="ex-de" lang="de">{ex.de}</div>
              <SpeakButton text={ex.de} size={18} />
            </div>
            {#if ex.tr}<div class="muted small">{ex.tr}</div>{/if}
          </div>
        {/each}
      </div>
    {/if}
    <NoteHint notes={card.notes} />
  </div>

  <button type="button" class="btn btn-primary btn-lg btn-block" onclick={gotIt}>Got it</button>
</div>

<style>
  .intro {
    min-height: 300px;
    border-radius: var(--radius-lg);
    background: var(--grad-feature);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 26px 18px;
    text-align: center;
  }
  .tag {
    font-family: var(--font-display);
    font-size: 12px;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--accent-text);
    background: var(--accent-fill);
    border-radius: 999px;
    padding: 4px 12px;
    box-shadow: var(--shadow-accent);
  }
  .center-row {
    justify-content: center;
  }
  .big {
    font-family: var(--font-display);
    font-size: 34px;
    font-weight: 800;
    line-height: 1.15;
    overflow-wrap: anywhere;
  }
  .translation {
    max-width: 100%;
    font-size: 20px;
    color: var(--text-2);
    overflow-wrap: break-word;
  }
  .translation :global(.meanings) {
    display: inline-flex;
    text-align: left;
  }
  .forms {
    color: var(--muted);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .examples {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 14px;
    margin-top: 6px;
    text-align: left;
    border-top: 1px solid var(--hairline);
    padding-top: 12px;
  }
  .ex-row {
    justify-content: space-between;
  }
  .ex-de {
    font-family: var(--font-read);
    font-size: 17px;
    font-style: italic;
  }
</style>
