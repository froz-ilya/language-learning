<script lang="ts">
  import { t } from '../lib/i18n.svelte';

  /**
   * Switcher between the readings of one word: "treffen | sich treffen", "sein (verb) | sein
   * (possessive) | das Sein". Same look on the add screen, in search and in the reader's word
   * sheet. Only the reading picked shows its details. Options wrap on a phone.
   */
  let {
    options,
    selected,
    onpick,
    onpointerdown,
  }: {
    options: { id: string; label: string }[];
    /** Id of the option shown. */
    selected: string;
    onpick: (id: string) => void;
    /** Lets the caller keep the keyboard up (CardEditor's keepFocus). */
    onpointerdown?: (e: PointerEvent) => void;
  } = $props();
</script>

<div class="segmented options" role="group" aria-label={t('reading.switch.label')}>
  {#each options as o (o.id)}
    <button
      type="button"
      class:active={o.id === selected}
      aria-pressed={o.id === selected}
      lang="de"
      {onpointerdown}
      onclick={() => o.id !== selected && onpick(o.id)}>{o.label}</button
    >
  {/each}
</div>

<style>
  .options {
    flex-wrap: wrap;
    width: fit-content;
    max-width: 100%;
    margin: 2px 0 4px;
  }
  .options button {
    flex: 1 1 auto;
    min-width: 0;
    max-width: 100%;
    min-height: 34px;
    padding: 4px 14px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
