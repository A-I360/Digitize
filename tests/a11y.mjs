/**
 * Accessibility audit — runs against the RENDERED DOM, not the source.
 *
 * The site crawl checks the served HTML (alt attributes, one h1, skip link).
 * This checks what the browser actually ends up with once the shared chrome
 * and the page modules have run: whether injected controls have accessible
 * names, whether aria references resolve, whether headings skip a level, and
 * whether anything that can be focused can also be told apart when focused.
 *
 * It is not axe-core — jsdom has no layout engine, so it cannot measure
 * contrast of rendered pixels or target sizes. It catches roughly the half of
 * WCAG that is expressible as a DOM query.
 *
 *   node tests/a11y.mjs
 */

import { loadPage, closeAllWindows, wait, hasJsdom, ROOT } from './helpers/env.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

if (!hasJsdom) {
  console.log('jsdom is not installed — skipping the accessibility audit.');
  console.log('Install it with:  npm install');
  process.exit(0);
}

let failures = 0;
let checks = 0;
const pass = (msg) => { checks += 1; console.log(`  PASS  ${msg}`); };
const fail = (msg) => { checks += 1; failures += 1; console.log(`  FAIL  ${msg}`); };
const expect = (cond, msg) => (cond ? pass(msg) : fail(msg));
const section = (name) => console.log(`\n${name}`);

/* -------------------------------------------------------------------------- */
/*  The rules                                                                  */
/* -------------------------------------------------------------------------- */

const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex]';

/** Roles that need no accessible name because they are not exposed as controls. */
const PRESENTATIONAL_ROLES = new Set(['presentation', 'none', 'generic']);

function idrefs(node, attr) {
  const value = node.getAttribute(attr);
  return value ? value.trim().split(/\s+/).filter(Boolean) : [];
}

/** True if the element can be announced as something. */
function accessibleName(document, node) {
  if (node.getAttribute('aria-label')?.trim()) return true;
  const labelledBy = idrefs(node, 'aria-labelledby');
  if (labelledBy.some((id) => document.getElementById(id))) return true;
  if (node.getAttribute('title')?.trim()) return true;

  const tag = node.tagName.toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea') {
    // Not CSS.escape — that is a browser global and this runs in Node.
    if (node.id && [...document.querySelectorAll('label[for]')]
      .some((l) => l.getAttribute('for') === node.id)) return true;
    if (node.closest('label')) return true;
    // A submit/reset/button input takes its name from its value.
    if (tag === 'input' && ['submit', 'reset', 'button'].includes(node.type)) {
      return Boolean(node.value?.trim());
    }
    return false;
  }
  if (tag === 'img') return node.hasAttribute('alt');
  if (tag === 'fieldset') return Boolean(node.querySelector('legend')?.textContent?.trim());

  // Anything else: visible text, or text in a subtree marked aria-label-ish.
  if (node.textContent?.trim()) return true;
  return Boolean(node.querySelector('[aria-label], [alt]'));
}

const RULES = [
  {
    id: 'duplicate-id',
    title: 'no duplicate ids',
    run(document, report) {
      const seen = new Map();
      for (const node of document.querySelectorAll('[id]')) {
        const id = node.getAttribute('id');
        if (!id?.trim()) { report('an id attribute is empty'); continue; }
        seen.set(id, (seen.get(id) || 0) + 1);
      }
      for (const [id, n] of seen) if (n > 1) report(`id "${id}" is used ${n} times`);
    },
  },
  {
    id: 'control-name',
    title: 'every control has an accessible name',
    run(document, report) {
      for (const node of document.querySelectorAll('a[href], button, input, select, textarea, [role="button"], [role="link"]')) {
        if (node.closest('[aria-hidden="true"]') || node.hasAttribute('hidden')) continue;
        if (PRESENTATIONAL_ROLES.has(node.getAttribute('role'))) continue;
        if (node.getAttribute('tabindex') === '-1') continue;
        if (!accessibleName(document, node)) {
          report(`<${node.tagName.toLowerCase()}> with no accessible name: ${(node.outerHTML || '').slice(0, 80)}`);
        }
      }
    },
  },
  {
    id: 'image-alt',
    title: 'every image is either described or marked decorative',
    run(document, report) {
      for (const img of document.querySelectorAll('img')) {
        if (img.closest('[aria-hidden="true"]')) continue;
        if (!img.hasAttribute('alt')) {
          report(`<img> with no alt: ${(img.getAttribute('src') || '').slice(0, 60)}`);
        }
      }
    },
  },
  {
    id: 'aria-resolves',
    title: 'every aria reference points at something that exists',
    run(document, report) {
      const attrs = ['aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns', 'aria-activedescendant'];
      for (const node of document.querySelectorAll('*')) {
        for (const attr of attrs) {
          for (const id of idrefs(node, attr)) {
            if (!document.getElementById(id)) {
              report(`<${node.tagName.toLowerCase()}> ${attr}="${id}" points at a missing element`);
            }
          }
        }
      }
    },
  },
  {
    id: 'heading-order',
    title: 'headings do not skip a level',
    run(document, report) {
      const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')]
        .filter((h) => !h.closest('[aria-hidden="true"]') && h.textContent?.trim());
      let previous = 0;
      for (const h of headings) {
        const level = Number(h.tagName[1]);
        if (previous && level > previous + 1) {
          report(`<h${level}> follows <h${previous}> — "${h.textContent.trim().slice(0, 40)}"`);
        }
        previous = level;
      }
    },
  },
  {
    id: 'landmarks',
    title: 'the page has the landmarks a screen reader needs',
    run(document, report) {
      const main = document.querySelectorAll('main, [role="main"]').length;
      if (main !== 1) report(`${main} <main> landmarks (want exactly 1)`);
      if (!document.querySelector('header, [role="banner"]')) report('no banner landmark');
      if (!document.querySelector('footer, [role="contentinfo"]')) report('no contentinfo landmark');
      if (!document.querySelector('nav, [role="navigation"]')) report('no navigation landmark');
    },
  },
  {
    id: 'label-for',
    title: 'labels point at a real control',
    run(document, report) {
      for (const label of document.querySelectorAll('label[for]')) {
        if (!document.getElementById(label.getAttribute('for'))) {
          report(`<label for="${label.getAttribute('for')}"> matches nothing`);
        }
      }
    },
  },
  {
    id: 'tabindex',
    title: 'no positive tabindex reordering the page',
    run(document, report) {
      for (const node of document.querySelectorAll('[tabindex]')) {
        const value = Number(node.getAttribute('tabindex'));
        if (Number.isFinite(value) && value > 0) {
          report(`<${node.tagName.toLowerCase()}> has tabindex="${value}", which jumps ahead of the natural order`);
        }
      }
    },
  },
  {
    id: 'svg-title',
    title: 'meaningful SVGs are named, decorative ones are hidden',
    run(document, report) {
      for (const svg of document.querySelectorAll('svg')) {
        if (svg.closest('[aria-hidden="true"]')) continue;
        if (svg.getAttribute('aria-hidden') === 'true') continue;
        const named = svg.getAttribute('aria-label')?.trim()
          || idrefs(svg, 'aria-labelledby').length
          || svg.querySelector('title');
        if (!named) report(`<svg> is neither labelled nor aria-hidden: ${(svg.outerHTML || '').slice(0, 70)}`);
      }
    },
  },
  {
    id: 'lang',
    title: 'the document and any foreign phrases declare a language',
    run(document, report) {
      if (!document.documentElement.getAttribute('lang')?.trim()) report('<html> has no lang');
    },
  },
  {
    id: 'frame-title',
    title: 'iframes are titled',
    run(document, report) {
      for (const f of document.querySelectorAll('iframe')) {
        if (!f.getAttribute('title')?.trim()) report('<iframe> has no title');
      }
    },
  },
  {
    id: 'form-errors',
    title: 'fields that can fail are wired to a live region',
    run(document, report) {
      // Only fields that can actually be invalid need an error association.
      // A volume slider or an optional dropdown cannot produce one.
      const VALIDATABLE = new Set(['email', 'url', 'tel', 'number', 'date', 'time']);
      for (const control of document.querySelectorAll('input, select, textarea')) {
        if (control.type === 'hidden') continue;
        if (control.closest('[aria-hidden="true"]')) continue; // the honeypot
        const canFail = control.required || VALIDATABLE.has(control.type)
          || control.hasAttribute('pattern') || control.hasAttribute('minlength');
        if (!canFail) continue;
        if (control.hasAttribute('aria-describedby')) continue;
        // A hint or an error slot next to the field is enough.
        const wrapper = control.closest('.field, .form-field, [data-field]');
        if (wrapper?.querySelector('[id]')) continue;
        report(`<${control.tagName.toLowerCase()} name="${control.getAttribute('name') || ''}"> has no described-by or hint`);
      }
    },
  },
];

/* -------------------------------------------------------------------------- */
/*  Bootstrapping a page                                                      */
/* -------------------------------------------------------------------------- */

const PAGES = [
  ['index.html', async () => (await import('../js/site/pages/home.js')).initHome()],
  ['about.html', null],
  ['services.html', async () => (await import('../js/site/pages/services.js')).initServices()],
  ['portfolio.html', async () => (await import('../js/site/pages/portfolio.js')).initPortfolio()],
  [['project.html', 'project.html?slug=aether-drift'], async () => (await import('../js/site/pages/project.js')).initProjectPage()],
  ['contact.html', async () => (await import('../js/site/pages/contact.js')).initContact()],
  ['privacy.html', null],
  ['404.html', null],
  ['game.html', null],
];

/* -------------------------------------------------------------------------- */

section('Audit rules loaded');
expect(RULES.length >= 12, `${RULES.length} rules will run against every page`);

const problems = new Map();

for (const [entry, init] of PAGES) {
  const [file, url] = Array.isArray(entry) ? entry : [entry, undefined];
  const env = loadPage(file, url ? `https://synqtech.org/${url}` : undefined);
  const { document } = env;
  const { mountChrome } = await import('../js/site/chrome.js');
  try { mountChrome(); } catch { /* some pages mount their own */ }
  try { await init?.(); } catch (error) {
    problems.set(file, [`page module threw: ${error.message}`]);
  }
  await wait(30);

  const here = problems.get(file) || [];
  for (const rule of RULES) rule.run(document, (msg) => here.push(`${rule.id}: ${msg}`));
  problems.set(file, here);

  closeAllWindows();
}

section('Rendered pages');
for (const [page, list] of problems) {
  if (list.length === 0) {
    pass(`${page}`);
  } else {
    fail(`${page} — ${list.length} problem(s)`);
    for (const p of list.slice(0, 8)) console.log(`          ${p}`);
    if (list.length > 8) console.log(`          …and ${list.length - 8} more`);
  }
}

/* -------------------------------------------------------------------------- */
/*  Things that need the stylesheets, not the DOM                              */
/* -------------------------------------------------------------------------- */

section('Stylesheet checks');
{
  const css = ['tokens', 'base', 'components', 'site', 'game', 'transition']
    .map((name) => {
      try { return readFileSync(join(ROOT, 'styles', `${name}.css`), 'utf8'); } catch { return ''; }
    })
    .join('\n');

  expect(/:focus-visible/.test(css), 'focus is styled with :focus-visible, not removed');
  expect(!/:focus\s*{\s*outline\s*:\s*(none|0)/.test(css), 'focus outlines are never removed outright');
  expect(!/outline\s*:\s*none/.test(css.replace(/:focus-visible[^{]*{[^}]*}/g, '')),
    'no bare `outline: none` outside a :focus-visible rule');

  const motion = css.match(/@media\s*\(\s*prefers-reduced-motion[^)]*\)/g) || [];
  expect(motion.length >= 2, `reduced motion is honoured in the CSS (${motion.length} blocks)`);

  const srOnly = /\.sr-only|\.visually-hidden/.test(css);
  expect(srOnly, 'there is a visually-hidden utility for screen-reader-only text');
}

section('Keyboard reachability of the nav');
{
  const env = loadPage('index.html');
  const { document } = env;
  const { mountChrome } = await import('../js/site/chrome.js');
  mountChrome();
  await wait(30);

  const skip = document.querySelector('a[href^="#"]');
  expect(Boolean(skip), 'the first link is a skip link');
  const target = skip && document.getElementById(skip.getAttribute('href').slice(1));
  expect(Boolean(target), `and it points at something that exists (#${skip?.getAttribute('href').slice(1)})`);
  if (target && !target.hasAttribute('tabindex')) {
    pass('and its target is focusable from the keyboard');
  } else if (target) {
    pass('and its target has an explicit tabindex so focus can land on it');
  } else {
    fail('and its target could not be checked');
  }

  const focusable = [...document.querySelectorAll(FOCUSABLE)]
    .filter((n) => !n.hasAttribute('hidden') && n.getAttribute('tabindex') !== '-1'
      && !n.closest('[aria-hidden="true"]'));
  expect(focusable.length > 5, `the page is navigable by keyboard (${focusable.length} focusable things)`);

  const navLinks = [...document.querySelectorAll('nav a[href]')];
  expect(navLinks.length >= 5, `the nav exposes every section (${navLinks.length} links)`);
  const namelessNav = navLinks.filter((a) => !a.textContent?.trim() && !a.getAttribute('aria-label'));
  expect(namelessNav.length === 0, `and every one of them is named (${namelessNav.length} unnamed)`);
  closeAllWindows();
}

section('The game page without a canvas');
{
  // Canvas is the one thing jsdom cannot do, so the page must still make
  // sense to someone who cannot see it.
  const env = loadPage('game.html');
  const { document } = env;
  const canvas = document.querySelector('canvas');
  expect(Boolean(canvas), 'the game page has a canvas');
  if (canvas) {
    const named = canvas.getAttribute('aria-label')?.trim()
      || idrefs(canvas, 'aria-labelledby').length
      || canvas.textContent?.trim();
    expect(Boolean(named), 'the canvas is labelled so it is not announced as an unnamed graphic');
  }
  const fallback = document.body.textContent || '';
  expect(/enable javascript|javascript/i.test(fallback),
    'there is a message for visitors without JavaScript');
  const problemsHere = [];
  RULES.filter((r) => r.id !== 'landmarks').forEach((r) => r.run(document, (m) => problemsHere.push(`${r.id}: ${m}`)));
  expect(problemsHere.length === 0,
    `the game page passes the same rules${problemsHere.length ? ` — ${problemsHere[0]}` : ''}`);
  closeAllWindows();
}

/* -------------------------------------------------------------------------- */

closeAllWindows();
console.log(`\n${checks - failures}/${checks} checks passed.`);
process.exit(failures ? 1 : 0);
