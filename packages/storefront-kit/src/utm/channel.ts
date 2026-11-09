// Pure channel classification of a stored acquisition. The domain and medium
// lists are data; edit them here.
import type { Acquisition } from './core.js';

export type AcquisitionChannel =
  | 'paid'
  | 'email'
  | 'social'
  | 'search'
  | 'referral'
  | 'campaign'
  | 'direct';

// Plus any medium starting with `paid` (`paidsocial`, `paid_social`, `paid-search`).
const PAID_MEDIUMS = ['cpc', 'ppc', 'display', 'cpm'];
const EMAIL_MEDIUMS = ['email', 'e-mail', 'newsletter'];
const SOCIAL_MEDIUMS = ['social', 'social-media', 'organic_social'];

// A pattern matches its domain and any subdomain of it (`facebook.com` covers
// `l.facebook.com`). `brand.*` matches the brand under any short country or
// generic suffix (`google.*` covers `www.google.co.uk`, not `google.evil.com`).
// Checked in this order, so webmail (`mail.google.com`) wins over search.
const EMAIL_DOMAINS = [
  'mail.google.com',
  'outlook.live.com',
  'outlook.office.com',
  'mail.yahoo.com',
];
const SOCIAL_DOMAINS = [
  'facebook.com',
  'instagram.com',
  't.co',
  'x.com',
  'twitter.com',
  'linkedin.com',
  'lnkd.in',
  'pinterest.*',
  'pin.it',
  'reddit.com',
  'tiktok.com',
  'youtube.com',
  'threads.net',
  'bsky.app',
];
const SEARCH_DOMAINS = [
  'google.*',
  'bing.com',
  'duckduckgo.com',
  'yahoo.*',
  'ecosia.org',
  'baidu.com',
  'yandex.*',
  'search.brave.com',
  'startpage.com',
];

/**
 * The visitor's acquisition channel. UTMs win over the referrer: `utm_medium`
 * (case-insensitive) picks paid, email, social, search (`organic`) or referral,
 * and any other UTM is a campaign. Without UTMs the referrer's hostname picks
 * email (webmail), social, search, or referral for any other site. Nothing at
 * all is direct.
 */
export function classifyChannel(acquisition: Acquisition): AcquisitionChannel {
  const { utm, referrerDomain } = acquisition;
  if (utm && Object.keys(utm).length > 0) return mediumChannel(utm.medium);
  if (!referrerDomain) return 'direct';
  return referrerChannel(referrerDomain.toLowerCase());
}

function mediumChannel(rawMedium: string | undefined): AcquisitionChannel {
  const medium = rawMedium?.trim().toLowerCase() ?? '';
  if (medium.startsWith('paid') || PAID_MEDIUMS.includes(medium)) return 'paid';
  if (EMAIL_MEDIUMS.includes(medium)) return 'email';
  if (SOCIAL_MEDIUMS.includes(medium)) return 'social';
  if (medium === 'organic') return 'search';
  if (medium === 'referral') return 'referral';
  return 'campaign';
}

function referrerChannel(host: string): AcquisitionChannel {
  if (matchesAny(host, EMAIL_DOMAINS)) return 'email';
  if (matchesAny(host, SOCIAL_DOMAINS)) return 'social';
  if (matchesAny(host, SEARCH_DOMAINS)) return 'search';
  return 'referral';
}

function matchesAny(host: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => matchesDomain(host, pattern));
}

function matchesDomain(host: string, pattern: string): boolean {
  if (!pattern.endsWith('.*')) return host === pattern || host.endsWith(`.${pattern}`);

  // `brand.*`: some label is the brand, followed by a one- or two-label suffix
  // of short labels (`com`, `de`, `co.uk`, `com.au`).
  const brand = pattern.slice(0, -2);
  const labels = host.split('.');
  const index = labels.lastIndexOf(brand);
  if (index === -1) return false;
  const suffix = labels.slice(index + 1);
  return (
    suffix.length >= 1 && suffix.length <= 2 && suffix.every((label) => /^[a-z]{2,3}$/.test(label))
  );
}
