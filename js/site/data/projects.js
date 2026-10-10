/**
 * Portfolio data source.
 *
 * The portfolio grid, the filters and every project detail page are rendered
 * from this array, so adding a project means adding one object here — never
 * touching the layout.
 *
 * ── Honesty contract ────────────────────────────────────────────────────────
 * `sample: true` marks an illustrative entry. Sample entries are rendered with
 * a visible "Sample entry" flag and their detail page carries a notice. They
 * exist to demonstrate the structure of a finished case study; they are NOT
 * claims about work delivered. Replace or delete them with real projects.
 * Never flip `sample` to false for work that was not actually delivered.
 *
 * Fields
 *  slug         unique, used by project.html?slug=
 *  title, tagline, description
 *  category     websites | web-apps | games | ecommerce | experiments
 *  tags         technology / discipline tags
 *  status       shipped | in-development | concept
 *  sample       boolean (see above)
 *  featured     boolean — promotes to the flagship slot
 *  size         default | wide | third   (grid emphasis)
 *  cover        { file, alt }  resolved against assets/img/work/
 *  year, role, client
 *  liveUrl, sourceUrl   null when not available
 *  highlights   bullet list shown on the detail page
 *  metrics      optional [{ label, value }]
 */

export const CATEGORIES = [
  { id: 'all', label: 'All work' },
  { id: 'websites', label: 'Websites' },
  { id: 'web-apps', label: 'Web apps' },
  { id: 'games', label: 'Games' },
  { id: 'ecommerce', label: 'E-commerce' },
  { id: 'experiments', label: 'Experiments' },
];

export const PROJECTS = [
  {
    slug: 'aether-drift',
    title: 'Aether Drift',
    tagline: 'An original 2D platformer built from scratch',
    description:
      'A hand-built sky-island platformer: custom physics, three biomes, checkpointed levels, local two-player and an online race mode. Made to prove the studio can ship a real game, not just a mockup.',
    category: 'games',
    tags: ['Game Development', '2D Platformer', 'Canvas', 'Physics', 'Multiplayer', 'WebAudio'],
    status: 'shipped',
    sample: false,
    featured: true,
    size: 'wide',
    cover: { file: 'aether-key', alt: 'Aether Drift key art: a lantern-lit explorer above a sea of clouds' },
    year: 2026,
    role: 'Design, engineering, art direction, audio',
    client: 'SYNQ (in-house)',
    liveUrl: 'game.html',
    sourceUrl: 'https://github.com/A-I360/Digitize/tree/main/js/game',
    embeddable: true,
    highlights: [
      'Purpose-built movement controller: coyote time, jump buffering, variable jump height and tuned air control.',
      'Three hand-authored levels across distinct biomes with checkpoints, hazards, moving platforms and jump pads.',
      'Local same-device two-player, plus a WebSocket race mode with room codes and interpolated remote players.',
      'Procedurally drawn art and a fully synthesised WebAudio soundtrack — no third-party assets.',
      'Runs in a single canvas with a fixed-timestep loop, DPR-aware rendering and off-screen pausing.',
    ],
    metrics: [
      { label: 'Levels', value: '3' },
      { label: 'Modes', value: '3' },
      { label: 'External assets', value: '0' },
      { label: 'Dependencies', value: '0' },
    ],
  },
  {
    slug: 'synq-flagship-site',
    title: 'SYNQ Flagship Site',
    tagline: 'This website — the studio’s own storefront',
    description:
      'A multi-page site built as a design system: tokenised theming, a branded loading sequence, route transitions, a data-driven portfolio and an embedded playable game. No framework, no build step.',
    category: 'websites',
    tags: ['Design System', 'HTML', 'CSS', 'JavaScript', 'Accessibility', 'Performance'],
    status: 'shipped',
    sample: false,
    featured: false,
    size: 'default',
    cover: { file: 'flagship-site', alt: 'Abstract composition of translucent glass UI panels in blue and cyan' },
    year: 2026,
    role: 'Design and engineering',
    client: 'SYNQ (in-house)',
    liveUrl: 'index.html',
    sourceUrl: 'https://github.com/A-I360/Digitize',
    highlights: [
      'Token-based light/dark theming with no flash of incorrect theme.',
      'Panel-sweep route transitions that work with browser back and forward.',
      'Every project rendered from a single structured data source.',
      'Accessible by default: skip link, focus states, reduced-motion support, AA contrast.',
    ],
    metrics: [
      { label: 'Pages', value: '9' },
      { label: 'Build step', value: 'None' },
      { label: 'Runtime deps', value: '0' },
    ],
  },
  {
    slug: 'orbit-commerce',
    title: 'Orbit Commerce',
    tagline: 'Editorial commerce for a specialist retailer',
    description:
      'An illustrative storefront concept: a fast, mobile-first catalogue with faceted filtering, a single-page checkout and a headless CMS for merchandising.',
    category: 'ecommerce',
    tags: ['E-commerce', 'UI/UX', 'Performance', 'Headless CMS'],
    status: 'concept',
    sample: true,
    featured: false,
    size: 'default',
    cover: { file: 'orbit-commerce', alt: 'Abstract e-commerce interface mockup in cyan and violet light' },
    year: null,
    role: 'Concept and interface design',
    client: 'Sample entry — not a delivered project',
    liveUrl: null,
    sourceUrl: null,
    highlights: [
      'Faceted catalogue filtering with URL-encoded state.',
      'Single-page checkout with optimistic validation.',
      'Image pipeline with responsive sources and lazy loading.',
    ],
  },
  {
    slug: 'nova-analytics',
    title: 'Nova Analytics',
    tagline: 'An operations dashboard people actually open',
    description:
      'An illustrative analytics workspace: streaming charts, saved views and shareable snapshots, designed for teams who need answers rather than more graphs.',
    category: 'web-apps',
    tags: ['Web App', 'Data Visualisation', 'Realtime', 'Design System'],
    status: 'concept',
    sample: true,
    featured: false,
    size: 'default',
    cover: { file: 'nova-analytics', alt: 'Abstract dashboard with glowing cyan charts and radial gauges' },
    year: null,
    role: 'Product design and front-end architecture',
    client: 'Sample entry — not a delivered project',
    liveUrl: null,
    sourceUrl: null,
    highlights: [
      'Virtualised tables that stay responsive past 100k rows.',
      'Realtime series with back-pressure-aware rendering.',
      'Saved views shared through signed, read-only links.',
    ],
  },
  {
    slug: 'pulse',
    title: 'Pulse',
    tagline: 'A calm daily companion for healthy routines',
    description:
      'An illustrative mobile app concept: gentle habit tracking with offline-first sync, streaks that forgive, and a home screen designed to be looked at once and closed.',
    category: 'web-apps',
    tags: ['Mobile', 'UI/UX', 'Offline-first', 'Design System'],
    status: 'concept',
    sample: true,
    featured: false,
    size: 'third',
    cover: { file: 'pulse-app', alt: 'Two abstract smartphone screens with soft gradient rings' },
    year: null,
    role: 'Product design and prototype',
    client: 'Sample entry — not a delivered project',
    liveUrl: null,
    sourceUrl: null,
    highlights: [
      'Offline-first data layer with conflict-free sync.',
      ' streak logic that tolerates missed days without guilt-driven design.',
      'Full keyboard and screen-reader parity in the prototype.',
    ],
  },
  {
    slug: 'signal-field',
    title: 'Signal Field',
    tagline: 'A generative study in motion and light',
    description:
      'An illustrative WebGL experiment: a particle field that reacts to pointer movement and sound, rendered with an offscreen simulation pass.',
    category: 'experiments',
    tags: ['WebGL', 'Generative', 'Creative Coding', 'Shaders'],
    status: 'concept',
    sample: true,
    featured: false,
    size: 'third',
    cover: { file: 'lab-experiment', alt: 'Abstract particle field of glowing cyan nodes and filaments' },
    year: null,
    role: 'Experiment',
    client: 'Sample entry — not a delivered project',
    liveUrl: null,
    sourceUrl: null,
    highlights: [
      'GPU position/velocity simulation in ping-pong framebuffers.',
      'Adaptive particle count based on measured frame time.',
      'Graceful canvas fallback when WebGL is unavailable.',
    ],
  },
];

/** Cover markup helper — emits a <picture> with WebP and JPEG sources. */
export function coverSources(file) {
  return {
    webp: `assets/img/work/${file}.webp`,
    jpg: `assets/img/work/${file}.jpg`,
  };
}

export const GAME_COVER = {
  webp: 'assets/img/game/aether-key.webp',
  jpg: 'assets/img/game/aether-key.jpg',
  smallWebp: 'assets/img/game/aether-key-sm.webp',
  smallJpg: 'assets/img/game/aether-key-sm.jpg',
  alt: 'Aether Drift key art: a lantern-lit explorer standing on a floating island above a sea of clouds',
};

export function findProject(slug) {
  return PROJECTS.find((p) => p.slug === slug) || null;
}
