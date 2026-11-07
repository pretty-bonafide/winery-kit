// @vitest-environment node
// Server-side code: the platform's Request/Response, not happy-dom's.
import { describe, expect, it, vi } from 'vitest';
import { UPLOAD_LIMIT_BYTES } from './core.js';
import { forwardToAmplitude } from './index.js';

const UPLOAD = { api_key: 'k', events: [{ event_type: 'page_viewed' }] };

function upload(init: RequestInit & { cf?: unknown } = {}): Request {
  const { cf, ...rest } = init;
  const request = new Request('https://site.example/api/e', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(UPLOAD),
    ...rest,
  });
  if (cf !== undefined) Object.defineProperty(request, 'cf', { value: cf });
  return request;
}

function amplitudeReplying(status: number, body: string) {
  return vi.fn<typeof fetch>(
    async () => new Response(body, { status, headers: { 'content-type': 'application/json' } }),
  );
}

describe('forwardToAmplitude', () => {
  it('posts only the JSON body to the fixed US upstream and returns its answer', async () => {
    const fetch = amplitudeReplying(200, '{"code":200}');
    const response = await forwardToAmplitude(
      upload({
        headers: {
          'content-type': 'application/json',
          cookie: 'session=secret',
          'cf-connecting-ip': '203.0.113.7',
          'x-forwarded-for': '203.0.113.7',
          'user-agent': 'browser',
        },
      }),
      { fetch },
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"code":200}');
    expect(response.headers.get('cache-control')).toBe('no-store');

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe('https://api2.amplitude.com/2/httpapi');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({ 'content-type': 'application/json', accept: '*/*' });
    expect(JSON.parse(String(init?.body))).toEqual(UPLOAD);
  });

  it('uses the EU upstream for the EU zone', async () => {
    const fetch = amplitudeReplying(200, '{}');
    await forwardToAmplitude(upload(), { serverZone: 'EU', fetch });
    expect(fetch.mock.calls[0]?.[0]).toBe('https://api.eu.amplitude.com/2/httpapi');
  });

  it("adds the visitor's city-level location from request.cf, never an IP", async () => {
    const fetch = amplitudeReplying(200, '{}');
    await forwardToAmplitude(
      upload({
        body: JSON.stringify({ api_key: 'k', events: [{ event_type: 'x', ip: '$remote' }] }),
        cf: { country: 'US', region: 'California', city: 'Napa', latitude: '38.2' },
      }),
      { fetch },
    );
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      api_key: 'k',
      events: [{ event_type: 'x', country: 'United States', region: 'California', city: 'Napa' }],
    });
  });

  it("passes Amplitude's error status and body through", async () => {
    const fetch = amplitudeReplying(400, '{"code":400,"error":"Invalid API key: x"}');
    const response = await forwardToAmplitude(upload(), { fetch });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('Invalid API key');
  });

  it('answers 502 when Amplitude cannot be reached', async () => {
    const fetch = vi.fn<typeof fetch>(async () => {
      throw new TypeError('fetch failed');
    });
    const response = await forwardToAmplitude(upload(), { fetch });
    expect(response.status).toBe(502);
  });

  it('refuses a GET with 405 and Allow: POST, without calling Amplitude', async () => {
    const fetch = amplitudeReplying(200, '{}');
    const response = await forwardToAmplitude(
      new Request('https://site.example/api/e', { method: 'GET' }),
      { fetch },
    );
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses a non-JSON body with 415', async () => {
    const fetch = amplitudeReplying(200, '{}');
    const response = await forwardToAmplitude(
      upload({ headers: { 'content-type': 'text/plain;charset=UTF-8' } }),
      { fetch },
    );
    expect(response.status).toBe(415);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses malformed JSON with 400', async () => {
    const fetch = amplitudeReplying(200, '{}');
    const response = await forwardToAmplitude(upload({ body: '{"events":' }), { fetch });
    expect(response.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses an oversized body with 413, declared or streamed', async () => {
    const fetch = amplitudeReplying(200, '{}');
    const big = `{"pad":"${'x'.repeat(UPLOAD_LIMIT_BYTES)}"}`;

    const declared = await forwardToAmplitude(
      upload({
        body: big,
        headers: { 'content-type': 'application/json', 'content-length': String(big.length) },
      }),
      { fetch },
    );
    expect(declared.status).toBe(413);

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const chunk = new Uint8Array(64 * 1024).fill(0x20);
        for (let sent = 0; sent <= UPLOAD_LIMIT_BYTES; sent += chunk.byteLength) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    });
    const streamed = await forwardToAmplitude(
      upload({ body: stream, duplex: 'half' } as RequestInit),
      { fetch },
    );
    expect(streamed.status).toBe(413);
    expect(fetch).not.toHaveBeenCalled();
  });
});
