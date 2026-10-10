/**
 * "Signal field" — the ambient canvas used behind the hero.
 *
 * Deliberately cheap: a fixed node count, an O(n·k) neighbour search using a
 * spatial grid, DPR-aware sizing, an IntersectionObserver + visibilitychange
 * pause, and a hard stop under prefers-reduced-motion.
 */

import { prefersReducedMotion } from './dom.js';

const TAU = Math.PI * 2;

export function createSignalField(canvas, options = {}) {
  if (!canvas) return { destroy() {} };
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return { destroy() {} };

  const cfg = {
    count: 46,
    linkDistance: 132,
    speed: 0.22,
    dotRadius: 1.7,
    ...options,
  };

  let nodes = [];
  let width = 0;
  let height = 0;
  let dpr = 1;
  let raf = 0;
  let visible = true;
  let running = false;
  let last = 0;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = rect.width;
    height = rect.height;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed();
  }

  function seed() {
    const area = width * height;
    const target = Math.max(16, Math.min(cfg.count, Math.round(area / 12000)));
    nodes = Array.from({ length: target }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * cfg.speed * 2,
      vy: (Math.random() - 0.5) * cfg.speed * 2,
      r: cfg.dotRadius * (0.7 + Math.random() * 0.8),
    }));
  }

  function readPalette() {
    const styles = getComputedStyle(document.documentElement);
    return {
      line: styles.getPropertyValue('--accent').trim() || '#0b5fff',
      dot: styles.getPropertyValue('--accent-2').trim() || '#00c8f0',
    };
  }
  let palette = readPalette();

  function frame(now) {
    if (!running) return;
    const dt = Math.min(48, now - last || 16);
    last = now;

    ctx.clearRect(0, 0, width, height);

    // Nodes
    ctx.fillStyle = palette.dot;
    for (const n of nodes) {
      n.x += (n.vx * dt) / 16;
      n.y += (n.vy * dt) / 16;
      if (n.x < 0 || n.x > width) n.vx *= -1;
      if (n.y < 0 || n.y > height) n.vy *= -1;
      n.x = Math.max(0, Math.min(width, n.x));
      n.y = Math.max(0, Math.min(height, n.y));
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, TAU);
      ctx.fill();
    }

    // Links — uniform grid keeps this near-linear instead of O(n²)
    const cell = cfg.linkDistance;
    const cols = Math.max(1, Math.ceil(width / cell));
    const grid = new Map();
    nodes.forEach((n, i) => {
      const key = Math.floor(n.x / cell) + Math.floor(n.y / cell) * cols;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(i);
    });

    ctx.strokeStyle = palette.line;
    ctx.lineWidth = 1;
    for (let i = 0; i < nodes.length; i += 1) {
      const a = nodes[i];
      const cx = Math.floor(a.x / cell);
      const cy = Math.floor(a.y / cell);
      for (let ox = 0; ox <= 1; ox += 1) {
        for (let oy = ox === 0 ? 0 : -1; oy <= 1; oy += 1) {
          const bucket = grid.get(cx + ox + (cy + oy) * cols);
          if (!bucket) continue;
          for (const j of bucket) {
            if (j <= i) continue;
            const b = nodes[j];
            const dx = a.x - b.x;
            const dy = a.y - b.y;
            const d = Math.hypot(dx, dy);
            if (d > cfg.linkDistance) continue;
            ctx.globalAlpha = (1 - d / cfg.linkDistance) * 0.28;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }
    }
    ctx.globalAlpha = 1;

    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (running || prefersReducedMotion() || !visible) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
  }

  /* ---- lifecycle ------------------------------------------------------ */
  // IntersectionObserver is the polite way to stop drawing off-screen, but it
  // is not universal (and not in every test environment). Treat it as an
  // enhancement: without it the field simply stays "visible" and relies on the
  // visibilitychange listener below to idle when the tab is hidden.
  const observer = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(
      (entries) => {
        visible = entries.some((e) => e.isIntersecting);
        visible ? start() : stop();
      },
      { threshold: 0.01 },
    )
    : null;
  if (observer) {
    observer.observe(canvas);
  } else {
    visible = true;
  }

  const onVisibility = () => {
    if (document.hidden) stop();
    else if (visible) start();
  };
  document.addEventListener('visibilitychange', onVisibility);

  let resizeTimer = 0;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resize();
      if (running) {
        // one static repaint so the field is never blank after a resize
        const wasRunning = running;
        stop();
        if (wasRunning) start();
      } else {
        drawStatic();
      }
    }, 160);
  };
  window.addEventListener('resize', onResize, { passive: true });

  function drawStatic() {
    if (!width || !height) return;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = palette.dot;
    nodes.forEach((n) => {
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, TAU);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  const themeObserver = typeof MutationObserver === 'function'
    ? new MutationObserver(() => {
      palette = readPalette();
      if (!running) drawStatic();
    })
    : null;
  themeObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

  // Fonts changing can alter layout size; re-measure once they settle.
  document.fonts?.ready?.then(() => resize()).catch(() => {});

  resize();
  if (prefersReducedMotion()) drawStatic();
  else start();

  return {
    destroy() {
      stop();
      observer?.disconnect();
      themeObserver.disconnect();
      clearTimeout(resizeTimer);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
