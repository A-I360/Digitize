# Site Review — SYNQ Technological Services

**Reviewed:** 2026-10-10 · **Commit:** `d811d19` · **Branch:** `arena/9232c6e8-digitize`
**Scope:** `index.html` (21 KB), `styles.css` (33 KB), `script.js` (9 KB), `under-construction.html`, `assets/`

The site is live in the preview pane (served from the repo root on port 8080) if you want to click along while reading.

---

## Verdict

A genuinely good-looking single-page marketing site. The visual design is cohesive, the dark mode is
thoughtful, the copy is confident, and the CSS craft (3D buttons, tilt cards, mock app window, neural
canvas) is well above average for a hand-rolled landing page. Semantics and the heading outline are
correct, and there is real attention to accessibility in places (skip link, `aria-pressed`,
`aria-live`, `prefers-reduced-motion`).

But it is **not production-ready yet**. Three classes of issue hold it back:

1. **It degrades badly when JavaScript is unavailable or errors** — most of the page is invisible, and
   one unguarded `localStorage` call can kill the whole script.
2. **Dark mode is incomplete** — several text colours were never re-mapped and fail contrast badly.
3. **The trust signals are placeholders** — third-party stranger avatars, invented client logos, and
   social links that all point at an "under construction" page. On a premium agency site this actively
   costs you business.

There are also a handful of small, real bugs (anchor jumps hidden behind the nav, a keyboard-focusable
button inside `role="img"`, a currency switcher that misses the budget dropdown) that are cheap to fix.

**Estimated effort to production-ready: 1–2 focused days.** Nothing here is architectural.

---

## What I checked

Static analysis of all source files, plus: WCAG 2.1 contrast ratios computed for ~55 foreground/
background pairs in both themes, HTML5 parse validation (`html5lib`, strict), JS syntax check
(`node --check`), CSS class-usage diff (defined vs. used), DOM/ARIA audit via a parsed DOM tree,
PNG header + pixel analysis of every asset, and HTTP serving of every resource.

⚠️ **Caveat:** no browser is installable in this sandbox (Playwright's CDN is network-blocked), so
everything below is derived from code analysis. Items marked **[unverified]** are strong inferences
from the CSS/HTML that you should confirm at that viewport in a real browser. They are called out
explicitly rather than stated as fact.

---

## 🔴 Critical — fix before launch

### C1. Without JavaScript, most of the page is invisible
`styles.css` sets `.reveal { opacity: 0 }` and `script.js` adds `.visible` via `IntersectionObserver`.
There are **40 `.reveal` elements** — essentially every section heading, card, and the contact form.
If JS fails to load, is blocked, or `IntersectionObserver` is unsupported, the visitor gets a page with
a hero and a lot of white space. There is no `<noscript>` fallback.

```html
<noscript><style>.reveal{opacity:1 !important;transform:none !important}</style></noscript>
```
Better: make it fail-safe by default — add `.visible` styling as the base and have JS *add* a
`js-reveal` class to `<html>` that opts into the hidden state.

### C2. One `localStorage` exception breaks the entire script
`script.js` calls `localStorage.getItem('synq-theme')` at top level with no `try/catch`. In Safari
private mode, Firefox strict tracking protection, and **any cross-origin iframe with third-party
storage blocked** (which includes many preview/embed environments), this throws `SecurityError`.
Because it is top-level and unguarded, execution stops there: no mobile menu, no theme toggle, no
currency switcher, no back-to-top — *and* (see C1) no content reveals.

```js
const store = {
  get(k){ try { return localStorage.getItem(k); } catch { return null; } },
  set(k,v){ try { localStorage.setItem(k,v); } catch {} },
};
```

### C3. Dark mode leaves several texts near-invisible
Measured contrast ratios (WCAG AA needs **4.5:1** for body text):

| Element | Dark colours | Ratio | |
|---|---|---|---|
| `.hero-proof strong` "across 12 countries" | `#222` on `#0d1525` | **1.15:1** | invisible |
| `.screen-nav b` "Overview" | `#252e3c` on `#0f1728` | **1.31:1** | invisible |
| `.code-card code` | `#4c5668` on `#121c2e` | **2.31:1** | fails |
| `.code-card code span` | `#0b5fff` on `#121c2e` | **3.33:1** | fails |
| `.eyebrow` (all sections, 11 px) | `#687080` on `#0d1525` | **3.66:1** | fails |
| `.price-card > p` on featured card | `#0b5fff` on `#0a1120` | **3.68:1** | fails |
| `.process-list b` / `.stats b` | `#0b5fff` on dark | **3.1–3.6:1** | fails |

The `.eyebrow` one is the tell: `body.dark .section-heading > p:not(.eyebrow)` explicitly excludes
eyebrows, but no dark-mode `.eyebrow` rule exists outside `.why-copy`, `.tech` and `.contact-copy`.

### C4. Anchor navigation hides section headings behind the fixed nav
The nav is `position: fixed; top: 14px` (78 px tall overall) and there is **no `scroll-margin-top`
anywhere in the CSS**. Every in-page link (`#services`, `#pricing`, …) scrolls its target to the very
top of the viewport, where the nav sits on top of it.

```css
:root { scroll-padding-top: 96px; }          /* fixes all anchors at once */
```

### C5. Keyboard-trap: focusable `<button>Export</button>` inside `role="img"`
`index.html:41` wraps the whole hero illustration in `role="img"`, which makes all descendants
presentational — they are hidden from assistive tech. But `index.html:45` contains a real `<button>`
in the mock UI. It stays in the tab order, so a keyboard user tabs into a control that screen readers
cannot announce or describe.

Fix: `disabled` + `aria-hidden="true"` on it, or replace it with a `<span>`.

### C6. Third-party stranger avatars in the hero
`index.html:39` loads `https://i.pravatar.cc/80?img=47|32|12` — three photographs of real people from
a public placeholder service, presented next to "Trusted by ambitious teams across 12 countries".
This is simultaneously a **privacy/consent problem**, a **credibility problem** (they are not your
clients), an **availability risk** (rate-limited third party in the critical rendering path), and a
**performance cost** (3 extra DNS/TLS handshakes). Replace with local assets or inline SVG initials.

---

## 🟠 High

### H1. Flash of wrong theme on every load
`script.js` is at the end of `<body>`, so the light palette paints first and the dark toggle applies
after. Move a 6-line inline script into `<head>` that sets the class before first paint. Same for the
currency (`From ₦70,000` is hardcoded and swaps to `$51` after load).

### H2. Native cursor is hidden on desktop
`styles.css:34` — `body.has-cursor, body.has-cursor a, body.has-cursor button { cursor: none }`.
This discards the user's OS cursor size/colour/invert settings, hurts users with motor or visual
impairments, and — inconsistently — *isn't* applied to `input, select, textarea, summary`, so the
custom cursor and the native I-beam coexist. Recommend dropping `cursor: none` and keeping the glow
as an accent that follows the real pointer.

### H3. Contact form loses data and lies when the popup is blocked
`script.js` calls `window.open(wa.me/…)`, then unconditionally sets "Opening WhatsApp with your
project details" and calls `form.reset()`. If a popup blocker intervenes (common — this is a
programmatic `window.open` from a submit handler), the user's typed enquiry is wiped and the page
tells them something false happened. Also: desktop visitors without a WhatsApp-linked phone hit a
dead end. Add a detected fallback (`if (!win) …`) and a `mailto:`/server endpoint alternative.

### H4. Fake social proof
- `logo-row` — "vertex / northstar / orbit / kinetic / ARCADIA / FORM" are invented companies.
- All three footer social links (LinkedIn, Instagram, Dribbble) point to `under-construction.html`.
- "4.9 average rating across 100+ client reviews" with no source, and three testimonials with no
  company names.

A premium studio page lives or dies on trust. Either ship real clients and real profile URLs, or
remove the logos and the rating strip — a smaller honest page outperforms a padded one.

### H5. Inconsistent numbers
- Currency switcher converts ₦70,000 → $51 (≈1372 ₦/$) but ₦150,000 → $99 (≈1515 ₦/$). Pick one rate.
- The **budget `<select>` is Naira-only** and does not follow the currency switcher — a US visitor
  choosing "$" still sees "₦70k – ₦100k".
- Stats are `0` in the DOM (`<b data-count="100">0</b>`), so crawlers and no-JS users see "0+
  projects". Put the real value in the HTML and animate up to it.

### H6. `[unverified]` Nav likely overflows between ~800 px and ~1050 px
The desktop nav (brand + 8 links + theme toggle + CTA) needs roughly 1000 px at 12 px font with
`gap: 24px`. The mobile layout only kicks in at `max-width: 800px`, and the 1200 px media query adds
`margin: 0 24px`. Around a 1000 px viewport there is ~50 px less room than the nav needs; `.nav` has
`height: 64px` and no wrap, so links will wrap onto two lines and spill. **Please confirm at 900 px.**
Fix by raising the mobile breakpoint to ~960 px, tightening `gap`, or dropping lower-value links.

---

## 🟡 Medium

- **Two permanent `requestAnimationFrame` loops.** The neural canvas does an O(n²) pass over 42 nodes
  (~860 pair checks) *every frame, forever* — even scrolled far off-screen — and the cursor ring has
  its own unconditional rAF loop. Gate both behind an `IntersectionObserver` + `document.hidden`.
- **Canvas is not DPR-aware and never resizes.** Fixed `width="640" height="570"` stretched by CSS to
  `100%` → visibly blurry on HiDPI and wrong aspect when the hero shrinks at ≤540 px.
- **Hero payload is dominated by oversized PNGs.** `assets/synq-logo.png` is 514×528 (106 KB) for a
  130 px footer slot; `synq-mark.png` is 194×276 (35 KB) for a 38 px nav slot; both are 4–6× larger
  than displayed. The favicon is 154×220 (23 KB) and **non-square**, so it renders squashed in the
  tab. Export at 2× display size, square favicon (32/180/512), and serve WebP/AVIF with PNG fallback.
  Images are ~168 KB of the 231 KB total — 73 % of page weight.
- **No image dimensions or lazy-loading.** No `width`/`height`, no `loading="lazy"`,
  `decoding="async"` → layout shift and no prioritisation hints.
- **Contact CTA buttons are visually broken by a specificity collision.**
  `.contact-copy > a` (specificity 0-1-1) beats `.btn-3d` (0-1-0), so the WhatsApp/Email buttons
  inherit `border-bottom: 1px solid #ffffff88` and `padding-bottom: 6px`, breaking the 3D effect.
  Worse, `.contact-copy > a span { color: #aaf8ff }` overrides `.btn-3d span { color: #023047 }`,
  putting the ↗ arrow at **1.48:1** against the cyan button — effectively invisible.
- **`.contact-inner::before` paints over the form.** `.contact-copy, .contact-form { z-index: 1 }` is
  inert because neither element is positioned, so the decorative 500 px circle overlays the heading
  and the form. Add `position: relative`.
- **`.fx-grid` overlays all page content.** `position: fixed; z-index: 0` puts it in the positioned
  layer, painting above every non-positioned element including body text. It is only 3 % opacity so
  it reads as haze, but it is wrong — use `z-index: -1`.
- **Menu button never updates its label.** `aria-label="Open menu"` stays "Open menu" when open.
  Toggle it, and consider moving focus into the panel and adding `inert` to the rest of the page.
- **Invalid HTML: three unescaped ampersands.** `index.html:84` "Launch **&** grow", `:92`
  "CMS **&** integrations", `:96` "Brand **&** UI/UX". Browsers recover, but `html5lib --strict`
  rejects the document ("Named entity expected") and XML tooling will break.
- **`<label>` misused as a badge.** `.price-card label` / `.testimonial.featured label` ("Most
  popular", "Most loved") — a `<label>` outside a form is announced misleadingly. Use `<span>`.
- **`+` glyph in `<summary>` is read aloud.** Mark the `<i>+</i>` `aria-hidden`; `<details>` already
  conveys state.
- **Newsletter form is decorative.** It clears the input and changes the placeholder with no network
  call, so subscribers are silently dropped. Wire it up or remove it.
- **Contact details duplicated 4×** across the contact section and footer — centralise or you will
  ship a stale phone number.
- **`prefers-reduced-motion` is sampled once at load** and never re-evaluated if the OS setting changes.

---

## 🟢 Low / polish

- **Dead CSS (~1.5 KB):** `.signal-bar`, `.signal-inner`, `.signal-feed`, `.pulse`, `.hero-terminal`,
  `.term-prompt`, `.term-caret`, `.contact-mail`, plus the `blink` and `radar` keyframes. Also
  `.footer-links .btn-3d` (`styles.css:82`) — the buttons live in `.footer-cta`, so it never matches.
  And `.btn-3d-wa` is an unused hook.
- **Duplicate/conflicting footer layout.** `footer .footer-main` is declared twice
  (`styles.css:1` and `:85`), `.footer-links` flips from `flex` to `grid` (`:1` vs `:89`), and
  `.newsletter { grid-column }` is set three times. The later "layer" silently wins; the earlier
  rules are dead weight that will confuse the next editor.
- **No design tokens.** `#0b5fff`, `#00d4ff`, `#0f172a`, `#e3e8f0` etc. are hardcoded dozens of times,
  which is *why* dark mode needs ~45 individual `body.dark` override rules. A `:root` custom-property
  layer would collapse that to ~10 lines.
- **Maintainability red flag:** `styles.css` line 1 is a **single 22 KB line** holding the entire base
  stylesheet. Every change to the base layer rewrites a 22 KB line, making diffs and code review
  effectively impossible. Run it through a formatter/prettifier once and commit.
- **Inconsistent cache-busting:** `styles.css?v=8`, `script.js?v=3`, images `?v=6` — stale relative to
  each other, and `under-construction.html` loads `styles.css` unversioned. Prefer content hashes via
  a build step, or drop the query strings.
- **Hardcoded `© 2026`** in the footer will go stale; and `.footer-bottom span:last-of-type` hides the
  copyright entirely below 540 px.
- **`role="img"` on the hero art** is heavy-handed for a container with that much decoration — simpler
  to mark the inner mock UI `aria-hidden` and keep the wrapper a plain `div`.
- **"LIVE · LATENCY 12ms"** is a fabricated live metric on a static page; it is the kind of detail a
  technical buyer notices.
- **`meta[name=theme-color]`** is updated by JS but never set for `color-scheme` in light mode
  (harmless, but add `<meta name="color-scheme" content="light dark">`).

---

## SEO & shareability — significant gap

A business landing page with **no social/share metadata at all**:

- No `<link rel="canonical">`
- No Open Graph (`og:title`, `og:description`, `og:image`, `og:url`, `og:type`, `og:site_name`)
- No Twitter/X card
- No `robots.txt`, no `sitemap.xml`
- No JSON-LD structured data — an `Organization` (or `LocalBusiness`, given the Lagos/Abuja/Port
  Harcourt client base) block plus `AggregateRating` would make you eligible for rich results
- `og:image` is the big one: every link shared on WhatsApp/LinkedIn/iMessage (your primary channels,
  judging by the CTAs) currently renders as a bare grey URL

Priority: `og:*` + `twitter:*` + canonical + a 1200×630 share image + `robots.txt`/`sitemap.xml`.
Roughly an hour of work for a large share-of-voice gain.

---

## Performance

| Resource | Size | Note |
|---|---:|---|
| `assets/synq-logo.png` | 106 KB | 514×528 for a 130 px slot |
| `assets/synq-mark.png` | 35 KB | 194×276 for a 38 px slot |
| `assets/favicon.png` | 23 KB | 154×220, non-square |
| `styles.css` | 33 KB | ~6 KB gzipped — fine |
| `index.html` | 21 KB | ~5 KB gzipped — fine |
| `script.js` | 9 KB | ~3 KB gzipped — fine |
| Google Fonts | ~60–120 KB | Manrope ×5 weights + DM Mono, render-blocking |
| pravatar.cc ×3 | ~15 KB | 3 third-party connections |
| **Total** | **~231 KB + fonts** | **~73 % is images** |

Text payloads are fine once gzipped/brotli'd. The wins are, in order: (1) resize and re-encode the
three PNGs, ideally WebP/AVIF (−120 KB), (2) self-host or preload the fonts and cut Manrope to
2–3 weights, (3) delete the pravatar requests, (4) pause the off-screen canvas.

Note there is **no build step or deployment config** in the repo, so none of the compression,
minification, or hashing you'd want is configured anywhere.

---

## Repo hygiene

- No `.gitignore` (nothing stopping `node_modules/` or `.DS_Store` landing in a commit)
- No `LICENSE`, no `CONTRIBUTING`, no CI, no PR/issue templates
- No deployment config (no `netlify.toml`, `vercel.json`, or GitHub Actions workflow)
- `README.md` is clear and accurate, though it calls the nav "sticky" when it is `position: fixed`,
  and doesn't mention `under-construction.html` or the local-storage keys used
- Only one commit on `main` (a merge of a previous generated branch) — the history gives no
  signal about what changed or why, which makes this review the de facto baseline

---

## Suggested order of work

| # | Item | Effort | Impact |
|---|---|---|---|
| 1 | Guarded `localStorage` (C2) | 10 min | Prevents total JS failure |
| 2 | No-JS reveal fallback (C1) | 15 min | Prevents blank page |
| 3 | Dark-mode contrast pass (C3) | 45 min | Accessibility + polish |
| 4 | `scroll-padding-top` (C4) | 2 min | Fixes every anchor |
| 5 | `disabled` the Export button (C5) | 2 min | Fixes keyboard trap |
| 6 | Replace pravatar + fake logos (C6, H4) | 2 h | **Highest business value** |
| 7 | Inline theme script (H1) | 20 min | Kills theme flash |
| 8 | Contact form fallback (H3) | 1 h | Stops lost leads |
| 9 | Number/currency consistency (H5) | 30 min | Credibility |
| 10 | Verify + fix 800–1050 px nav (H6) | 30 min | **[unverified]** |
| 11 | Image optimisation | 1 h | −120 KB |
| 12 | OG/Twitter/canonical/JSON-LD | 1 h | Shareability |
| 13 | Pause off-screen canvas, DPR-aware canvas | 45 min | Battery + crispness |
| 14 | Dead CSS, duplicate footer rules, formatter pass | 1 h | Maintainability |
| 15 | `.gitignore`, `robots.txt`, `sitemap.xml`, deploy config | 30 min | Hygiene |

Items 1–5 are about **90 minutes total** and remove every critical issue.

---

## What's genuinely good

Worth saying explicitly, because reviews that only list problems are misleading:

- **Correct document semantics.** One `<h1>`, no skipped heading levels, `<main>`, `<header>`,
  `<footer>`, `<nav>`, `<article>` used properly, unique IDs throughout.
- **Real accessibility instincts.** Skip link, `aria-expanded`/`aria-controls` on the menu,
  `aria-pressed` on the toggles, `aria-live` on the form status, `:focus-visible` ring, Escape-to-close,
  and a genuine `prefers-reduced-motion` branch that disables the cursor, tilt, magnetic and canvas
  effects rather than just shortening them.
- **Restrained, cohesive visual system.** The blue/cyan pairing, the Georgia serif accent on
  `<em>`, and the consistent 12–18 px radii hold together across every section.
- **Nice CSS craft.** The 3D buttons with layered inset/off-set shadows, the `conic-gradient` donut,
  the duplicated-track infinite marquee, and the `mix-blend-mode` logo handling are all well executed.
- **Good mobile strategy.** Three considered breakpoints (1200/800/540) with real layout changes, not
  just stacking — including the sensible decision to switch the custom cursor off on small screens.
- **Sensible persistence.** Theme and currency both survive reloads, and the currency switcher is
  properly exposed as a labelled `role="group"` with `aria-pressed`.

The gap between this and a launch-ready site is not talent — it's a pass of QA, real client assets,
and metadata. All of it is closeable.
