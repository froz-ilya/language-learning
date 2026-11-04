<script lang="ts">
  import Icon from '../Icon.svelte';
  import { t } from '../../lib/i18n.svelte';
  import type { Lang } from '../../lib/types';
  import type { TranslateLang } from '../../lib/translate/translate';
  import { chooseAction } from '../../lib/ui/dialogs.svelte';

  /**
   * Source ⇄ target. One side is always German; tapping the other side picks English or Russian.
   */
  let {
    from,
    to,
    onswap,
    onpick,
  }: { from: TranslateLang; to: TranslateLang; onswap: () => void; onpick: (lang: Lang) => void } = $props();

  const nameOf = (l: TranslateLang) => (l === 'de' ? t('common.german') : l === 'en' ? t('common.english') : t('common.russian'));
  const OTHERS: Lang[] = ['ru', 'en'];

  function pick() {
    const current = from === 'de' ? to : from;
    void chooseAction(
      t('translator.pickLang'),
      OTHERS.map((l) => ({ label: nameOf(l), icon: l === current ? 'check' : undefined, run: () => onpick(l) })),
    );
  }
</script>

{#snippet side(lang: TranslateLang)}
  {#if lang === 'de'}
    <span class="lang fixed">{nameOf(lang)}</span>
  {:else}
    <button type="button" class="lang pick" aria-label={`${t('translator.pickLang')}: ${nameOf(lang)}`} onclick={pick}>
      <span class="name">{nameOf(lang)}</span>
      <span class="caret" aria-hidden="true"><Icon name="chevron" size={14} /></span>
    </button>
  {/if}
{/snippet}

<div class="langs" role="group" aria-label={t('translator.langs')}>
  {@render side(from)}
  <button type="button" class="icon-btn swap" aria-label={t('translator.swap')} onclick={onswap}><Icon name="swap" size={20} /></button>
  {@render side(to)}
</div>

<style>
  .langs {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: 6px;
    padding: 4px;
    border-radius: 14px;
    background: var(--seg-bg);
    box-shadow: inset 0 0 0 1px var(--hairline);
  }
  .lang {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-width: 0;
    min-height: 40px;
    padding: 0 8px;
    border: 0;
    border-radius: 10px;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 15px;
    color: var(--text);
  }
  .fixed {
    background: var(--seg-active);
    box-shadow: var(--shadow-sm);
  }
  .pick {
    background: var(--seg-active);
    box-shadow: var(--shadow-sm);
    color: var(--accent);
    cursor: pointer;
    transition: transform var(--dur-fast) var(--ease);
  }
  .pick:active {
    transform: scale(0.97);
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .caret {
    display: inline-flex;
    transform: rotate(90deg);
    flex-shrink: 0;
  }
  .swap {
    width: 40px;
    height: 40px;
  }
</style>
