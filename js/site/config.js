/**
 * Site-wide configuration.
 *
 * Everything that a site owner is likely to change lives here (or in the
 * data files next door) so the markup never has to be edited to update
 * contact details, rates or integrations.
 */

export const SITE = {
  name: 'SYNQ Technological Services',
  shortName: 'SYNQ',
  tagline: 'Transforming ideas into digital reality.',
  description:
    'SYNQ Technological Services is a digital product studio building websites, web applications, interactive experiences and original games.',
  url: 'https://synqtech.org',
  founded: 2022,
  location: 'Lagos, Nigeria',
  email: 'info@synqtech.org',
  phoneDisplay: '09071618499',
  whatsapp: '2349071618499',
  responseTime: 'within one business day',
  social: [
    { label: 'LinkedIn', href: 'https://www.linkedin.com/company/synq-technological-services', placeholder: true },
    { label: 'Instagram', href: 'https://www.instagram.com/synqtechnologies', placeholder: true },
    { label: 'Dribbble', href: 'https://dribbble.com/synq', placeholder: true },
    { label: 'GitHub', href: 'https://github.com/A-I360/Digitize', placeholder: false },
  ],
  repository: 'https://github.com/A-I360/Digitize',
};

/**
 * Contact form delivery.
 *
 * `endpoint` is where a submission is POSTed as JSON. When it is null the
 * form cannot claim to have sent anything: it falls back to the working
 * WhatsApp / email hand-off and tells the visitor exactly that.
 *
 * See server/README.md for the bundled zero-dependency endpoint you can run,
 * or point this at Formspree / Netlify Forms / your own service.
 */
export const CONTACT = {
  endpoint: null, // e.g. '/api/contact' once a backend is deployed
  fallback: 'handoff', // 'handoff' = open WhatsApp with a prefilled message
};

/**
 * Display currency + a single, explicit conversion rate.
 * Every price is authored in Naira and converted from that one number so the
 * two currencies can never drift apart.
 */
export const CURRENCY = {
  default: 'NGN',
  nairaPerUsd: 1500,
  format: {
    NGN: (v) => `₦${Math.round(v).toLocaleString('en-NG')}`,
    USD: (v) => `$${Math.round(v).toLocaleString('en-US')}`,
  },
};

/**
 * Optional online multiplayer transport for the platformer.
 *
 * `serverUrl` is where the game opens its WebSocket. Three forms are accepted:
 *
 *   'wss://rooms.example.com'  an absolute address (what you want in production)
 *   '/multiplayer'             same-origin path — the bundled site server
 *                              proxies this to the room server when it is up
 *   null                       no online play at all; local 2-player only
 *
 * The default is '/multiplayer' because the bundled `server/site-server.js`
 * proxies that path to `server/multiplayer-server.js`, which means one origin
 * and one command pair (`npm start` + `npm run multiplayer`) gives you working
 * online play locally. On a static host with no room server the connection is
 * simply refused, and the game says so and offers local 2-player instead —
 * it never pretends to be connected.
 */
export const MULTIPLAYER = {
  serverUrl: '/multiplayer',
  maxPlayers: 4,
  joinCodeLength: 6,
  reconnectDelay: 1500,
  stateRate: 20, // position updates per second
};

/* Local same-device two-player needs no server, so it is always available. */
export const MULTIPLAYER_LOCAL_AVAILABLE = true;

