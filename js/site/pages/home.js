/**
 * Home page behaviour.
 */

import { stagger } from '../reveal.js';
import { $, $$ } from '../lib/dom.js';
import { createSignalField } from '../lib/canvas-field.js';
import { PROJECTS, GAME_COVER } from '../data/projects.js';
import { workCard } from './work.js';

function renderFeatured() {
  const mount = $('[data-featured-project]');
  if (!mount) return;

  const game = PROJECTS.find((p) => p.slug === 'aether-drift');
  if (!game) return;

  mount.innerHTML = `
    <div class="featured-project reveal">
      <div class="featured-project__media">
        <picture>
          <source srcset="${GAME_COVER.smallWebp}" type="image/webp">
          <img src="${GAME_COVER.smallJpg}" alt="${GAME_COVER.alt}" width="800" height="450" loading="lazy" decoding="async">
        </picture>
      </div>
      <div class="featured-project__body">
        <p class="eyebrow">Flagship project</p>
        <h3 class="featured-project__title">${game.title}</h3>
        <p class="featured-project__text">${game.description}</p>
        <div class="tag-row">
          <span class="tag">Game Development</span>
          <span class="tag">2D Platformer</span>
          <span class="tag">Physics</span>
          <span class="tag">Multiplayer</span>
        </div>
        <div class="cluster">
          <a class="btn btn--primary" href="game.html">Play the game <span class="btn__icon" aria-hidden="true">↗</span></a>
          <a class="btn btn--quiet" href="project.html?slug=aether-drift">Read case study <span class="btn__icon" aria-hidden="true">→</span></a>
        </div>
      </div>
    </div>`;
}

function renderWorkPreview() {
  const mount = $('[data-work-preview]');
  if (!mount) return;
  const picks = PROJECTS.filter((p) => p.slug !== 'aether-drift').slice(0, 3);
  mount.innerHTML = picks.map((p) => workCard(p)).join('');
  stagger(mount, 90);
}

export function initHome() {
  const canvas = $('[data-signal-field]');
  if (canvas) {
    createSignalField(canvas, { count: 52, linkDistance: 140 });
  }

  renderFeatured();
  renderWorkPreview();

  // Duplicate the marquee track once so the -50% translation loops seamlessly.
  const track = $('[data-marquee]');
  if (track) track.innerHTML += track.innerHTML;
}
