<script lang="ts">
  import NoteHint from './NoteHint.svelte';
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
    {#if card.translation}<div class="translation">{card.translation}</div>{/if}
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
    min-height: 280px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 24px 16px;
    text-align: center;
  }
  .tag {
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    border-radius: 999px;
    padding: 3px 10px;
  }
  .center-row {
    justify-content: center;
  }
  .big {
    font-size: 30px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .translation {
    font-size: 21px;
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
    gap: 8px;
    margin-top: 6px;
    text-align: left;
    border-top: 1px solid var(--border);
    padding-top: 10px;
  }
  .ex-row {
    justify-content: space-between;
  }
  .ex-de {
    font-style: italic;
  }
</style>
