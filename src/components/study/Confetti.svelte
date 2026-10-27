<script lang="ts">
  import { reducedMotion } from '../../lib/motion';

  /** One short confetti burst (~1.2 s) on a full-screen canvas. Nothing with reduced motion. */
  let { pieces = 90, duration = 1200 }: { pieces?: number; duration?: number } = $props();

  const enabled = !reducedMotion();

  function confetti(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    const css = getComputedStyle(document.documentElement);
    const colors = ['--accent', '--good', '--der', '--die', '--warn']
      .map((v) => css.getPropertyValue(v).trim())
      .filter(Boolean);
    if (!colors.length) colors.push('#f6c35b', '#5ad48a', '#6fb0ff', '#ff7fa5', '#ff9d5c');

    const parts = Array.from({ length: pieces }, (_, i) => {
      const fromLeft = i % 2 === 0;
      const angle = (fromLeft ? -60 : -120) + (Math.random() - 0.5) * 50;
      const speed = 9 + Math.random() * 8;
      return {
        x: fromLeft ? w * 0.1 : w * 0.9,
        y: h * 0.62,
        vx: Math.cos((angle * Math.PI) / 180) * speed,
        vy: Math.sin((angle * Math.PI) / 180) * speed,
        size: 5 + Math.random() * 5,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.4,
        color: colors[i % colors.length],
      };
    });

    let raf = 0;
    const start = performance.now();
    let last = start;
    const frame = (t: number) => {
      const k = Math.min(3, (t - last) / 16.7);
      last = t;
      const life = (t - start) / duration;
      ctx.clearRect(0, 0, w, h);
      if (life >= 1) return;
      ctx.globalAlpha = life > 0.7 ? (1 - life) / 0.3 : 1;
      for (const p of parts) {
        p.vy += 0.35 * k;
        p.vx *= 0.99;
        p.x += p.vx * k;
        p.y += p.vy * k;
        p.rot += p.vr * k;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }
</script>

{#if enabled}
  <canvas class="confetti" aria-hidden="true" {@attach confetti}></canvas>
{/if}

<style>
  .confetti {
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100vh;
    pointer-events: none;
    z-index: 50;
  }
</style>
