<script lang="ts">
  import Icon from '../Icon.svelte';
  import Skeleton from '../Skeleton.svelte';
  import { live } from '../../lib/live.svelte';
  import { db } from '../../lib/db/schema';
  import { lastQuickAddSet } from '../../lib/share';
  import { isSameWord, loadSetChoices, type SetChoice } from '../../lib/search/addToSet';
  import type { WordFields } from '../../lib/search/wordInfo';

  /**
   * Contents of the "Add to set" sheet: the user's own sets (the last quick-add set first, sets
   * that have the word already marked), and "New set…".
   */
  let {
    fields,
    busy = false,
    onpick,
    onnew,
  }: {
    fields: WordFields;
    busy?: boolean;
    onpick: (set: SetChoice) => void;
    onnew: () => void;
  } = $props();

  const data = live(async () => {
    const term = fields.term;
    const genders = fields.genders ?? [];
    const [choices, cards] = await Promise.all([
      loadSetChoices(lastQuickAddSet()),
      db.cards.where('term').equalsIgnoreCase(term.trim()).toArray(),
    ]);
    const has = new Set(cards.filter((c) => isSameWord(c, term, genders)).map((c) => c.setId));
    return { choices, has };
  });
</script>

{#if !data.value}
  <Skeleton lines={3} />
{:else}
  <div class="picker" lang="en">
    {#if data.value.choices.length}
      <div class="list">
        {#each data.value.choices as s (s.id)}
          {@const added = data.value.has.has(s.id)}
          <button type="button" class="list-item" disabled={busy} onclick={() => onpick(s)}>
            <span class="badge-icon" style:--tone={added ? 'var(--good)' : undefined}>
              <Icon name={added ? 'check' : 'cards'} size={20} />
            </span>
            <span class="grow">
              <span class="title ellipsis">{s.name}</span>
              {#if added || s.last || s.folder}
                <span class="sub ellipsis">
                  {[added ? 'Already has this word' : '', s.last && !added ? 'Last used' : '', s.folder].filter(Boolean).join(' · ')}
                </span>
              {/if}
            </span>
          </button>
        {/each}
      </div>
    {:else}
      <p class="small muted center none">You don’t have any sets yet. Make one for the words you look up.</p>
    {/if}
    <button type="button" class="btn btn-block" class:btn-primary={!data.value.choices.length} disabled={busy} onclick={onnew}>
      <Icon name="plus" size={20} /> New set…
    </button>
  </div>
{/if}

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .list {
    background: var(--surface);
  }
  .grow {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .ellipsis {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .badge-icon {
    width: 36px;
    height: 36px;
    border-radius: 11px;
  }
  .none {
    margin: 4px 8px;
  }
  .list-item:disabled {
    opacity: 0.6;
  }
</style>
