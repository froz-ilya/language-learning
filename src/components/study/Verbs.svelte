<script lang="ts">
  import { checkForm } from '../../lib/german/answer';
  import { displayVerbForms } from '../../lib/german/articles';
  import { settings } from '../../lib/settings.svelte';
  import { speak } from '../../lib/speech/tts';
  import { gradeForResult } from '../../lib/srs/fsrs';
  import { feedbackFx, slideIn } from '../../lib/study/fx';
  import type { ModeProps } from '../../lib/study/modes';
  import type { Auxiliary } from '../../lib/types';
  import SpeakButton from '../SpeakButton.svelte';
  import UmlautBar from '../UmlautBar.svelte';
  import ResultIcon from './ResultIcon.svelte';

  /**
   * Verb forms: Präteritum, Partizip II and haben/sein. Fields the card has empty are skipped.
   * Stays mounted across questions (resets on item.seq) to keep the iOS keyboard open.
   */
  let { item, onanswer, onnext }: ModeProps = $props();

  const card = $derived(item.card);
  const askPrae = $derived(!!card.praeteritum.trim());
  const askP2 = $derived(!!card.partizip2.trim());
  const askAux = $derived(!!card.auxiliary);

  let prae = $state('');
  let p2 = $state('');
  let aux = $state<Auxiliary>('');
  let checked = $state<{ prae: boolean; p2: boolean; aux: boolean; all: boolean } | null>(null);

  let praeInput = $state<HTMLInputElement>();
  let p2Input = $state<HTMLInputElement>();
  let active = $state<HTMLInputElement>();

  let shownSeq = -1;
  $effect.pre(() => {
    if (item.seq !== shownSeq) {
      shownSeq = item.seq;
      prae = '';
      p2 = '';
      aux = '';
      checked = null;
      active = undefined;
    }
  });

  const fullForms = $derived(`${card.term}, ${displayVerbForms(card).replace(' – ', ', ')}`);

  function check() {
    const r = {
      prae: !askPrae || checkForm(prae, card.praeteritum) === 'correct',
      p2: !askP2 || checkForm(p2, card.partizip2) === 'correct',
      aux: !askAux || aux === card.auxiliary,
      all: false,
    };
    r.all = r.prae && r.p2 && r.aux;
    checked = r;
    onanswer(gradeForResult(r.all), r.all);
    if (settings.autoplay) speak(fullForms);
  }

  function next() {
    (askPrae ? praeInput : p2Input)?.focus();
    onnext();
  }

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (checked) next();
    else check();
  }

  function enterFromPrae(e: KeyboardEvent) {
    if (e.key === 'Enter' && !checked && askP2) {
      e.preventDefault();
      p2Input?.focus();
    }
  }
</script>

<form class="stack" onsubmit={submit}>
  {#key item.seq}
    <div class="card prompt" in:slideIn>
      <div class="row center-row">
        <div class="big" lang="de">{card.term}</div>
        <SpeakButton text={card.term} />
      </div>
      <div class="muted">{card.translation}</div>
    </div>
  {/key}

  {#if askPrae}
    <div class="field">
      <label for="v-prae">Präteritum (er/sie/es)</label>
      <input
        id="v-prae"
        bind:this={praeInput}
        bind:value={prae}
        class="input"
        class:ok={checked?.prae}
        class:no={checked && !checked.prae}
        readonly={!!checked}
        lang="de"
        autocapitalize="off"
        autocomplete="off"
        autocorrect="off"
        spellcheck="false"
        enterkeyhint="next"
        onfocus={() => (active = praeInput)}
        onkeydown={enterFromPrae}
      />
      {#if checked && !checked.prae}<div class="correction">→ {card.praeteritum}</div>{/if}
    </div>
  {/if}

  {#if askP2}
    <div class="field">
      <label for="v-p2">Partizip II</label>
      <input
        id="v-p2"
        bind:this={p2Input}
        bind:value={p2}
        class="input"
        class:ok={checked?.p2}
        class:no={checked && !checked.p2}
        readonly={!!checked}
        lang="de"
        autocapitalize="off"
        autocomplete="off"
        autocorrect="off"
        spellcheck="false"
        enterkeyhint="done"
        onfocus={() => (active = p2Input)}
      />
      {#if checked && !checked.p2}<div class="correction">→ {card.partizip2}</div>{/if}
    </div>
  {/if}

  {#if askAux}
    <div class="field">
      <div class="label">Perfekt with</div>
      <div class="segmented" class:seg-ok={checked?.aux} class:seg-no={checked && !checked.aux}>
        {#each ['haben', 'sein'] as const as a}
          <button
            type="button"
            class:active={aux === a}
            disabled={!!checked}
            onpointerdown={(e) => e.preventDefault()}
            onclick={() => (aux = a)}>{a}</button
          >
        {/each}
      </div>
      {#if checked && !checked.aux}<div class="correction">→ {card.auxiliary}</div>{/if}
    </div>
  {/if}

  {#if !checked && (askPrae || askP2)}
    <UmlautBar input={active ?? praeInput ?? p2Input} />
  {/if}

  {#if checked}
    <div
      class="card summary"
      class:ok-border={checked.all}
      class:no-border={!checked.all}
      {@attach feedbackFx(checked.all ? 'good' : 'bad')}
    >
      <div class="head row" class:good={checked.all} class:bad={!checked.all}>
        <ResultIcon ok={checked.all} />{checked.all ? 'Correct!' : 'Not quite'}
      </div>
      <div class="row">
        <div class="forms" lang="de">{card.term} – {displayVerbForms(card)}</div>
        <SpeakButton text={fullForms} />
      </div>
    </div>
    <button type="submit" class="btn btn-primary btn-lg btn-block">Continue</button>
  {:else}
    <button type="submit" class="btn btn-primary btn-lg btn-block">Check</button>
  {/if}
</form>

<style>
  .prompt {
    text-align: center;
    padding: 24px 16px;
  }
  .center-row {
    justify-content: center;
  }
  .big {
    font-size: 30px;
    font-weight: 600;
  }
  .input.ok {
    border-color: var(--good);
    border-width: 2px;
  }
  .input.no {
    border-color: var(--bad);
    border-width: 2px;
  }
  .correction {
    color: var(--good);
    font-weight: 600;
    margin-left: 4px;
  }
  .segmented.seg-ok {
    box-shadow: 0 0 0 2px var(--good);
  }
  .segmented.seg-no {
    box-shadow: 0 0 0 2px var(--bad);
  }
  .segmented button:disabled {
    cursor: default;
    color: inherit;
  }
  .summary {
    border: 2px solid var(--border);
  }
  .ok-border {
    border-color: var(--good);
  }
  .no-border {
    border-color: var(--bad);
  }
  .head {
    font-weight: 700;
  }
  .summary .row {
    justify-content: space-between;
  }
  .forms {
    font-size: 18px;
    font-weight: 600;
  }
</style>
