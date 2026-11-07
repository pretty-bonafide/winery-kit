import { describe, expect, it } from 'vitest';
import {
  getWineryPrivacyPolicyPortableText,
  getWineryPrivacyPolicySections,
  isPlaceholderPrivacyPolicyContent,
} from './index';

const profile = {
  businessName: 'Example Winery',
  contactEmail: 'privacy@example.com',
  website: 'https://example.com',
  storeName: 'Example Store',
  collectsReservations: true,
  collectsEvents: true,
};

describe('winery privacy policy', () => {
  it('builds reusable section copy for a winery site', () => {
    const sections = getWineryPrivacyPolicySections(profile);

    expect(sections[0]?.body[0]).toContain('Example Winery');
    expect(sections.some((section) => section.title === 'Your Privacy Rights')).toBe(true);
    expect(sections.some((section) => section.body.join(' ').includes('privacy@example.com'))).toBe(
      true,
    );
  });

  it('renders section copy as portable text blocks', () => {
    const blocks = getWineryPrivacyPolicyPortableText(profile);

    expect(blocks[0]).toMatchObject({ _type: 'block', style: 'normal' });
    expect(blocks.some((block) => block.style === 'h2')).toBe(true);
    expect(blocks.some((block) => block.listItem === 'bullet')).toBe(true);
  });

  it('detects seeded placeholder privacy content', () => {
    const placeholder = [
      {
        _key: 'block1',
        _type: 'block',
        children: [
          {
            _key: 'span1',
            _type: 'span',
            text: 'This privacy policy describes how Example Winery collects, uses, and protects your personal information.',
          },
        ],
      },
    ];

    expect(isPlaceholderPrivacyPolicyContent(placeholder)).toBe(true);
    expect(isPlaceholderPrivacyPolicyContent(getWineryPrivacyPolicyPortableText(profile))).toBe(
      false,
    );
  });

  it('detects placeholders with hidden visual-editing characters', () => {
    const placeholder = [
      {
        _key: 'block1',
        _type: 'block',
        children: [
          {
            _key: 'span1',
            _type: 'span',
            text: 'This privacy policy describes how Example Winery collects, uses, and protects your personal information.\u200b\u200d\ufeff',
          },
        ],
      },
    ];

    expect(isPlaceholderPrivacyPolicyContent(placeholder)).toBe(true);
  });
});
