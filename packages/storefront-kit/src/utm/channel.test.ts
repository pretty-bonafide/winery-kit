import { describe, expect, it } from 'vitest';
import { type AcquisitionChannel, classifyChannel } from './channel.js';
import type { Acquisition, UtmParams } from './core.js';

const byMedium = (medium: string, referrerDomain: string | null = null) =>
  classifyChannel({ utm: { source: 'x', medium }, referrerDomain });

const byReferrer = (referrerDomain: string) => classifyChannel({ utm: null, referrerDomain });

describe('classifyChannel with UTMs', () => {
  it.each<[string, AcquisitionChannel]>([
    ['cpc', 'paid'],
    ['PPC', 'paid'],
    ['paid', 'paid'],
    ['paidsocial', 'paid'],
    ['paid_social', 'paid'],
    ['Paid-Search', 'paid'],
    ['display', 'paid'],
    ['cpm', 'paid'],
    ['email', 'email'],
    ['E-Mail', 'email'],
    ['newsletter', 'email'],
    ['social', 'social'],
    ['social-media', 'social'],
    ['organic_social', 'social'],
    ['organic', 'search'],
    ['referral', 'referral'],
    [' Email ', 'email'],
    ['print', 'campaign'],
    ['qr', 'campaign'],
    ['', 'campaign'],
  ])('utm_medium %j → %s', (medium, channel) => {
    expect(byMedium(medium)).toBe(channel);
  });

  it('is a campaign for any UTM without a medium', () => {
    expect(classifyChannel({ utm: { source: 'google' }, referrerDomain: null })).toBe('campaign');
    expect(classifyChannel({ utm: { campaign: 'harvest' }, referrerDomain: null })).toBe(
      'campaign',
    );
  });

  it('lets UTMs win over the referrer', () => {
    expect(byMedium('email', 'www.google.com')).toBe('email');
    expect(byMedium('print', 'l.instagram.com')).toBe('campaign');
  });

  it('treats empty UTM params as no UTMs', () => {
    expect(classifyChannel({ utm: {} as UtmParams, referrerDomain: 'www.google.com' })).toBe(
      'search',
    );
  });
});

describe('classifyChannel by referrer', () => {
  it.each([
    'google.com',
    'www.google.com',
    'www.google.co.uk',
    'google.de',
    'www.google.com.au',
    'bing.com',
    'www.bing.com',
    'duckduckgo.com',
    'yahoo.com',
    'search.yahoo.com',
    'yahoo.co.jp',
    'ecosia.org',
    'www.baidu.com',
    'yandex.ru',
    'yandex.com',
    'search.brave.com',
    'www.startpage.com',
  ])('%s → search', (host) => {
    expect(byReferrer(host)).toBe('search');
  });

  it.each([
    'facebook.com',
    'l.facebook.com',
    'lm.facebook.com',
    'm.facebook.com',
    'www.facebook.com',
    'instagram.com',
    'l.instagram.com',
    't.co',
    'x.com',
    'twitter.com',
    'www.linkedin.com',
    'lnkd.in',
    'pinterest.com',
    'www.pinterest.co.uk',
    'pin.it',
    'www.reddit.com',
    'out.reddit.com',
    'www.tiktok.com',
    'www.youtube.com',
    'm.youtube.com',
    'www.threads.net',
    'bsky.app',
  ])('%s → social', (host) => {
    expect(byReferrer(host)).toBe('social');
  });

  it.each([
    'mail.google.com',
    'outlook.live.com',
    'outlook.office.com',
    'mail.yahoo.com',
  ])('%s → email (webmail wins over search)', (host) => {
    expect(byReferrer(host)).toBe('email');
  });

  it.each([
    'www.winespectator.com',
    'news.example.org',
    'google.evil.com',
    'notgoogle.com',
    'box.com',
    'fakebing.com',
    'mail.example.com',
  ])('%s → referral', (host) => {
    expect(byReferrer(host)).toBe('referral');
  });

  it('matches case-insensitively', () => {
    expect(byReferrer('WWW.Google.COM')).toBe('search');
  });
});

describe('classifyChannel with nothing', () => {
  it('is direct', () => {
    expect(classifyChannel({ utm: null, referrerDomain: null })).toBe('direct');
  });
});

describe('classifyChannel with an ad click ID', () => {
  it.each<[string, Acquisition, AcquisitionChannel]>([
    [
      'gclid, no UTMs, google.com referrer',
      { utm: null, referrerDomain: 'google.com', clickId: 'google' },
      'paid',
    ],
    ['gclid alone', { utm: null, referrerDomain: null, clickId: 'google' }, 'paid'],
    ['msclkid alone', { utm: null, referrerDomain: 'bing.com', clickId: 'microsoft' }, 'paid'],
    ['ttclid alone', { utm: null, referrerDomain: null, clickId: 'tiktok' }, 'paid'],
    ['fbclid, no referrer', { utm: null, referrerDomain: null, clickId: 'meta' }, 'social'],
    [
      'fbclid, instagram referrer',
      { utm: null, referrerDomain: 'l.instagram.com', clickId: 'meta' },
      'social',
    ],
    [
      'fbclid, a press referrer',
      { utm: null, referrerDomain: 'winespectator.com', clickId: 'meta' },
      'social',
    ],
    [
      'utm_medium=email + gclid (a known medium wins)',
      { utm: { source: 'newsletter', medium: 'email' }, referrerDomain: null, clickId: 'google' },
      'email',
    ],
    [
      'utm_medium=paid_social + fbclid',
      { utm: { source: 'ig', medium: 'paid_social' }, referrerDomain: null, clickId: 'meta' },
      'paid',
    ],
    [
      'utm_medium=organic_social + gclid',
      { utm: { medium: 'organic_social' }, referrerDomain: null, clickId: 'google' },
      'social',
    ],
    [
      'an unknown utm_medium + gclid (the click ID beats campaign)',
      { utm: { source: 'google', medium: 'print' }, referrerDomain: null, clickId: 'google' },
      'paid',
    ],
    [
      'UTMs without a medium + msclkid',
      { utm: { campaign: 'harvest' }, referrerDomain: null, clickId: 'microsoft' },
      'paid',
    ],
    [
      'UTMs without a medium + fbclid',
      { utm: { source: 'fb' }, referrerDomain: null, clickId: 'meta' },
      'social',
    ],
    [
      'an unknown utm_medium, no click ID',
      { utm: { medium: 'print' }, referrerDomain: null },
      'campaign',
    ],
  ])('%s → %s', (_label, acquisition, channel) => {
    expect(classifyChannel(acquisition)).toBe(channel);
  });

  it('ignores a landing path (a direct record is still direct)', () => {
    expect(classifyChannel({ utm: null, referrerDomain: null, landingPath: '/wines' })).toBe(
      'direct',
    );
  });
});
