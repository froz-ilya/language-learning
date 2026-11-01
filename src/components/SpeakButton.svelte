<script lang="ts">
  import Icon from './Icon.svelte';
  import { speak } from '../lib/speech/tts';
  import { t } from '../lib/i18n.svelte';

  /** Speaker button; long-press (or `slow`) speaks at 0.6×. */
  let { text, slow = false, size = 22 }: { text: string; slow?: boolean; size?: number } = $props();

  let timer: ReturnType<typeof setTimeout> | undefined;
  let longPressed = false;

  function down() {
    longPressed = false;
    timer = setTimeout(() => {
      longPressed = true;
      speak(text, { slow: true });
    }, 450);
  }
  function up() {
    clearTimeout(timer);
  }
  function click(e: MouseEvent) {
    e.stopPropagation();
    if (!longPressed) speak(text, { slow });
  }
</script>

<button
  class="icon-btn"
  type="button"
  aria-label={slow ? t('shell.pronounceSlowly') : t('shell.pronounce')}
  onpointerdown={down}
  onpointerup={up}
  onpointerleave={up}
  onclick={click}
  oncontextmenu={(e) => e.preventDefault()}
>
  <Icon name={slow ? 'turtle' : 'speaker'} {size} />
</button>
