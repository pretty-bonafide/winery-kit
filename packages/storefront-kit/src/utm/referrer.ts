// Pure referrer reduction and internal-host detection. No globals: the shell
// (storage.ts) passes in `document.referrer` and the page's hostname.

/**
 * Reduces a referrer URL to its hostname: lowercase, no scheme, port, path,
 * query or trailing dot. A full referrer URL is never kept. Anything that isn't
 * an http(s) URL (empty, `android-app://…`, garbage) is no referrer.
 */
export function referrerHostname(referrer: string): string | null {
  let url: URL;
  try {
    url = new URL(referrer.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return cleanHostname(url.hostname);
}

/** A hostname (`store.example.com`) or origin (`https://store.example.com`)
 * reduced to its lowercase hostname, or null when it's neither. */
export function toHostname(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return cleanHostname(
      new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).hostname,
    );
  } catch {
    return null;
  }
}

/**
 * Merges `www.` with its bare domain: strips a single leading `www.` when a
 * domain remains (`www.instagram.com` → `instagram.com`). Other subdomains stay
 * (`l.instagram.com`, `news.google.com`), and so does a host that is only
 * `www.` plus one label.
 */
export function withoutWww(host: string): string {
  return host.startsWith('www.') && host.split('.').length > 2 ? host.slice(4) : host;
}

/** A stored or reported referrer domain: the lowercase hostname of a hostname
 * or origin, without a leading `www.`; null when it's neither. */
export function normalizeReferrerDomain(value: string): string | null {
  const host = toHostname(value);
  return host ? withoutWww(host) : null;
}

function cleanHostname(hostname: string): string | null {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return host || null;
}

/**
 * The site's own domain, naively: the last two labels of the hostname, so
 * `www.example.com` and `store.example.com` both give `example.com`.
 *
 * Limitation: this ignores the public suffix list, so under a multi-label
 * suffix (`shop.example.co.uk` and `other.co.uk` both give `co.uk`) unrelated
 * sites share a domain. Name such hosts' siblings in `internalHosts` instead of
 * relying on this. IP addresses and single-label hosts are returned whole.
 */
export function siteDomain(hostname: string): string {
  const host = hostname.toLowerCase();
  if (host.startsWith('[') || /^\d+(\.\d+){3}$/.test(host)) return host;
  return host.split('.').slice(-2).join('.');
}

export interface InternalHostContext {
  /** The current page's hostname (`window.location.hostname`). */
  pageHost: string;
  /** Extra hostnames the brand owns on other domains (e.g. its store). */
  internalHosts: readonly string[];
}

/** A referrer is internal when it's the page's own host, shares the page's
 * site domain, or is one of the configured internal hosts. */
export function isInternalReferrer(referrerHost: string, context: InternalHostContext): boolean {
  const pageHost = context.pageHost.toLowerCase();
  return (
    referrerHost === pageHost ||
    (pageHost !== '' && siteDomain(referrerHost) === siteDomain(pageHost)) ||
    context.internalHosts.includes(referrerHost)
  );
}

/**
 * Normalizes configured internal hosts (origins or hostnames) to hostnames. A
 * value that is neither is a provisioning mistake and throws naming it
 * (RULES.md §5).
 */
export function resolveInternalHosts(values: readonly string[]): string[] {
  return values.map((value) => {
    const host = toHostname(value);
    if (!host) {
      throw new Error(
        `configureUtmStorage: \`internalHosts\` entry "${value}" is not a hostname or origin.`,
      );
    }
    return host;
  });
}

/** The external referrer's hostname for this landing, without a leading
 * `www.`, or null when there is none or it is internal (navigation within the
 * brand's own property). Internal detection sees the full hostname. */
export function externalReferrerDomain(
  referrer: string,
  context: InternalHostContext,
): string | null {
  const host = referrerHostname(referrer);
  if (!host || isInternalReferrer(host, context)) return null;
  return withoutWww(host);
}
