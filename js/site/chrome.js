/**
 * Shared page chrome (header + footer).
 *
 * Rendered once from a single template so all nine pages stay in sync, with
 * an inline <noscript> navigation fallback so the site is still navigable
 * when JavaScript is unavailable.
 */

import { $, esc, escAttr } from './lib/dom.js';
import { SITE } from './config.js';

export const NAV_LINKS = [
  { href: 'index.html', label: 'Home' },
  { href: 'about.html', label: 'About' },
  { href: 'services.html', label: 'Services' },
  { href: 'portfolio.html', label: 'Work' },
  { href: 'game.html', label: 'The Game' },
  { href: 'contact.html', label: 'Contact' },
];

const noscriptNav = `
  <noscript>
    <div class="noscript-nav" role="navigation" aria-label="Fallback navigation">
      <a class="brand" href="index.html"><strong>SYNQ</strong></a>
      <nav>
        ${NAV_LINKS.map((l) => `<a href="${escAttr(l.href)}">${esc(l.label)}</a>`).join('')}
      </nav>
    </div>
  </noscript>`;

function header() {
  const links = NAV_LINKS.map(
    (l) => `<a class="nav__link" href="${escAttr(l.href)}">${esc(l.label)}</a>`
  ).join('');

  return `
  <header class="site-header" data-site-header>
    <nav class="nav" aria-label="Main navigation">
      <a class="brand" href="index.html" aria-label="${esc(SITE.name)} — home">
        <img class="brand__mark" src="assets/synq-mark-2x.png" alt="" width="34" height="34" decoding="async">
        <span class="brand__name">SYNQ <em>Technological</em> <span>Services</span></span>
      </a>

      <div class="nav__links" id="nav-links" data-nav-links>${links}</div>

      <div class="nav__actions">
        <button class="icon-btn" type="button" data-theme-toggle aria-pressed="false" title="Switch theme">
          <span aria-hidden="true">◐</span>
          <span class="visually-hidden">Switch to <span data-theme-label>Dark</span> theme</span>
        </button>
        <a class="btn btn--primary btn--sm nav__cta" href="contact.html">
          Start a project <span class="btn__icon" aria-hidden="true">↗</span>
        </a>
        <button class="menu-toggle" type="button" data-menu-toggle
                aria-expanded="false" aria-controls="nav-links" aria-label="Open menu">
          <span class="menu-toggle__bars" aria-hidden="true"></span>
        </button>
      </div>
    </nav>
  </header>`;
}

function footer() {
  const year = new Date().getFullYear();
  const social = SITE.social
    .map((s) => {
      // Placeholder social profiles are not linked — better an honest
      // "coming soon" than a dead or wrong link.
      const attrs = s.placeholder
        ? `class="is-pending" title="Profile not published yet"`
        : `href="${escAttr(s.href)}" target="_blank" rel="noopener noreferrer"`;
      const tag = s.placeholder ? 'span' : 'a';
      return `<${tag} ${attrs}>${esc(s.label)}</${tag}>`;
    })
    .join('');

  return `
  <footer class="site-footer">
    <div class="shell">
      <div class="footer__grid">
        <div class="footer__brand">
          <img class="footer__logo" src="assets/synq-logo-2x.png" alt="${esc(SITE.name)}" width="160" height="118" loading="lazy" decoding="async">
          <p class="footer__tagline">${esc(SITE.tagline)}</p>
          <div class="footer__contact">
            <a href="https://wa.me/${escAttr(SITE.whatsapp)}?text=${encodeURIComponent('Hi SYNQ — I would like to talk about a project.')}" target="_blank" rel="noopener noreferrer">
              <span aria-hidden="true">✆</span> WhatsApp · ${esc(SITE.phoneDisplay)}
            </a>
            <a href="mailto:${escAttr(SITE.email)}">
              <span aria-hidden="true">✉</span> ${esc(SITE.email)}
            </a>
          </div>
        </div>

        <div class="footer__cols">
          <div class="footer__col">
            <h2>Explore</h2>
            ${NAV_LINKS.map((l) => `<a href="${escAttr(l.href)}">${esc(l.label)}</a>`).join('')}
          </div>
          <div class="footer__col">
            <h2>More</h2>
            <a href="portfolio.html#featured">Aether Drift</a>
            <a href="privacy.html">Privacy policy</a>
            <a href="${escAttr(SITE.repository)}" target="_blank" rel="noopener noreferrer">Source</a>
          </div>
          <div class="footer__col">
            <h2>Follow</h2>
            ${social}
          </div>
        </div>

        <div class="footer__col">
          <h2>Studio</h2>
          <p class="footer__note">
            ${esc(SITE.location)}<br>
            Replies ${esc(SITE.responseTime)}.<br>
            Available for new projects.
          </p>
        </div>
      </div>

      <div class="footer__bottom">
        <span>© ${year} ${esc(SITE.name)}. All rights reserved.</span>
        <span><a href="#top">Back to top ↑</a></span>
      </div>
    </div>
  </footer>`;
}

export function mountChrome() {
  const head = $('[data-chrome-header]');
  const foot = $('[data-chrome-footer]');
  if (head) head.outerHTML = header();
  if (foot) foot.outerHTML = footer();
}

export { noscriptNav };
