/**
 * Work-card rendering shared by the home preview and the portfolio grid,
 * so a change to the card appears everywhere at once.
 */

import { esc, escAttr } from '../lib/dom.js';
import { coverSources } from '../data/projects.js';

const STATUS_LABEL = {
  shipped: 'Shipped',
  'in-development': 'In development',
  concept: 'Concept',
};
const STATUS_KIND = {
  shipped: 'badge--mint',
  'in-development': 'badge--amber',
  concept: 'badge--neutral',
};

export function statusBadge(project) {
  const label = STATUS_LABEL[project.status] || project.status;
  return `<span class="badge ${STATUS_KIND[project.status] || 'badge--neutral'} badge--dot">${esc(label)}</span>`;
}

export function sampleFlag() {
  return `<span class="sample-flag" title="Illustrative entry — replace with real work">Sample entry</span>`;
}

export function workCard(project, { eager = false } = {}) {
  const cover = coverSources(project.cover.file);
  const href = `project.html?slug=${encodeURIComponent(project.slug)}`;
  const loading = eager ? 'eager' : 'lazy';

  return `
  <article class="work-card ${project.size === 'wide' ? 'work-card--wide' : ''} ${project.size === 'third' ? 'work-card--third' : ''}" data-category="${escAttr(project.category)}" data-slug="${escAttr(project.slug)}">
    <a class="work-card__link" href="${escAttr(href)}">
      <div class="work-card__media ${project.size === 'wide' ? 'ratio-16x9' : 'frame frame--16x10'}">
        <picture>
          <source srcset="${escAttr(cover.webp)}" type="image/webp">
          <img src="${escAttr(cover.jpg)}" alt="${escAttr(project.cover.alt)}"
               width="1200" height="750" loading="${loading}" decoding="async">
        </picture>
        <div class="work-card__overlay">
          <span class="work-card__overlay-text">View project</span>
          <span class="work-card__overlay-text" aria-hidden="true">→</span>
        </div>
      </div>
      <div class="work-card__body">
        <div class="work-card__top">
          <h3 class="work-card__title">${esc(project.title)}</h3>
          ${statusBadge(project)}
        </div>
        <p class="work-card__desc">${esc(project.tagline)}</p>
        ${project.sample ? sampleFlag() : ''}
        <div class="tag-row">${project.tags.slice(0, 4).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
        <div class="work-card__foot">
          <span class="link-arrow">Read case study <span aria-hidden="true">→</span></span>
          ${project.year ? `<span class="mono" style="font-size:var(--fs-xs);color:var(--text-3)">${esc(String(project.year))}</span>` : ''}
        </div>
      </div>
    </a>
  </article>`;
}
