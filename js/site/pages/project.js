/**
 * Project detail page — rendered from ?slug= in the URL.
 * Direct links, refreshes and back/forward all work because the slug is read
 * from location.search on every load.
 */

import { $, esc, escAttr } from '../lib/dom.js';
import { findProject, PROJECTS, coverSources, GAME_COVER } from '../data/projects.js';
import { statusBadge, sampleFlag } from './work.js';

const CATEGORY_LABEL = {
  websites: 'Website',
  'web-apps': 'Web app',
  games: 'Game',
  ecommerce: 'E-commerce',
  experiments: 'Experiment',
};

function setHeading(title) {
  const heading = $('[data-project-title]');
  if (heading) heading.textContent = title;
  const crumb = $('[data-project-crumb]');
  if (crumb) crumb.textContent = title;
}

function notFoundState(mount) {
  setHeading('Project not found');
  mount.innerHTML = `
    <div class="card card--quiet">
      <p class="eyebrow">Not found</p>
      <h2 style="font-size:1.5rem">That project does not exist.</h2>
      <p class="card__body">The link may be out of date. Every project we have published is listed on the work page.</p>
      <a class="btn btn--primary" href="portfolio.html">Browse all work <span class="btn__icon" aria-hidden="true">→</span></a>
    </div>`;
}

export function initProjectPage() {
  const mount = $('[data-project-detail]');
  if (!mount) return;

  const slug = new URLSearchParams(location.search).get('slug');
  const project = slug ? findProject(slug) : null;

  if (!project) {
    notFoundState(mount);
    document.title = 'Project not found — SYNQ Technological Services';
    return;
  }

  const cover = project.slug === 'aether-drift' ? GAME_COVER : coverSources(project.cover.file);
  const coverAlt = project.slug === 'aether-drift' ? GAME_COVER.alt : project.cover.alt;

  document.title = `${project.title} — SYNQ Technological Services`;
  setHeading(project.title);
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) metaDesc.setAttribute('content', project.description.slice(0, 158));

  const liveLink =
    project.liveUrl &&
    `<a class="btn btn--primary" href="${escAttr(project.liveUrl)}">${
      project.category === 'games' ? 'Play the game' : 'View live site'
    } <span class="btn__icon" aria-hidden="true">↗</span></a>`;

  const sourceLink =
    project.sourceUrl &&
    `<a class="btn btn--quiet" href="${escAttr(project.sourceUrl)}" target="_blank" rel="noopener noreferrer">Source code <span class="btn__icon" aria-hidden="true">↗</span></a>`;

  mount.innerHTML = `
    <article class="stack stack--lg">
      <div class="stack">
        <div class="cluster">
          <span class="badge">${esc(CATEGORY_LABEL[project.category] || project.category)}</span>
          ${statusBadge(project)}
          ${project.sample ? sampleFlag() : ''}
        </div>
        <p class="eyebrow">${esc(project.category || 'Work')}</p>
        <p class="lede">${esc(project.tagline)}</p>
      </div>

      ${
        project.sample
          ? `<div class="form-status form-status--warn is-visible">
               <span aria-hidden="true">⚠</span>
               <span><strong>Illustrative entry.</strong> This case study exists to show the structure of a finished project.
               It is not a claim about work delivered. Replace it with a real project in
               <code>js/site/data/projects.js</code>.</span>
             </div>`
          : ''
      }

      <div class="project-hero__media">
        <picture>
          <source srcset="${escAttr(cover.webp)}" type="image/webp">
          <img src="${escAttr(cover.jpg)}" alt="${escAttr(coverAlt)}" width="1600" height="900" loading="eager" decoding="async" data-boot-image>
        </picture>
      </div>

      <div class="project-meta">
        <div class="project-meta__item"><span class="project-meta__label">Client</span><span class="project-meta__value">${esc(project.client)}</span></div>
        <div class="project-meta__item"><span class="project-meta__label">Year</span><span class="project-meta__value">${esc(project.year || '—')}</span></div>
        <div class="project-meta__item"><span class="project-meta__label">Role</span><span class="project-meta__value">${esc(project.role)}</span></div>
        <div class="project-meta__item"><span class="project-meta__label">Status</span><span class="project-meta__value">${esc(project.status)}</span></div>
      </div>

      <div class="stack">
        <h2 style="font-size:1.5rem">Overview</h2>
        <p style="color:var(--text-2);line-height:1.8;max-width:68ch">${esc(project.description)}</p>
      </div>

      ${
        project.metrics?.length
          ? `<div class="stats" style="grid-template-columns:repeat(${Math.min(4, project.metrics.length)},minmax(0,1fr))">
              ${project.metrics
                .map(
                  (m) => `<div class="stat"><span class="stat__value">${esc(m.value)}</span><span class="stat__label">${esc(m.label)}</span></div>`
                )
                .join('')}
             </div>`
          : ''
      }

      ${
        project.highlights?.length
          ? `<div class="stack">
               <h2 style="font-size:1.5rem">What went into it</h2>
               <ul class="stack stack--sm">
                 ${project.highlights
                   .map(
                     (h) =>
                       `<li style="display:flex;gap:.75rem;color:var(--text-2);line-height:1.75"><span aria-hidden="true" style="color:var(--accent)">✦</span><span>${esc(h)}</span></li>`
                   )
                   .join('')}
               </ul>
             </div>`
          : ''
      }

      <div class="stack">
        <h2 style="font-size:1.5rem">Technologies</h2>
        <div class="tag-row">${project.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
      </div>

      <div class="cluster">${liveLink || ''}${sourceLink || ''}</div>
    </article>

    <nav class="cluster" style="justify-content:space-between;margin-top:var(--sp-8);padding-top:var(--sp-5);border-top:1px solid var(--line)" aria-label="Project navigation">
      <a class="link-arrow" href="portfolio.html"><span aria-hidden="true">←</span> All work</a>
      <a class="link-arrow" href="contact.html">Start a project like this <span aria-hidden="true">→</span></a>
    </nav>`;
}

/** Renders the small "next project" strip used at the foot of a case study. */
export function renderRelated(currentSlug) {
  const mount = $('[data-related-projects]');
  if (!mount) return;
  const others = PROJECTS.filter((p) => p.slug !== currentSlug).slice(0, 2);
  if (!others.length) return;
  mount.innerHTML = others
    .map((p) => {
      const cover = coverSources(p.cover.file);
      return `
      <a class="work-card__link" href="project.html?slug=${encodeURIComponent(p.slug)}">
        <div class="work-card__media frame frame--16x10">
          <picture>
            <source srcset="${escAttr(cover.webp)}" type="image/webp">
            <img src="${escAttr(cover.jpg)}" alt="${escAttr(p.cover.alt)}" width="1200" height="750" loading="lazy" decoding="async">
          </picture>
        </div>
        <div class="work-card__body">
          <h3 class="work-card__title">${esc(p.title)}</h3>
          <p class="work-card__desc">${esc(p.tagline)}</p>
          <span class="link-arrow">Read case study <span aria-hidden="true">→</span></span>
        </div>
      </a>`;
    })
    .join('');
}
