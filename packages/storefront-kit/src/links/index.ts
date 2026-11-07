/**
 * Headless construction of store-bound URLs (club signup, etc.). Pure and
 * env-free: callers inject the origin/config so the kit stays framework- and
 * deployment-agnostic. UTM attribution is layered on separately at runtime by
 * the client-side forwarder (`../utm/forward-links`) — these helpers only build
 * the bare href.
 */

/**
 * Resolves the store-site origin from either an explicit origin or a fuller URL
 * (e.g. a storefront API base like `https://store.example.com/api/public/v1`).
 * The `fallback` is required because the kit has no hardcoded default; an empty
 * or unparseable input degrades to it rather than throwing.
 */
export function resolveStoreOrigin(
  apiUrlOrOrigin: string | null | undefined,
  fallback: string,
): string {
  if (!apiUrlOrOrigin) return fallback;

  try {
    return new URL(apiUrlOrOrigin).origin;
  } catch {
    return fallback;
  }
}

/** A slug as one URL value; a blank slug is a caller bug, so it throws. */
function requireSlug(slug: string, name: string): string {
  const trimmed = slug.trim();
  if (!trimmed) throw new Error(`${name} must be a non-empty slug.`);
  return trimmed;
}

export type BuildClubJoinUrlOptions = { storeOrigin: string } & (
  | {
      /** Path to the club-signup page on the store. Defaults to the canonical `/clubs`. */
      path?: string;
      club?: never;
    }
  | {
      /** The club's slug on the platform: opens that club's join flow, `/clubs/<slug>/join`. */
      club: string;
      path?: never;
    }
);

/**
 * Builds the club-signup URL on the store: the club listing
 * (`https://store.example.com/clubs`), a custom `path`, or one club's join flow
 * (`https://store.example.com/clubs/villa-creek-reserve/join`) when `club` is given.
 * `storeOrigin` is used for its origin only. Throws on a blank `club`.
 */
export function buildClubJoinUrl(options: BuildClubJoinUrlOptions): string {
  const path =
    options.club !== undefined
      ? `/clubs/${encodeURIComponent(requireSlug(options.club, 'club'))}/join`
      : (options.path ?? '/clubs');
  return new URL(path, options.storeOrigin).toString();
}

export interface BuildBookingUrlOptions {
  storeOrigin: string;
  /** The experience's slug on the platform: winery-set and the same on every environment. */
  experience: string;
}

/**
 * Builds a deep link into the store's hosted booking flow, opened on the date
 * picker for one experience, e.g.
 * `https://store.example.com/visit?step=visit&experience=flagship-tasting`.
 * The store falls back to its experience picker when the slug is unknown or
 * not bookable online. `storeOrigin` is used for its origin only. Throws on a
 * blank `experience`.
 */
export function buildBookingUrl({ storeOrigin, experience }: BuildBookingUrlOptions): string {
  const url = new URL('/visit', storeOrigin);
  url.searchParams.set('step', 'visit');
  url.searchParams.set('experience', requireSlug(experience, 'experience'));
  return url.toString();
}
