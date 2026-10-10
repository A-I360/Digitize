# Setup checklist

Everything a site owner needs to change lives in **`js/site/config.js`** and
**`js/site/data/projects.js`**. You should not have to edit markup to make this site yours.

## 1. Run it

```bash
npm start                       # http://localhost:8080
```

You must serve over HTTP — opening `index.html` from disk blocks ES modules.

## 2. Identity and contact details

`js/site/config.js` → `SITE`:

```js
export const SITE = {
  name: 'SYNQ Technological Services',
  url: 'https://synqtech.org',     // ← your canonical domain
  email: 'info@synqtech.org',
  phoneDisplay: '09071618499',
  whatsapp: '2349071618499',       // digits only, country code first
  ...
};
```

`url` is used for canonical tags, `og:url` and `sitemap.xml`, so changing it updates
every page. Regenerate the sitemap afterwards: `node tools/build-sitemap.mjs`.

Social links marked `placeholder: true` render as inert pills rather than as claims about
accounts that may not exist. Set `placeholder: false` once the account is real.

## 3. Connect the contact form

`js/site/config.js` → `CONTACT.endpoint` is `null` by default. **That is deliberate.** With
no endpoint the form hands the enquiry to WhatsApp with the message prefilled, and tells
the visitor that no email service is connected. It never shows a fake success message.

**Option A — the bundled endpoint** (no dependencies, no third party):

```js
export const CONTACT = {
  endpoint: '/api/contact',
  fallback: 'handoff',
};
```

`server/site-server.js` accepts it out of the box and appends each enquiry to
`server/data/enquiries.jsonl`. Validation, a honeypot field, a minimum-time check and
per-IP rate limiting are already in. Forward it to a real inbox by editing
`handleContact()` — or swap in any of the options below.

**Option B — a form service.** Set `endpoint` to the service URL and make sure it accepts
`application/json` and answers with `{ ok: true, message }`. The front end reads:

- `ok: true` → success, shows `message`
- HTTP 422 with `{ errors: { fieldName: 'reason' } }` → marks those fields
- anything else → shows the returned `message`, or a generic failure

Formspree, Netlify Forms, Basin and Buttondown all fit; Netlify Forms wants
`application/x-www-form-urlencoded`, so check `js/site/pages/contact.js` if you use it.

**Option C — a serverless function.** Point `endpoint` at it. Keep validation on the
server too; the client-side checks are for speed, not security.

## 4. Replace the portfolio

`js/site/data/projects.js` is the grid's single source of truth — the home page, the
portfolio filters and the case-study pages all read from it.

```js
{
  slug: 'my-project',            // used by project.html?slug=
  title: 'My Project',
  client: 'Client name',
  category: 'web-apps',          // websites | web-apps | games | ecommerce | experiments
  status: 'live',                // live | in-progress | archived | concept
  tagline: 'One line.',
  description: 'A paragraph.',
  cover: { file: 'my-project', alt: 'What the screenshot shows' },
  technologies: ['React', 'Node'],
  liveUrl: 'https://…',          // omit or null if there is nothing to link to
  sourceUrl: 'https://github.com/…',
  highlights: ['…'],
  sample: false,                 // ← true marks it as illustrative, not delivered
}
```

**`sample: true` is the honesty switch.** Sample entries render with a visible
*"Sample entry — not a delivered project"* flag and a banner on their case-study page.
Keep it on anything you did not actually deliver. Anything with `sample: false` is
presented as real work, so only set that when it is.

Covers live in `assets/img/work/` as `.jpg` + `.webp` (1600×900). Drop both in and
reference the bare filename — `coverSources()` builds the paths.

## 5. Pricing

Prices are authored **once, in Naira**, in `js/site/data/services.js` (or wherever your
packages live). USD is derived:

```js
export const CURRENCY = { default: 'NGN', nairaPerUsd: 1500, ... };
```

Change `nairaPerUsd` and both currencies stay consistent everywhere.

## 6. Multiplayer

**Local two-player needs nothing.** It is on by default and always labelled as local.

**Online rooms** need the room server:

```bash
npm --prefix server install      # installs `ws`
npm run multiplayer              # :8787
```

`MULTIPLAYER.serverUrl` is `'/multiplayer'` by default, and `server/site-server.js`
proxies that path to the room server — one origin, one port, works behind a tunnel.

If you deploy the room server separately, set an absolute address:

```js
export const MULTIPLAYER = { serverUrl: 'wss://rooms.yourdomain.com', ... };
```

Two other forms are understood: `'/path'` (same origin) and `':8787'` (same hostname,
different port). `null` turns online play off and says so honestly.

On a purely static host with no room server, the online option reports
*“could not reach the server”* and offers local two-player. It never pretends.

## 7. Before you launch

```bash
npm test                         # level audit, play-throughs, site crawl, multiplayer
node tools/build-sitemap.mjs     # after changing SITE.url or the project list
```

Then, by hand:

- [ ] Replace `assets/img/og-cover.jpg` (1200×630) and the favicons
- [ ] Put your real domain in `SITE.url`, `robots.txt` and `sitemap.xml`
- [ ] Turn every `sample: true` into real work — or leave the flag on
- [ ] Set `CONTACT.endpoint` and send yourself a test enquiry
- [ ] Read `privacy.html` and make it match what you actually do
- [ ] Click through every page with the keyboard only, and at 320 px wide
- [ ] Check the site with JavaScript disabled — the content must still be there

## 8. Deploying

Static hosts need no configuration: upload the repository and serve the root. The only
things that need a server are `POST /api/contact` and online multiplayer — run
`server/site-server.js` on any Node host (it has zero dependencies), or replace both with
managed equivalents as described above.

Set `PORT` and `HOST` by environment variable if your host requires it.
