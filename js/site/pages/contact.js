/**
 * Contact form.
 *
 * Honest by design: if no endpoint is configured the form says so and hands
 * the enquiry over through a working channel (WhatsApp / email) instead of
 * showing a fake success message. When an endpoint IS configured the form
 * reports the real outcome of the request.
 *
 * Server-side contract for POST {endpoint}:
 *   request  JSON { name, email, projectType, budget, message, website, elapsed }
 *   success  2xx  → { ok: true,  message?: string }
 *   failure  4xx/5xx or network error → surfaced verbatim to the visitor
 */

import { $, $$, esc, escAttr, prefersReducedMotion } from '../lib/dom.js';
import { CONTACT, SITE, CURRENCY } from '../config.js';

const BUDGETS = [
  { ngn: [70000, 150000], label: 'Entry — landing page or small site' },
  { ngn: [150000, 400000], label: 'Growth — multi-page site or web app' },
  { ngn: [400000, 1200000], label: 'Scale — platform, commerce or game' },
  { ngn: [1200000, null], label: 'Bespoke — let’s scope it together' },
];

function money(ngn, currency) {
  if (ngn === null) return '';
  return currency === 'USD' ? CURRENCY.format.USD(ngn / CURRENCY.nairaPerUsd) : CURRENCY.format.NGN(ngn);
}

function budgetLabel(b, currency) {
  const [lo, hi] = b.ngn;
  const loText = money(lo, currency);
  const hiText = hi ? money(hi, currency) : `${money(lo, currency)}+`;
  return hi ? `${loText} – ${hiText}` : hiText;
}

export function renderBudgetOptions() {
  const selects = $$('[data-budget]');
  const currency = CURRENCY.default;
  selects.forEach((select) => {
    select.innerHTML =
      `<option value="" disabled selected>Select a range</option>` +
      BUDGETS.map(
        (b) =>
          `<option value="${escAttr(b.label)} — ${escAttr(budgetLabel(b, currency))}">${esc(
            budgetLabel(b, currency)
          )} · ${esc(b.label)}</option>`
      ).join('');
  });
}

/* -------------------------------------------------------------------------- */

const VALIDATORS = {
  name: (v) => (v.trim().length >= 2 ? '' : 'Please enter your name (at least 2 characters).'),
  email: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ? '' : 'Please enter a valid email address.'),
  projectType: (v) => (v ? '' : 'Please choose a project type.'),
  message: (v) => (v.trim().length >= 12 ? '' : 'Please tell us a little more — at least 12 characters.'),
};

function fieldOf(input) {
  return input.closest('.field');
}

function setError(input, message) {
  const field = fieldOf(input);
  if (!field) return;
  const slot = field.querySelector('.field__error');
  field.classList.toggle('has-error', Boolean(message));
  input.setAttribute('aria-invalid', message ? 'true' : 'false');
  if (slot) slot.textContent = message || '';
}

function validate(form, { silent = false } = {}) {
  let firstInvalid = null;
  Object.entries(VALIDATORS).forEach(([name, fn]) => {
    const input = form.elements[name];
    if (!input) return;
    const message = fn(input.value || '');
    if (!silent) setError(input, message);
    if (message && !firstInvalid) firstInvalid = input;
  });
  return firstInvalid;
}

function status(node, kind, message) {
  if (!node) return;
  node.className = `form-status is-visible form-status--${kind}`;
  node.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  node.innerHTML = `<span aria-hidden="true">${kind === 'ok' ? '✓' : kind === 'error' ? '✕' : '⚠'}</span><span>${message}</span>`;
}

function buildHandoffUrl(data) {
  const lines = [
    `Hi ${SITE.name}, I would like to start a project.`,
    `Name: ${data.name}`,
    `Email: ${data.email}`,
    `Project type: ${data.projectType}`,
    data.budget ? `Budget: ${data.budget}` : null,
    data.message ? `Details: ${data.message}` : null,
  ].filter(Boolean);
  return `https://wa.me/${SITE.whatsapp}?text=${encodeURIComponent(lines.join('\n'))}`;
}

export function initContact() {
  const form = $('[data-contact-form]');
  if (!form) return;

  renderBudgetOptions();
  const statusNode = $('[data-form-status]', form) || form.querySelector('.form-status');
  const startedAt = Date.now();

  // Clear an error as soon as the visitor starts fixing it.
  Object.keys(VALIDATORS).forEach((name) => {
    const input = form.elements[name];
    input?.addEventListener('input', () => {
      if (fieldOf(input)?.classList.contains('has-error')) setError(input, '');
    });
    input?.addEventListener('blur', () => {
      const message = VALIDATORS[name](input.value || '');
      if (message && input.value) setError(input, message);
    });
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const data = {
      name: form.elements.name.value.trim(),
      email: form.elements.email.value.trim(),
      projectType: form.elements.projectType?.value || '',
      budget: form.elements.budget?.value || '',
      message: form.elements.message.value.trim(),
    };

    const invalid = validate(form);
    if (invalid) {
      invalid.focus({ preventScroll: true });
      // scrollIntoView is universal in browsers but not in every DOM
      // implementation; scrolling is a nicety, not a requirement.
      invalid.scrollIntoView?.({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      status(statusNode, 'error', 'Please fix the highlighted fields and try again.');
      return;
    }

    // Spam heuristics: honeypot must be empty, and a human needs a few seconds.
    const honeypot = form.elements.website?.value || '';
    const elapsed = Date.now() - startedAt;
    if (honeypot || elapsed < 2500) {
      status(
        statusNode,
        'error',
        'This submission looked automated. Please try again, or reach us directly on WhatsApp or email.'
      );
      return;
    }

    const submit = form.querySelector('[data-submit]');
    const originalLabel = submit?.dataset.label || submit?.textContent;
    if (submit) {
      submit.disabled = true;
      submit.textContent = 'Sending…';
    }
    status(statusNode, 'warn', 'Sending your enquiry…');

    /* ---- No backend configured: honest hand-off ------------------------ */
    if (!CONTACT.endpoint) {
      const url = buildHandoffUrl(data);
      const win = window.open(url, '_blank', 'noopener,noreferrer');
      if (submit) {
        submit.disabled = false;
        submit.textContent = originalLabel;
      }

      status(
        statusNode,
        'warn',
        win
          ? `No email service is connected to this site yet, so we opened WhatsApp with your details ready to send.
             Press send there — or email <a href="mailto:${escAttr(SITE.email)}">${esc(SITE.email)}</a>.`
          : `We could not open WhatsApp (your browser blocked the new tab). Please email
             <a href="mailto:${escAttr(SITE.email)}">${esc(SITE.email)}</a> or message
             ${esc(SITE.phoneDisplay)} — your details are still in the form.`
      );
      return;
    }

    /* ---- Real endpoint ------------------------------------------------- */
    try {
      const response = await fetch(CONTACT.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ ...data, website: honeypot, elapsed }),
      });

      if (!response.ok) throw new Error(`Server responded ${response.status}`);

      const payload = await response.json().catch(() => ({}));
      form.reset();
      validate(form, { silent: true });
      status(statusNode, 'ok', payload.message || `Thanks ${esc(data.name)} — your enquiry is with us. We reply ${SITE.responseTime}.`);
    } catch (error) {
      status(
        statusNode,
        'error',
        `We could not send that (${esc(error.message)}). Nothing was lost — please email
         <a href="mailto:${escAttr(SITE.email)}">${esc(SITE.email)}</a> or message ${esc(SITE.phoneDisplay)} on WhatsApp.`
      );
    } finally {
      if (submit) {
        submit.disabled = false;
        submit.textContent = originalLabel;
      }
    }
  });
}
