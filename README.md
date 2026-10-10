# SYNQ Technological Services

A multi-page site for **SYNQ Technological Services**, a digital product studio — plus
**Aether Drift**, an original 2D platformer that runs in the same browser, shares the same
design system, and plays single-player, local two-player, or online in a room.

No build step. No framework. Vanilla ES modules, Canvas 2D, and two small Node servers
that are only needed for the optional bits (online multiplayer and contact delivery).

```
index.html      Home — featured work, the game, services, process
about.html      Who we are and how we work
services.html   What we build, with real Naira/USD pricing
portfolio.html  Data-driven work grid with category filters
project.html    Case study template, rendered from ?slug=
game.html       Aether Drift — the game itself
contact.html    Enquiry form with an honest hand-off fallback
privacy.html    What the site stores, in plain language
404.html        Not found
```

---

## Quick start

```bash
git clone https://github.com/A-I360/Digitize.git
cd Digitize
npm start                 # http://localhost:8080
```

`npm start` runs `server/site-server.js`, a zero-dependency static server. **Opening the
HTML files directly from disk will not work** — ES modules and `fetch` are blocked on
`file://`. Any static host works too (Netlify, Vercel, Cloudflare Pages, nginx, S3).

Optional, in a second terminal:

```bash
npm --prefix server install
npm run multiplayer        # room server on :8787 — switches on online play
```

With both running, the site server proxies `ws://localhost:8080/multiplayer` to the room
server, so the page, the API and the game socket all share one origin. That matters behind
a preview tunnel or on any host where you only get one port and one TLS certificate.

---

## Aether Drift

A hand-built platformer: parallax layers, per-biome lighting, particles, checkpoints,
collectibles, hazards, jump pads, moving platforms, three enemies, and a tutorial level
that teaches the movement by making you use it.

**Controls**

| | |
|---|---|
| Move | `←` `→` or `A` `D` |
| Jump | `Space` / `W` / `↑` (hold for height) |
| Drop through a one-way platform | `↓` + jump |
| Pause / settings | `Esc` or `P` |
| Player 2 (local) | `J` `L` to move, `I` to jump, `K` to drop |

On touch devices an on-screen pad appears. The game traps the keys it uses so the page
never scrolls or navigates while you are playing, and it pauses itself when the tab is
hidden instead of burning a loop in the background.

**Three ways to play**

1. **Solo** — three levels, each with a par time and shards to find.
2. **Local two-player** — two players, one keyboard, one screen. Always available; it
   needs no server and makes no network calls.
3. **Online rooms** — create a room, share the six-character code, race. Remote players
   are interpolated so they glide rather than teleport.

Online is honest about its own state. With no room server running, the game says so and
points you at local two-player — it never shows a lobby, a code, or a "connected" badge
for a connection that does not exist.

```
/game.html                 free play, level select
/game.html?level=cloudspire   jump straight into a level
/game.html?room=ABC123        join a room from a shared link
/game.html?mode=local         straight to local two-player
```

---

## Architecture

```
js/
  site/            the website
    config.js      everything a site owner edits: contact details, rates, endpoints
    main.js        boot: chrome, theme, nav, transitions, reveals
    transition.js  branded page-to-page sweep
    chrome.js      header/footer injected once per page
    nav.js         internal links routed through the transition
    reveal.js      scroll reveals + counters (fails open)
    theme.js       light/dark, persisted, guarded against blocked storage
    pages/         one module per page
    data/          projects.js — the single source of truth for the portfolio
    lib/           dom, storage, canvas-field helpers
  game/            Aether Drift
    constants.js   physics, player, visual and tuning numbers in one place
    levels.js      GENERATED from tools/level-maps/ — do not hand-edit
    world.js       simulation: collision, enemies, triggers, particles
    render.js      camera + all drawing, including the canvas HUD
    input.js       keyboard and touch
    audio.js       WebAudio SFX and music, no audio files
    net.js         WebSocket client + the documented wire protocol
    game.js        the controller that wires the above together
    main.js        page controller: overlays, lobby, deep links, settings
server/
  site-server.js        static files + POST /api/contact (+ WebSocket proxy)
  multiplayer-server.js room server (needs `ws`)
tools/
  build-levels.mjs      builds js/game/levels.js and audits the geometry
  build-sitemap.mjs     builds sitemap.xml
  level-maps/           the levels, as ASCII you can read and edit
tests/                  four suites, no browser required
```

The game modules are separated by job, not by file size: `world.js` never touches a
canvas, `render.js` never mutates the simulation, `net.js` owns only the socket, and
`game.js` is the only place they meet.

### Levels are data, and they are audited

Maps live in `tools/level-maps/*.txt` as ASCII, with enemies and moving platforms declared
in `meta.json`:

```
#  solid      =  one-way platform      ^  hazard      o  shard
C  checkpoint P  spawn                 G  goal        .  empty
```

```bash
node tools/build-levels.mjs           # rewrites js/game/levels.js
node tools/build-levels.mjs --check   # audit only
```

The audit derives the movement envelope from `constants.js` (3.21 tiles up, 5.36 across,
11.53 on a jump pad) and rejects any gap wider than 4 tiles, any step-up taller than 2
rows, any spike strip wider than a jump, and any collectible stranded out of reach. Change
a physics constant and the audit limit moves with it.

---

## Tests

```bash
npm install     # pulls jsdom, needed by the four DOM-level suites
npm test        # 9 suites, ~25 s
```

| Suite | What it proves |
|---|---|
| Level audit | every gap is jumpable, every platform reachable, given the real physics |
| Level play-throughs | a bot drives the **real simulation** and finishes all three levels |
| Colour contrast | every text/background pair in the design tokens meets WCAG AA, in both themes |
| Site crawl | all 8 pages serve; SEO tags, one `h1`, alt text, no third-party assets; all 22 internal links resolve; the contact endpoint accepts, validates and rejects correctly |
| DOM smoke test | the real page modules run inside jsdom: chrome mounts, the portfolio renders from data, the game boots, moves, jumps and pauses without a console error |
| Site UI | the contact form never claims to have sent what it did not send; sample projects are flagged; the currency switch derives both currencies from one rate; structured data is valid and omits the placeholders |
| Loading and transitions | the boot loader completes even when every readiness signal hangs; an internal navigation skips it; a second click cannot double-navigate; bfcache restores clear the veil |
| Game page UI | title → play, pause, settings, level select, local two-player and all four deep links |
| Accessibility audit | 12 rules against the rendered DOM: accessible names, aria that resolves, heading order, landmarks, no positive tabindex |
| Device behaviour | touch controls mount only on a coarse pointer and actually move the runner; a hidden tab stops the loop; the game never scrolls the page; no `AudioContext` is survivable |
| Performance budgets | first-load weight, image size and dimensions, render-blocking requests, draw calls per frame, physics cost per step |
| Online lobby | two jsdom pages on real WebSockets: create a room, share the code, join, start, race, finish, leave |
| Multiplayer rooms | the wire protocol end to end, every error path, and the same-origin proxy |

Two of these are worth calling out.

**Level play-throughs** step `world.js` with fixed timesteps and a heuristic bot that rides
platforms, jumps pits and stomps enemies. If the bot can finish a level, a person can.

**The DOM tests** exist because there is no browser here. They load the pages in jsdom and
run the actual modules, rather than asserting on markup. They found seven bugs that every
static check and every simulation test had missed — [listed below](#bugs-the-tests-found-and-fixed).

The online lobby test is the one I would keep if I could only keep one: it runs two
browser-like pages against the real room server and asserts the things a visitor would
notice — the code appears, the second player shows up, only the host can start, and
everyone is told when someone leaves.

None of this is a substitute for looking at the page. Visual layout, animation timing and
how the game actually feels still need a human.

---

## Content and honesty

This is a real studio site with real placeholders, and the difference is labelled
everywhere.

- **`js/site/data/projects.js`** is the portfolio's single source of truth. Entries with
  `sample: true` render with an explicit *"Sample entry — not a delivered project"* flag
  in the grid and a banner on their case-study page. Only entries without that flag are
  presented as delivered work.
- **Testimonials and client logos** are not invented. Where the layout wants them, the
  data file marks them as placeholders.
- **The contact form never lies.** `CONTACT.endpoint` in `js/site/config.js` is `null`
  until you connect a service. With no endpoint the form hands off to WhatsApp with the
  message prefilled and says plainly that no email service is connected — it does not
  show a success message for a message it did not send. Point it at the bundled
  `/api/contact` or at Formspree / Netlify Forms / your own service and it does send.
- **Prices** are authored once in Naira; USD is derived from `CURRENCY.nairaPerUsd`.
- **Nothing secret is shipped client-side.** There are no API keys in this repository.

See [SETUP.md](SETUP.md) for the checklist to make it yours.

---

## Accessibility and performance

- Semantic landmarks, one `h1` per page, a skip link, visible focus rings
- Every form control has a label; errors are announced and tied to their field
- `prefers-reduced-motion` disables the boot animation, page transitions, reveals,
  parallax and screen shake
- Content is visible with JavaScript disabled — reveals fail *open*, not closed
- `localStorage` and `sessionStorage` access is wrapped, so a blocked-storage browser
  (private mode, strict cookies) still gets a working site
- The game loop stops when the tab is hidden; all listeners and sockets are torn down

---

## Known limits

- There is no browser in this environment, so layout and animation have not been visually
  verified — everything above is verified by code, by crawling the served pages, and by
  running the simulation headlessly. Please click through it.
- Online multiplayer is authoritative only about the lobby (who is in the room, who is
  host, when the match starts, who finished). Each client still simulates its own player,
  so a determined cheater could lie about their position. That is a deliberate trade for a
  server that needs no game logic; add server-side simulation if you need to prevent it.
- The contact endpoint appends to `server/data/enquiries.log`. Anything you actually rely
  on should forward to a real inbox or CRM. The static server refuses to serve anything
  under `server/`, `node_modules/`, `.git/` or any dotfile — the site root is the
  repository root, so without that blocklist the enquiry log (names, email addresses, IP
  addresses, budgets) was readable at a public URL. Two suites now assert it stays that way.

## Bugs the tests found, and fixed

Static analysis, the level bot and the HTTP crawl all passed while these were live:

| Bug | What it broke |
|---|---|
| The boot script called `document.body.appendChild` from inside `<head>` | `document.body` is `null` there, so it threw and silently disabled the loading animation *and* the pre-paint theme on every page |
| `canvas-field.js` built an `IntersectionObserver` unconditionally | crashed on any DOM without one |
| `main.js` called `this.renderLobby()`, which does not exist | clicking *Create a room* threw, so the whole online flow did nothing |
| Ghosts had a `skinIndex` but no `skin` | online play crashed on the first frame a remote player was drawn |
| `hostRoom`/`joinRoom` resolved as soon as they sent | a refused join stranded the visitor on a "Connecting…" lobby that was never going to connect |
| `new URL()` threw on a protocol-relative target like `//` | **one malformed request killed the site server**, taking every page down |
| The static server served anything inside the repo root | `server/data/enquiries.log` — every visitor's name, email and IP — was publicly readable |
| `onGameState` handled RUNNING and ENDED but not PAUSED | switching tabs froze the game with no overlay and no visible way to resume — the pause screen followed the key press, not the state |
| Nothing was compressed | every visitor downloaded 284 KB of raw JS and CSS. Brotli takes the biggest file from 30.3 KB to 7.8 KB |
| The navigation failsafe waited 3s to release the veil | a browser that declined to navigate left the visitor behind a covering veil for three seconds. Now 1.2s |

The last two are the reason the crawl suite now fires hostile paths at the server and
then checks that the homepage still answers.

## The original review findings

`REVIEW.md` audited the site before this work started. Every finding is
resolved, and the ones that could be are now covered by a test:

| Finding | Status |
|---|---|
| C1 Without JavaScript most of the page is invisible | Rebuilt as server-rendered HTML with progressive enhancement; `<noscript>` nav on every page and an honest explanation on the game page |
| C2 One `localStorage` exception breaks the script | Every access goes through `lib/storage.js`, which never throws, with an in-memory fallback |
| C3 Dark mode leaves text near-invisible | Both themes are defined in `tokens.css`; the contrast suite checks every pair against WCAG AA |
| C4 Anchors hide headings behind the fixed nav | `scroll-padding-top` on `:root` |
| C5 Keyboard trap in `role="img"` | Removed with the old hero |
| C6 Third-party stranger avatars | Gone. Real generated art, no external images anywhere |
| H1 Flash of wrong theme | Pre-paint inline script, before first paint |
| H2 Native cursor hidden on desktop | Never hidden |
| H3 Contact form loses data and lies | Hand-off to WhatsApp with an honest message; with an endpoint, real POST and the server's own words |
| H4 Fake social proof | Invented clients, logos and testimonials removed; sample work is labelled |
| H5 Inconsistent numbers | One source in `config.js` and the project data |
| H6 Nav overflows 800–1050px | Rebuilt responsive chrome |
| Two permanent `requestAnimationFrame` loops | Canvas field stops on `IntersectionObserver` and `visibilitychange` |
| Canvas not DPR-aware | DPR-aware with `setTransform`, capped at 2× |
| Oversized PNGs | Every image has a WebP sibling; none over 200 KB |
| No image dimensions or lazy-loading | Both, asserted by the performance suite |
| Contact CTA specificity collision | Rebuilt on the token system |
| `.contact-inner::before` paints over the form | Removed |
| `.fx-grid` overlays page content | `z-index: -1`, `pointer-events: none` |
| Menu button label never updates | `aria-label` and `aria-expanded` follow state |
| Unescaped ampersands | Escaped |
| `<label>` misused as a badge | Real `<label>`/`for` pairs only |
| `+` glyph in `<summary>` read aloud | Marker is `aria-hidden` |
| Newsletter form was decorative | Removed rather than faked |
| Contact details duplicated 4× | One source in `config.js` |
| `prefers-reduced-motion` sampled once | Read live, so changing the OS setting works without a reload |
| Dead CSS, duplicate footer rules, no tokens, 22 KB single line, stale cache-busting | Rebuilt as six token-driven stylesheets with no cache-busting queries |

## Structured data

JSON-LD is generated in `js/site/structured-data.js` from the same `config.js`
the visible page is built from, so the machine-readable facts cannot drift from
the human-readable ones. One rule matters more than the rest: **the placeholder
social links in the footer are filtered out**. They are shown as labelled
stand-ins, but `sameAs` in schema.org is a factual assertion, so only the
profiles that exist are emitted. The game declares no `aggregateRating` and no
`offers`, because there are no ratings and nothing is for sale.

## Performance

Measured by `npm run test:perf`, which talks to the server over raw HTTP (Node's
`fetch` would decompress the response behind its back and make every number a lie).

| | |
|---|---|
| Heaviest first load, compressed | **29 KB** (game.html: HTML + CSS + JS + images) |
| Brotli on `js/game/render.js` | 30.3 KB → **7.8 KB** (74% off); gzip 8.1 KB |
| Compression | brotli → gzip → identity, chosen from `Accept-Encoding`, with `Vary` set and results cached per file. Text only — a JPEG is never recompressed |
| Third-party stylesheets in the critical path | **none** — the Google Fonts sheet loads as `media="print"` and promotes itself on arrival, so text renders immediately in the system stack |
| Physics | 0.016–0.032 ms per fixed step, about 0.2% of a frame |
| Draw calls per frame | 1,017 / 1,116 / 1,548 (levels 1–3), against a 4,000 budget |

The budgets are regression tripwires, not benchmarks. None of this is a real
device — the numbers say "nothing here is obviously wrong", not "this is fast".

---

## Licence

Code and generated game art are part of this repository. Replace the placeholder copy,
projects and assets with your own before launching.
