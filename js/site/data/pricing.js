/**
 * Pricing.
 *
 * Every price is authored once, in Naira, and converted from the single
 * `nairaPerUsd` rate in config.js — so the two currencies can never disagree.
 * Edit the Naira figure and the dollar figure follows.
 */

export const PLANS = [
  {
    id: 'starter',
    name: 'Starter',
    tagline: 'For a strong first impression.',
    ngn: 70000,
    includes: [
      'High-converting landing page',
      'Custom interface design',
      'Responsive build, tested on real devices',
      'Analytics and search foundations',
      'Two rounds of revisions',
    ],
    cta: 'Start with Starter',
    featured: false,
  },
  {
    id: 'business',
    name: 'Business',
    tagline: 'For brands ready to grow.',
    ngn: 150000,
    includes: [
      'Multi-page marketing site',
      'Brand-aligned design system',
      'Content model and simple CMS',
      'Performance and SEO foundation',
      'Integrations (payments, forms, CRM)',
      'Launch support and handover session',
    ],
    cta: 'Choose Business',
    featured: true,
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    tagline: 'For digital products with ambition.',
    ngn: null,
    includes: [
      'Web app, platform or game',
      'Dedicated product team',
      'Architecture and technical discovery',
      'Complex integrations',
      'Priority ongoing support',
    ],
    cta: 'Start a conversation',
    featured: false,
  },
];
