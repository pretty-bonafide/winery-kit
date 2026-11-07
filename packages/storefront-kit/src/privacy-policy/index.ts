export const DEFAULT_WINERY_PRIVACY_POLICY_EFFECTIVE_DATE = '2026-06-16';

export interface WineryPrivacyPolicyProfile {
  businessName: string;
  contactEmail: string;
  website?: string;
  contactPhone?: string;
  mailingAddress?: string;
  storeName?: string;
  effectiveDate?: string;
  collectsReservations?: boolean;
  collectsEvents?: boolean;
  usesCustomerAccounts?: boolean;
  usesMarketingAttribution?: boolean;
  sellsPersonalInformation?: boolean;
  sharesForCrossContextAdvertising?: boolean;
}

export interface WineryPrivacyPolicySection {
  id: string;
  title: string;
  body: string[];
  bullets?: string[];
}

export interface PrivacyPolicyPortableTextSpan {
  _key: string;
  _type: 'span';
  marks: string[];
  text: string;
}

export interface PrivacyPolicyPortableTextBlock {
  _key: string;
  _type: 'block';
  style: 'normal' | 'h2';
  markDefs: [];
  children: PrivacyPolicyPortableTextSpan[];
  listItem?: 'bullet';
  level?: number;
}

interface NormalizedPrivacyPolicyProfile extends WineryPrivacyPolicyProfile {
  effectiveDate: string;
  storeName: string;
  usesCustomerAccounts: boolean;
  usesMarketingAttribution: boolean;
  sellsPersonalInformation: boolean;
  sharesForCrossContextAdvertising: boolean;
}

const PLACEHOLDER_PRIVACY_POLICY_SNIPPETS = [
  'this privacy policy describes how',
  'this privacy policy is managed through our content management system',
  'please check back later or contact us for more information',
];

export function getWineryPrivacyPolicySections(
  profile: WineryPrivacyPolicyProfile,
): WineryPrivacyPolicySection[] {
  const normalized = normalizeProfile(profile);
  const siteLabel = normalized.website ?? 'our website';
  const legalDisclosure = getSaleOrShareDisclosure(normalized);
  const reservationsOrEvents = getReservationAndEventUses(normalized);

  return [
    {
      id: 'overview',
      title: 'Overview',
      body: [
        `This Privacy Policy explains how ${normalized.businessName} collects, uses, discloses, and protects personal information when you visit ${siteLabel}, join our mailing list, contact us, buy wine, join a club or allocation, or otherwise interact with us online.`,
        `Wine purchases, club activity, account sign-in, fulfillment, and payment processing may be handled through ${normalized.storeName} and other service providers. Those providers process information for us so we can operate the winery, sell and ship wine, and support customer relationships.`,
      ],
    },
    {
      id: 'information-we-collect',
      title: 'Information We Collect',
      body: ['The information we collect depends on how you interact with us. It may include:'],
      bullets: [
        'Contact details such as name, email address, phone number, billing address, shipping address, and messages you send us.',
        'Commerce and account details such as cart contents, order history, club or allocation status, customer identifiers, shipping preferences, delivery details, age or eligibility confirmations, and payment status. Full payment card numbers are handled by payment processors and secure checkout providers; winery marketing sites should not intentionally store full card numbers.',
        'Newsletter and marketing details such as subscription status, communication preferences, and responses to winery emails or forms.',
        'Site, device, and attribution details such as IP address, browser and device information, referring pages, pages viewed, dates and times of visits, approximate location inferred from network data, cart or session identifiers, cookies, local storage, and UTM or campaign parameters.',
        'Reservation, tasting, event, or inquiry details if the site offers bookings, event purchases, visit requests, waitlists, or contact forms.',
      ],
    },
    {
      id: 'how-we-use-information',
      title: 'How We Use Information',
      body: [
        'We use personal information for ordinary winery and ecommerce purposes, including to:',
      ],
      bullets: [
        'Process orders, manage carts and checkout, fulfill shipments, handle returns or customer service, and maintain purchase records.',
        'Operate clubs, allocations, waitlists, member pricing, release access, and other customer-specific wine offers.',
        ...reservationsOrEvents,
        'Respond to questions, inquiries, support requests, and account or sign-in activity.',
        'Send newsletters, release notices, event updates, transactional messages, and other communications you request or that relate to your relationship with us.',
        'Understand how visitors find and use our sites, measure campaign performance, improve site content, diagnose technical issues, prevent fraud, and keep the site secure.',
        'Comply with legal, tax, age-restricted product, shipping, alcohol beverage, and recordkeeping obligations.',
      ],
    },
    {
      id: 'cookies-and-attribution',
      title: 'Cookies, Local Storage, and Similar Technologies',
      body: [
        'Our sites and service providers may use cookies, local storage, pixels, logs, and similar technologies to keep carts and sessions working, remember attribution details, support account sign-in, measure site performance, and protect the site.',
        'You can usually adjust cookie settings through your browser. Blocking cookies or clearing local storage may affect cart, checkout, sign-in, and other site features. Our sites do not currently respond to browser Do Not Track signals because there is no uniform industry standard for those signals.',
      ],
    },
    {
      id: 'how-we-disclose-information',
      title: 'How We Disclose Information',
      body: [
        'We disclose personal information only as needed to operate the winery and the services you request. Categories of recipients may include:',
      ],
      bullets: [
        'Commerce, checkout, payment, fraud prevention, tax, shipping, fulfillment, reservation, email, SMS, CRM, analytics, hosting, CMS, and customer support providers.',
        'Professional advisors, insurers, auditors, and service providers who help us run the business.',
        'Government, law enforcement, regulators, courts, carriers, or other parties when required by law or when needed to protect rights, safety, security, or compliance.',
        'Successors or counterparties if we evaluate or complete a merger, acquisition, financing, restructuring, or sale of business assets.',
      ],
    },
    {
      id: 'sale-or-sharing',
      title: 'Sale or Sharing of Personal Information',
      body: [legalDisclosure],
    },
    {
      id: 'marketing-choices',
      title: 'Marketing Choices',
      body: [
        `You can unsubscribe from marketing emails by using the unsubscribe link in an email or by contacting us at ${normalized.contactEmail}. We may still send transactional or service messages, such as order, club, account, shipping, policy, or security notices.`,
      ],
    },
    {
      id: 'privacy-rights',
      title: 'Your Privacy Rights',
      body: [
        `Depending on where you live and which privacy laws apply, you may have the right to request access to, correction of, deletion of, or portability of personal information, and to object to or opt out of certain processing. You may also have the right not to be discriminated against for exercising privacy rights.`,
        `To make a request, contact us at ${normalized.contactEmail}${normalized.contactPhone ? ` or ${normalized.contactPhone}` : ''}. We may need to verify your identity before acting on a request. Some information may be exempt from a request, including information we must keep for legal, tax, alcohol beverage, shipping, security, fraud prevention, or transaction-record purposes.`,
      ],
    },
    {
      id: 'retention',
      title: 'Retention',
      body: [
        'We keep personal information for as long as needed for the purposes described in this policy, including to provide services, maintain business records, resolve disputes, enforce agreements, prevent fraud, and satisfy legal, tax, alcohol beverage, and shipping obligations. When information is no longer needed, we will delete it, de-identify it, or retain it only as permitted by law.',
      ],
    },
    {
      id: 'security',
      title: 'Security',
      body: [
        'We use reasonable administrative, technical, and physical safeguards designed to protect personal information. No website, network, transmission, or storage system is completely secure, so we cannot guarantee absolute security.',
      ],
    },
    {
      id: 'age-restricted-products',
      title: 'Age-Restricted Products',
      body: [
        'Our sites and wine sales are intended for people who are at least 21 years old. Do not submit personal information or attempt to purchase alcohol if you are not of legal drinking age. We do not knowingly collect personal information from children under 13.',
      ],
    },
    {
      id: 'changes-and-contact',
      title: 'Changes and Contact',
      body: [
        `We may update this Privacy Policy from time to time. The effective date shows when this version was last updated. If you have questions or requests, contact ${normalized.businessName} at ${normalized.contactEmail}${normalized.contactPhone ? ` or ${normalized.contactPhone}` : ''}${normalized.mailingAddress ? `, or by mail at ${normalized.mailingAddress}` : ''}.`,
      ],
    },
  ];
}

export function getWineryPrivacyPolicyPortableText(
  profile: WineryPrivacyPolicyProfile,
): PrivacyPolicyPortableTextBlock[] {
  let blockIndex = 0;
  const blocks: PrivacyPolicyPortableTextBlock[] = [];

  const pushBlock = (
    text: string,
    style: PrivacyPolicyPortableTextBlock['style'] = 'normal',
    listItem?: PrivacyPolicyPortableTextBlock['listItem'],
  ) => {
    const key = `privacy-policy-${blockIndex}`;
    blockIndex += 1;
    blocks.push({
      _key: key,
      _type: 'block',
      style,
      markDefs: [],
      children: [
        {
          _key: `${key}-span`,
          _type: 'span',
          marks: [],
          text,
        },
      ],
      ...(listItem ? { level: 1, listItem } : {}),
    });
  };

  for (const section of getWineryPrivacyPolicySections(profile)) {
    if (section.id !== 'overview') pushBlock(section.title, 'h2');
    for (const paragraph of section.body) pushBlock(paragraph);
    for (const bullet of section.bullets ?? []) pushBlock(bullet, 'normal', 'bullet');
  }

  return blocks;
}

export function isPlaceholderPrivacyPolicyContent(value: unknown): boolean {
  const text = normalizePlainText(getPortableTextPlainText(value)).trim().toLowerCase();
  if (!text) return true;

  const hasPlaceholderSnippet = PLACEHOLDER_PRIVACY_POLICY_SNIPPETS.some((snippet) =>
    text.includes(snippet),
  );

  return hasPlaceholderSnippet && (text.length < 280 || getPortableTextTextBlockCount(value) <= 1);
}

export function getPrivacyPolicyEffectiveDate(profile: WineryPrivacyPolicyProfile): string {
  return profile.effectiveDate ?? DEFAULT_WINERY_PRIVACY_POLICY_EFFECTIVE_DATE;
}

function normalizeProfile(profile: WineryPrivacyPolicyProfile): NormalizedPrivacyPolicyProfile {
  return {
    ...profile,
    effectiveDate: getPrivacyPolicyEffectiveDate(profile),
    storeName: profile.storeName ?? 'our online store',
    usesCustomerAccounts: profile.usesCustomerAccounts ?? true,
    usesMarketingAttribution: profile.usesMarketingAttribution ?? true,
    sellsPersonalInformation: profile.sellsPersonalInformation ?? false,
    sharesForCrossContextAdvertising: profile.sharesForCrossContextAdvertising ?? false,
  };
}

function getSaleOrShareDisclosure(profile: NormalizedPrivacyPolicyProfile): string {
  if (profile.sellsPersonalInformation || profile.sharesForCrossContextAdvertising) {
    return 'If we sell personal information or share personal information for cross-context behavioral advertising as those terms are defined by applicable privacy law, we will provide the required notices and opt-out choices.';
  }

  return 'We do not sell personal information. We also do not share personal information for cross-context behavioral advertising as those terms are defined by California privacy law. We may disclose information to service providers that process it for us under contract.';
}

function getReservationAndEventUses(profile: NormalizedPrivacyPolicyProfile): string[] {
  const uses: string[] = [];
  if (profile.collectsReservations) {
    uses.push(
      'Manage tasting appointments, visit requests, reservations, and hospitality communications.',
    );
  }
  if (profile.collectsEvents) {
    uses.push(
      'Manage event listings, event purchases, calendar links, attendance, and event-related communications.',
    );
  }
  if (uses.length === 0) {
    uses.push(
      'Manage inquiries, waitlists, customer requests, and hospitality communications when offered.',
    );
  }
  return uses;
}

function getPortableTextPlainText(value: unknown): string {
  if (!Array.isArray(value)) return '';

  return value
    .map((block) => {
      if (!isRecord(block)) return '';
      const children = block.children;
      if (!Array.isArray(children)) return '';
      return children
        .map((child) => (isRecord(child) && typeof child.text === 'string' ? child.text : ''))
        .join('');
    })
    .filter(Boolean)
    .join(' ');
}

function getPortableTextTextBlockCount(value: unknown): number {
  if (!Array.isArray(value)) return 0;

  return value.filter((block) => {
    if (!isRecord(block)) return false;
    const children = block.children;
    return (
      Array.isArray(children) &&
      children.some((child) => isRecord(child) && typeof child.text === 'string')
    );
  }).length;
}

function normalizePlainText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\p{Cf}/gu, '')
    .replace(/\s+/g, ' ');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
