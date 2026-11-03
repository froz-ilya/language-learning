<script lang="ts">
  import { displayPlural, speakableTerm } from '../../lib/german/articles';
  import { t } from '../../lib/i18n.svelte';
  import { settings } from '../../lib/settings.svelte';
  import Sheet from '../Sheet.svelte';
  import SpeakButton from '../SpeakButton.svelte';
  import Term from '../Term.svelte';
  import { nounSheet } from './nouns.svelte';

  /** The sheet of a tapped noun: article in its gender's colour, plural, meaning. Once per page. */
  let open = $state(false);

  $effect(() => {
    if (nounSheet.entry) open = true;
  });

  function onclose() {
    nounSheet.entry = null;
  }

  const entry = $derived(nounSheet.entry);
  /** Shown when the sentence has another form than the dictionary's ("Kindern" → das Kind). */
  const form = $derived(entry && nounSheet.written !== entry.term ? nounSheet.written : '');
</script>

<Sheet bind:open {onclose}>
  {#if entry}
    <div class="noun" lang="de">
      <div class="head">
        <span class="term"><Term card={entry} /></span>
        <SpeakButton text={speakableTerm(entry)} />
      </div>
      {#if entry.plural}<div class="plural">{t('study.plural', { plural: displayPlural(entry) })}</div>{/if}
      {#if form}<div class="form">{t('grammar.noun.form', { form })}</div>{/if}
      {#if entry.tr[settings.lang]}<div class="tr" lang={settings.lang}>{entry.tr[settings.lang]}</div>{/if}
    </div>
  {/if}
</Sheet>

<style>
  .noun {
    padding: 4px 4px 12px;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .term {
    font-family: var(--font-display);
    font-size: 26px;
    font-weight: 800;
  }
  .plural,
  .form {
    margin-top: 4px;
    font-size: 15px;
    color: var(--text-2);
  }
  .tr {
    margin-top: 10px;
    font-size: 17px;
  }
</style>
