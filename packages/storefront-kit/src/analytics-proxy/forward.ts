// Imperative shell of the first-party Amplitude forwarder: reads the request,
// asks the core what to do, and makes the one upstream call. Server-only, and
// separate from `/analytics` so a server bundle never touches the SDK module.
import type { AmplitudeServerZone } from '../analytics/core.js';
import {
  decideUploadBody,
  decideUploadHead,
  trafficClassFrom,
  UPLOAD_LIMIT_BYTES,
  type UploadRejection,
  visitorLocationFromCf,
} from './core.js';

export interface ForwardToAmplitudeOptions {
  /** Default: `US`. Must match the zone the site's `initAnalytics` uses. */
  serverZone?: AmplitudeServerZone;
  /** Injected in tests. Default: the global `fetch`. */
  fetch?: typeof fetch;
}

/**
 * Forwards one Amplitude SDK upload to Amplitude's HTTP V2 API and returns its
 * status and body. Only the JSON body goes upstream — no cookies, client
 * headers or IP — with the visitor's city-level location from Cloudflare's
 * `request.cf` added to each event, and a `traffic_class` event property
 * (`verified_bot`, `known_bot`, `datacenter` or `human`) computed from
 * `request.cf` and the `User-Agent` header, replacing any the client sent. The
 * user agent and ASN themselves are never forwarded. Refuses a non-POST (405), a body that isn't
 * uncompressed JSON (415), one over 1 MB (413) or invalid JSON (400); a network
 * failure reaching Amplitude answers 502.
 */
export async function forwardToAmplitude(
  request: Request,
  options: ForwardToAmplitudeOptions = {},
): Promise<Response> {
  const head = decideUploadHead({
    method: request.method,
    contentType: request.headers.get('content-type'),
    contentEncoding: request.headers.get('content-encoding'),
    contentLength: request.headers.get('content-length'),
  });
  if (head.action === 'reject') return rejectionResponse(head);

  const cf = (request as { cf?: unknown }).cf;
  const decision = decideUploadBody(await readAtMost(request, UPLOAD_LIMIT_BYTES + 1), {
    serverZone: options.serverZone ?? 'US',
    location: visitorLocationFromCf(cf),
    trafficClass: trafficClassFrom({ cf, userAgent: request.headers.get('user-agent') }),
  });
  if (decision.action === 'reject') return rejectionResponse(decision);

  const send = options.fetch ?? fetch;
  let upstream: Response;
  try {
    upstream = await send(decision.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: '*/*' },
      body: decision.body,
    });
  } catch {
    return textResponse(502, 'Could not reach Amplitude.');
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
      'cache-control': 'no-store',
    },
  });
}

/** Reads the body, stopping once it passes `limit` bytes, so an oversized
 * stream without a Content-Length is never buffered whole. */
async function readAtMost(request: Request, limit: number): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  if (total >= limit) await reader.cancel().catch(() => {});

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function rejectionResponse(rejection: UploadRejection): Response {
  return textResponse(
    rejection.status,
    rejection.message,
    rejection.status === 405 ? { allow: 'POST' } : {},
  );
}

function textResponse(status: number, message: string, headers: Record<string, string> = {}) {
  return new Response(message, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}
