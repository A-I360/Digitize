/**
 * Portfolio grid: category filtering, counts and the flagship slot.
 * Everything renders from js/site/data/projects.js.
 */

import { stagger } from '../reveal.js';
import { $, $$, esc, escAttr } from '../lib/dom.js';
import { PROJECTS, CATEGORIES, GAME_COVER } from '../data/projects.js';
import { workCard } from './work.js';

function renderFilters(active) {
  const bar = $('[data-filters]');
  if (!bar) return;
  bar.innerHTML =
    CATEGORIES.map(
      (c) => `
      <button class="filter-btn" type="button" data-filter="${escAttr(c.id)}"
              aria-pressed="${c.id === active ? 'true' : 'false'}">${esc(c.label)}</button>`
    ).join('') + `<span class="filter-count" data-filter-count aria-live="polite"></span>`;
}

function countFor(id) {
  return id === 'all' ? PROJECTS.length : PROJECTS.filter((p) => p.category === id).length;
}

function renderGrid(filter) {
  const grid = $('[data-work-grid]');
  if (!grid) return;

  const list = filter === 'all' ? PROJECTS : PROJECTS.filter((p) => p.category === filter);

  if (!list.length) {
    grid.innerHTML = `
      <div class="card card--quiet" style="grid-column:1/-1;text-align:center">
        <p class="card__body">No projects in this category yet.</p>
      </div>`;
  } else {
    grid.innerHTML = list.map((p, i) => workCard(p, { eager: i < 2 })).join('');
    stagger(grid, 70, 420);
    requestAnimationFrame(() => {
      $$('.work-card', grid).forEach((card) => card.classList.add('is-visible'));
    });
  }

  const counter = $('[data-filter-count]');
  if (counter) {
    counter.textContent = `${list.length} ${list.length === 1 ? 'project' : 'projects'}`;
  }
}

function renderFlagship() {
  const mount = $('[data-portfolio-featured]');
  if (!mount) return;
  const game = PROJECTS.find((p) => p.slug === 'aether-drift');
  if (!game) return;

  mount.innerHTML = `
    <article class="featured-project reveal" id="featured">
      <div class="featured-project__media">
        <picture>
          <source srcset="${GAME_COVER.webp}" type="image/webp">
          <img src="${GAME_COVER.jpg}" alt="${esc(GAME_COVER.alt)}" width="1600" height="900" loading="eager" decoding="async" data-boot-image>
        </picture>
      </div>
      <div class="featured-project__body">
        <div class="cluster">
          <span class="badge badge--violet">Flagship</span>
          <span class="badge badge--mint badge--dot">Shipped</span>
        </div>
        <h2 class="featured-project__title">${esc(game.title)}</h2>
        <p class="featured-project__text">${esc(game.description)}</p>
        <div class="tag-row">
          ${game.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}
        </div>
        <div class="cluster" style="margin-top:var(--sp-2)">
          <a class="btn btn--primary" href="game.html">Play it now <span class="btn__icon" aria-hidden="true">↗</span></a>
          <a class="btn btn--quiet" href="project.html?slug=aether-drift">Case study <span class="btn__icon" aria-hidden="true">→</span></a>
        </div>
      </div>
    </article>`;
}

export function initPortfolio() {
  const grid = $('[data-work-grid]');
  if (!grid) return;

  renderFlagship();
  renderFilters('all');
  renderGrid('all');

  $('[data-filters]')?.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-filter]');
    if (!btn) return;
    const filter = btn.dataset.filter;

    $$('[data-filter]').forEach((b) =>
      b.setAttribute('aria-pressed', String(b === btn))
    );
    renderGrid(filter);

    const counter = $('[data-filter-count]');
    if (counter) counter.textContent = `${countFor(filter)} shown`;
  });

  // Support a deep link such as portfolio.html#games
  const hash = decodeURIComponent(location.hash.replace('#', ''));
  if (hash && CATEGORIES.some((c) => c.id === hash && c.id !== 'all')) {
    const btn = $(`[data-filter="${CSS.escape(hash)}"]`);
    if (btn) {
      btn.click();
      document.querySelector('[data-work-grid]')?.scrollIntoView({ block: 'start' });
    }
  }
}
