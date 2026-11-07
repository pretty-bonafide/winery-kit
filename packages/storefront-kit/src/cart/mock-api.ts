import { createMockCartId, getMockCart, MOCK_CART_COOKIE } from './mock-cart-store.js';

// Structural subset of Astro's APIContext — the kit works with any framework
// that exposes cookie get/set, without depending on Astro itself.
export interface MockApiCookieContext {
  cookies: {
    get(name: string): { value: string } | undefined;
    set(
      name: string,
      value: string,
      options: {
        path?: string;
        sameSite?: 'lax' | 'strict' | 'none';
        httpOnly?: boolean;
        maxAge?: number;
      },
    ): void;
  };
}

const cookieOptions = {
  path: '/',
  sameSite: 'lax' as const,
  httpOnly: false,
  maxAge: 60 * 60 * 24 * 30,
};

export function getMockCartId(context: MockApiCookieContext) {
  const existingCartId = context.cookies.get(MOCK_CART_COOKIE)?.value;
  if (existingCartId) return existingCartId;

  const cartId = createMockCartId();
  context.cookies.set(MOCK_CART_COOKIE, cartId, cookieOptions);
  return cartId;
}

export function getRequestMockCart(context: MockApiCookieContext) {
  return getMockCart(getMockCartId(context));
}

export function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  headers.set('Cache-Control', 'private, no-store');

  return new Response(JSON.stringify(data), {
    ...init,
    headers,
  });
}

export async function readJsonBody(request: Request) {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}
