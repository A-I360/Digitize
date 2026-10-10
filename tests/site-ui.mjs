/**
 * Site UI test — the parts a visitor interacts with on the marketing pages.
 *
 * Focused on the honesty claims the site makes about itself: the contact form
 * must never claim to have sent something it did not send, sample projects must
 * be labelled, and the currency switcher must not invent numbers.
 *
 *   node tests/site-ui.mjs
 */

import { loadPage, closeAllWindows, wait, hasJsdom } from './helpers/env.mjs';
import { CONTACT, CURRENCY, SITE } from '../js/site/config.js';
import { PROJECTS } from '../js/site/data/projects.js';

if (!hasJsdom) {
  console.log('jsdom is not installed — skipping the site UI test.');
  console.log('Install it with:  npm install');
  process.exit(0);
}

let failures = 0;
let checks = 0;
const pass = (msg) => { checks += 1; console.log(`  PASS  ${msg}`); };
const fail = (msg) => { checks += 1; failures += 1; console.log(`  FAIL  ${msg}`); };
const expect = (cond, msg) => (cond ? pass(msg) : fail(msg));
const section = (name) => console.log(`\n${name}`);

const consoleErrors = [];
const realError = console.error;
console.error = (...args) => { consoleErrors.push(args.join(' ')); realError(...args); };

const submit = (form) => form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

/** Fills the contact form with a plausible enquiry. */
function fillContact(document, overrides = {}) {
  const fields = {
    name: 'Ada Nwosu',
    email: 'ada@example.com',
    message: 'We need a booking site with payments and an admin calendar.',
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) {
    const el = document.querySelector(`[name="${key}"]`);
    if (el) el.value = value;
  }
  // `projectType` is a required <select> whose first option is a placeholder.
  const type = document.querySelector('[name="projectType"]');
  if (type && !type.value) {
    const real = [...type.options].find((o) => o.value);
    if (real) type.value = real.value;
  }
}

/* -------------------------------------------------------------------------- */

section('Contact form — validation');
{
  const env = loadPage('contact.html');
  const { document, window } = env;
  const { initContact } = await import('../js/site/pages/contact.js');
  initContact();
  await wait(30);

  const form = document.querySelector('form');
  expect(Boolean(form), 'the contact page has a form');

  const statusNode = document.querySelector('[data-form-status], .form-status');
  expect(Boolean(statusNode), 'and somewhere to report what happened');

  submit(form);
  await wait(30);
  expect(/fix the highlighted/i.test(statusNode.textContent || ''),
    'submitting an empty form explains that fields need fixing');
  const marked = document.querySelectorAll('.field.has-error, [aria-invalid="true"]').length;
  expect(marked > 0, `and marks the offending fields (${marked})`);
  expect(!/thank|sent|received/i.test(statusNode.textContent || ''),
    'and never claims success');

  fillContact(document, { email: 'not-an-email' });
  submit(form);
  await wait(30);
  expect(/fix the highlighted/i.test(statusNode.textContent || ''),
    'a malformed email is rejected before anything is sent');
}

section('Contact form — no endpoint configured');
{
  if (CONTACT.endpoint) {
    console.log('  skip  an endpoint is configured; the hand-off path is not reachable');
  } else {
    const env = loadPage('contact.html');
    const { document, window } = env;
    const { initContact } = await import('../js/site/pages/contact.js');
    initContact();
    await wait(30);

    const opened = [];
    window.open = (url) => { opened.push(url); return { closed: false }; };

    const form = document.querySelector('form');
    fillContact(document);
    // The form's own anti-bot check needs a few seconds of elapsed time.
    const before = Date.now();
    while (Date.now() - before < 2600) await wait(200);

    submit(form);
    await wait(80);

    const statusNode = document.querySelector('[data-form-status], .form-status');
    const text = statusNode?.textContent || '';
    expect(opened.length === 1, `it opens the hand-off exactly once (${opened.length})`);
    expect(/wa\.me/.test(opened[0] || ''), 'the hand-off goes to WhatsApp');
    expect(/Ada Nwosu/.test(decodeURIComponent(opened[0] || '')),
      'with the enquiry already written out for the visitor');
    expect(/no email service is connected/i.test(text),
      `it says plainly that no email service is connected ("${text.trim().slice(0, 70)}…")`);
    expect(!/thank you|we received|sent successfully/i.test(text),
      'and it does not claim the message was sent');
    expect(new RegExp(SITE.email.replace(/[.@]/g, '\\$&')).test(text),
      'it offers the real email address as an alternative');
  }
}

section('Contact form — with an endpoint configured');
{
  // Point the module at the real bundled endpoint and let it talk to it.
  const env = loadPage('contact.html');
  const { document } = env;
  const { initContact } = await import('../js/site/pages/contact.js');

  const calls = [];
  env.window.fetch = (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body || '{}') });
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ok: true, message: 'Thanks Ada — your enquiry is with us.' }),
    });
  };
  globalThis.fetch = env.window.fetch;

  const config = await import('../js/site/config.js');
  const original = config.CONTACT.endpoint;
  config.CONTACT.endpoint = '/api/contact';
  initContact();
  await wait(30);

  const form = document.querySelector('form');
  fillContact(document);
  const before = Date.now();
  while (Date.now() - before < 2600) await wait(200);

  submit(form);
  await wait(80);

  const statusNode = document.querySelector('[data-form-status], .form-status');
  expect(calls.length === 1, `it posts once (${calls.length})`);
  expect(calls[0]?.url === '/api/contact', `to the configured endpoint (${calls[0]?.url})`);
  expect(calls[0]?.body?.email === 'ada@example.com', 'with the enquiry as JSON');
  expect(calls[0]?.body?.website === '' && typeof calls[0]?.body?.elapsed === 'number',
    'including the honeypot and timing fields the server checks');
  expect(/Thanks Ada/.test(statusNode?.textContent || ''),
    'and reports the server’s own success message');

  // A failing endpoint must be reported honestly, not as success.
  env.window.fetch = () => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
  globalThis.fetch = env.window.fetch;
  const form2 = document.querySelector('form');
  fillContact(document, { name: 'Bola Ade' });
  submit(form2);
  await wait(80);
  expect(/could not send/i.test(statusNode?.textContent || ''),
    'a failed submission says it failed');
  expect(/@|email/i.test(statusNode?.textContent || ''),
    'and offers a direct way to reach the studio instead');

  config.CONTACT.endpoint = original;
}

section('Portfolio honesty');
{
  const env = loadPage('portfolio.html');
  const { document } = env;
  const { initPortfolio } = await import('../js/site/pages/portfolio.js');
  initPortfolio();
  await wait(40);

  const cards = document.querySelectorAll('[data-work-grid] [data-project], [data-work-grid] .work-card');
  const samples = PROJECTS.filter((p) => p.sample).length;
  const flagged = document.querySelectorAll('.sample-flag').length;
  expect(flagged === samples,
    `every sample project is flagged in the grid (${flagged} flagged, ${samples} in the data)`);
  expect(cards.length >= PROJECTS.length,
    `every project in the data is rendered (${cards.length} cards for ${PROJECTS.length} projects)`);

  const sampleLinks = PROJECTS.filter((p) => p.sample).flatMap((p) => [p.liveUrl, p.sourceUrl]).filter(Boolean);
  expect(sampleLinks.length === 0,
    `no sample project claims a live or source link (${sampleLinks.length} found)`);
  const caseStudies = [...document.querySelectorAll('[data-work-grid] a[href*="project.html"]')];
  expect(caseStudies.length >= PROJECTS.length,
    `every project links through to its case study (${caseStudies.length})`);

  // Filtering must not silently drop the honesty flags.
  const filters = [...document.querySelectorAll('[data-filters] button')];
  const games = filters.find((b) => /game/i.test(b.textContent || ''));
  if (games) {
    games.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await wait(60);
    const shown = document.querySelectorAll('[data-work-grid] [data-project], [data-work-grid] .work-card').length;
    const expected = PROJECTS.filter((p) => p.category === 'games').length;
    expect(shown === expected, `the Games filter shows exactly the game projects (${shown}/${expected})`);
  }
}

section('Pricing');
{
  const env = loadPage('services.html');
  const { document } = env;
  const { initServices } = await import('../js/site/pages/services.js');
  try { initServices(); } catch { /* the page may not need it */ }
  await wait(40);

  const text = document.body.textContent || '';
  expect(/₦/.test(text), 'prices are shown in Naira by default');
  const buttons = [...document.querySelectorAll('[data-currency] button, [data-currency] [role="tab"], [data-currency-set]')];
  expect(buttons.length > 0, `a currency switch is offered (${buttons.length} control(s))`);

  if (buttons.length) {
    buttons.find((b) => /usd|\$/i.test(b.textContent || ''))
      ?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await wait(80);
    const after = document.body.textContent || '';
    expect(/\$/.test(after), 'switching shows prices in US Dollars');
    // Both currencies must derive from the same single rate.
    const naira = new Set([...(text.match(/₦([\d,]+)/g) || [])].map((m) => Number(m.replace(/[₦,]/g, ''))));
    const dollars = [...(after.match(/\$([\d,]+)/g) || [])].map((m) => Number(m.replace(/[$,]/g, '')));
    const matched = dollars.filter((d) => {
      const expected = Math.round(d * CURRENCY.nairaPerUsd);
      // Allow for rounding to the nearest thousand in either currency.
      return [...naira].some((n) => Math.abs(n - expected) <= Math.max(1000, expected * 0.01));
    });
    expect(dollars.length > 0 && matched.length === dollars.length,
      `and every dollar figure is the same price at ${CURRENCY.nairaPerUsd} Naira (${matched.length}/${dollars.length})`);
  }
}

section('Theme');
{
  const env = loadPage('index.html');
  const { document, window } = env;
  const { mountChrome } = await import('../js/site/chrome.js');
  mountChrome();
  const { initTheme } = await import('../js/site/theme.js');
  initTheme();
  await wait(30);

  const root = document.documentElement;
  const startDark = root.classList.contains('dark');
  const toggle = document.querySelector('[data-theme-toggle]');
  expect(Boolean(toggle), 'a theme control exists');
  toggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await wait(30);
  expect(root.classList.contains('dark') !== startDark, 'clicking it flips the theme');
  expect(root.classList.contains('light') !== root.classList.contains('dark'),
    'and exactly one of light/dark is set');
  // Read back through the same storage wrapper the theme module uses: it
  // namespaces its keys, and each jsdom window has its own localStorage.
  const { store } = await import('../js/site/lib/storage.js');
  const stored = store.get('theme');
  expect(stored === 'dark' || stored === 'light', `the choice is persisted (${stored})`);
  expect(toggle.getAttribute('aria-pressed') !== null || /theme/i.test(toggle.getAttribute('aria-label') || ''),
    'and the control is described for assistive technology');
}

/* -------------------------------------------------------------------------- */

console.error = realError;
expect(consoleErrors.length === 0,
  `no console errors across the site flows${consoleErrors.length ? ` — ${consoleErrors[0]}` : ''}`);

closeAllWindows();
console.log(`\n${checks - failures}/${checks} checks passed.`);
process.exit(failures ? 1 : 0);
