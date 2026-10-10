/**
 * Services page: currency switcher for the price cards.
 * Prices come from data/pricing.js and are converted from one shared rate.
 */

import { $, $$, esc } from '../lib/dom.js';
import { CURRENCY } from '../config.js';
import { PLANS } from '../data/pricing.js';
import { store } from '../lib/storage.js';

const KEY = 'currency';

function renderPlan(plan, currency) {
  const amount =
    plan.ngn === null
      ? 'Let’s scope it'
      : `${CURRENCY.format[currency](currency === 'USD' ? plan.ngn / CURRENCY.nairaPerUsd : plan.ngn)}`;

  return `
  <article class="card ${plan.featured ? 'card--invert' : ''} card--hover reveal" style="${plan.featured ? 'box-shadow:var(--sh-lg)' : ''}">
    ${plan.featured ? '<span class="badge" style="position:absolute;top:1.25rem;right:1.25rem;background:var(--cyan);color:#062033">Most chosen</span>' : ''}
    <div class="stack stack--sm">
      <p class="eyebrow eyebrow--plain" style="${plan.featured ? 'color:var(--cyan-300)' : ''}">${esc(plan.name)}</p>
      <h3 class="card__title">${esc(plan.tagline)}</h3>
    </div>
    <p style="font-size:1.75rem;font-weight:800;letter-spacing:-.045em;line-height:1.1" data-price data-ngn="${plan.ngn ?? ''}">${esc(amount)}</p>
    <p style="font-size:var(--fs-xs);color:${plan.featured ? '#93a1b8' : 'var(--text-3)'}">
      ${plan.ngn === null ? 'Scoped after a short discovery call.' : 'Starting price. Final quote follows scope.'}
    </p>
    <ul class="stack stack--sm" style="flex:1">
      ${plan.includes
        .map(
          (item) =>
            `<li style="display:flex;gap:.6rem;font-size:var(--fs-sm);color:${plan.featured ? '#c5d0e5' : 'var(--text-2)'};line-height:1.6">
               <span aria-hidden="true" style="color:${plan.featured ? 'var(--cyan-300)' : 'var(--accent)'}">✓</span>
               <span>${esc(item)}</span>
             </li>`
        )
        .join('')}
    </ul>
    <a class="btn ${plan.featured ? 'btn--invert' : 'btn--quiet'} btn--block" href="contact.html?plan=${encodeURIComponent(plan.id)}">
      ${esc(plan.cta)} <span class="btn__icon" aria-hidden="true">→</span>
    </a>
  </article>`;
}

export function initServices() {
  const grid = $('[data-pricing]');
  if (!grid) return;

  let currency = store.get(KEY, CURRENCY.default);
  if (!CURRENCY.format[currency]) currency = CURRENCY.default;

  const paint = () => {
    grid.innerHTML = PLANS.map((plan) => renderPlan(plan, currency)).join('');
    $$('[data-currency] button').forEach((btn) => {
      const on = btn.dataset.currency === currency;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', String(on));
    });
  };

  $$('[data-currency] button').forEach((btn) => {
    btn.addEventListener('click', () => {
      currency = btn.dataset.currency;
      store.set(KEY, currency);
      paint();
    });
  });

  paint();

  // Deep link from the pricing CTA on the home page.
  const hash = location.hash.replace('#', '');
  if (hash && PLANS.some((p) => p.id === hash)) {
    const card = grid.children[PLANS.findIndex((p) => p.id === hash)];
    card?.scrollIntoView({ block: 'center' });
  }
}
