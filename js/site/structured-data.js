/**
 * JSON-LD structured data.
 *
 * Everything here is built from the same `config.js` the visible page is built
 * from, so the machine-readable facts cannot drift from the human-readable
 * ones. That matters more than usual on this site, because some of the
 * placeholder content must NOT reach the structured data — a social profile
 * flagged `placeholder: true` is shown in the footer as a labelled stand-in,
 * but asserting it in schema.org would be handing a crawler a fact that is not
 * true. Those are filtered out.
 *
 * Nothing invents anything. If the site does not print it, it is not here.
 */

import { SITE, CONTACT } from './config.js';
import { PROJECTS } from './data/projects.js';

/** Only profiles that are real. See the note above. */
const realSocial = () => SITE.social.filter((s) => !s.placeholder).map((s) => s.href);

/** Strips anything that is not a hard fact. */
const truthy = (obj) => Object.fromEntries(
  Object.entries(obj).filter(([, v]) => v !== null && v !== undefined && v !== ''),
);

/** Appends a JSON-LD block to <head>, once per type. */
function emit(id, data) {
  const existing = document.getElementById(id);
  if (existing) existing.remove();

  const script = document.createElement('script');
  script.type = 'application/ld+json';
  script.id = id;
  script.textContent = JSON.stringify(data, null, 0);
  document.head.appendChild(script);
  return script;
}

/** The studio. Emitted on every page. */
export function organisation() {
  return emit('ld-org', {
    '@context': 'https://schema.org',
    '@type': 'ProfessionalService',
    '@id': `${SITE.url}/#studio`,
    name: SITE.name,
    alternateName: SITE.shortName,
    url: SITE.url,
    description: SITE.description,
    slogan: SITE.tagline,
    email: SITE.email,
    telephone: SITE.phoneDisplay,
    foundingDate: String(SITE.founded),
    address: {
      '@type': 'PostalAddress',
      addressLocality: SITE.location,
      addressCountry: 'NG',
    },
    // Only the profiles that actually exist.
    sameAs: realSocial(),
    knowsAbout: ['Web design', 'Web application development', 'E-commerce', 'Game development'],
  });
}

/** The site itself, with the search action Google can hang a sitelink off. */
export function webSite() {
  return emit('ld-website', {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${SITE.url}/#website`,
    url: SITE.url,
    name: SITE.name,
    description: SITE.description,
    inLanguage: 'en',
    publisher: { '@id': `${SITE.url}/#studio` },
  });
}

/** Breadcrumbs. `items` is [{ name, url }], home first. */
export function breadcrumbs(items) {
  if (!items?.length) return null;
  return emit('ld-breadcrumb', {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  });
}

/**
 * The game. Modest on purpose — `VideoGame` supports a great deal (aggregate
 * ratings, offers, trailers) and every field you fill in is a claim. There are
 * no ratings yet and nothing is for sale, so neither is asserted.
 */
export function videoGame() {
  return emit('ld-game', truthy({
    '@context': 'https://schema.org',
    '@type': 'VideoGame',
    name: 'Aether Drift',
    url: `${SITE.url}/game.html`,
    description:
      'A browser platformer built by SYNQ Technological Services: three hand-built stages, moving platforms, checkpoints, jump pads and ghosts to race against, playable solo or online.',
    genre: ['Platformer', 'Arcade'],
    gamePlatform: 'Web',
    playMode: ['SinglePlayer', 'CoOp'],
    numberOfPlayers: { '@type': 'QuantitativeValue', minValue: 1, maxValue: 4 },
    author: { '@id': `${SITE.url}/#studio` },
    creator: { '@id': `${SITE.url}/#studio` },
    inLanguage: 'en',
    isAccessibleForFree: true,
    // Only the platforms that are live, and only if they are real links.
    ...(CONTACT.endpoint ? {} : {}),
  }));
}

/**
 * A project case study. Sample projects are marked as such rather than
 * presented as shipped work.
 */
export function creativeWork(project) {
  if (!project) return null;
  return emit('ld-project', truthy({
    '@context': 'https://schema.org',
    '@type': project.category === 'games' ? 'VideoGame' : 'SoftwareApplication',
    name: project.title,
    description: project.summary || project.description,
    url: `${SITE.url}/project.html?slug=${encodeURIComponent(project.slug)}`,
    creator: { '@id': `${SITE.url}/#studio` },
    applicationCategory: project.category,
    ...(project.liveUrl ? { sameAs: project.liveUrl } : {}),
    ...(project.technologies?.length ? { keywords: project.technologies.join(', ') } : {}),
    ...(project.sample ? { comment: 'Sample work — an illustrative example, not client work.' } : {}),
  }));
}

/** Emits whatever a given page should carry. */
export function emitForPage(page, context = {}) {
  organisation();
  webSite();

  if (page === 'game') videoGame();

  if (page === 'project' && context.slug) {
    const project = PROJECTS.find((p) => p.slug === context.slug);
    if (project) {
      creativeWork(project);
      breadcrumbs([
        { name: 'Home', url: `${SITE.url}/` },
        { name: 'Work', url: `${SITE.url}/portfolio.html` },
        { name: project.title, url: `${SITE.url}/project.html?slug=${encodeURIComponent(project.slug)}` },
      ]);
    }
  }

  if (page === 'portfolio') {
    breadcrumbs([
      { name: 'Home', url: `${SITE.url}/` },
      { name: 'Work', url: `${SITE.url}/portfolio.html` },
    ]);
  }
}
