import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cartStore } from './cart-store';
import type {
  AddToCartInput,
  CartAdapter,
  CartLine,
  CartPromotionView,
  CartSnapshot,
} from './cart-types';
import { CartRequestError } from './cart-types';

function snapshot(id: string, lines: CartLine[]): CartSnapshot {
  return {
    id,
    currency: 'USD',
    itemCount: lines.reduce((n, l) => n + l.quantity, 0),
    subtotal: lines.reduce((n, l) => n + l.quantity * l.unitPrice, 0),
    checkoutUrl: '',
    lines,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const EMPTY = snapshot('cart', []);

const cab: AddToCartInput = {
  productId: 'p-cab',
  purchaseOptionId: 'v-cab',
  quantity: 1,
  display: { title: '2022 Cabernet', unitPrice: 4500, imageUrl: 'cab.jpg' },
};
const OPTIMISTIC_CAB_ID = 'opt:purchaseOption:v-cab';
// A server cart that names the cab line with its real (server) id.
const serverCabCart = snapshot('cart', [
  {
    id: 'srv-1',
    productId: 'p-cab',
    purchaseOptionId: 'v-cab',
    title: '2022 Cabernet',
    quantity: 1,
    unitPrice: 4500,
  },
]);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flush() {
  await Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function flushDebouncedCartWork() {
  await new Promise((resolve) => setTimeout(resolve, 650));
  await flush();
  await flush();
}

function stubAdapter(overrides: Partial<CartAdapter> = {}): CartAdapter {
  return {
    getCart: vi.fn(async () => EMPTY),
    addItem: vi.fn(async () => serverCabCart),
    updateItem: vi.fn(async () => EMPTY),
    removeItem: vi.fn(async () => EMPTY),
    createCheckout: vi.fn(async () => ({ url: 'https://checkout.example' })),
    ...overrides,
  };
}

describe('cartStore — local-first', () => {
  beforeEach(() => {
    // Reset module state: configuring with an adapter clears in-flight bookkeeping
    // and the seed flag; null initialCart leaves the store unseeded.
    cartStore.configure({ adapter: stubAdapter(), initialCart: null });
  });

  it('applies an add to local state immediately without publishing background sync as busy', () => {
    const gate = deferred<CartSnapshot>();
    cartStore.configure({
      adapter: stubAdapter({ addItem: () => gate.promise }),
      initialCart: EMPTY,
    });

    void cartStore.addItem(cab);

    const s = cartStore.getSnapshot();
    expect(s.cart?.lines).toHaveLength(1);
    expect(s.cart?.lines[0].id).toBe(OPTIMISTIC_CAB_ID);
    expect(s.cart?.itemCount).toBe(1);
    expect(s.isSidebarOpen).toBe(true);
    expect(s.isMutating).toBe(false);
    expect(s.lineSync[OPTIMISTIC_CAB_ID]).toBeUndefined();
  });

  it('keeps the local cart after the write resolves — does not reconcile to the server snapshot', async () => {
    // Server returns an unrelated extra line; the displayed cart must ignore it.
    const serverCart = snapshot('cart', [
      {
        id: 'srv-1',
        productId: 'p-cab',
        purchaseOptionId: 'v-cab',
        title: '2022 Cabernet',
        quantity: 1,
        unitPrice: 4500,
      },
      { id: 'ghost', productId: 'p-ghost', title: 'Ghost', quantity: 9, unitPrice: 100 },
    ]);
    cartStore.configure({
      adapter: stubAdapter({ addItem: async () => serverCart }),
      initialCart: EMPTY,
    });

    await cartStore.addItem(cab);
    await flushDebouncedCartWork();

    const s = cartStore.getSnapshot();
    expect(s.cart?.lines).toHaveLength(1);
    expect(s.cart?.lines[0].id).toBe(OPTIMISTIC_CAB_ID);
    expect(s.isMutating).toBe(false);
  });

  it('merges fresh promotion data from successful background writes', async () => {
    const serverCart = {
      ...serverCabCart,
      promotions: [
        {
          id: 'promo_free_ship',
          title: 'Free shipping',
          applied: false,
          nudge: 'Add $20.00 more for FREE ground shipping',
          progress: 0.6,
        },
      ],
    };
    cartStore.configure({
      adapter: stubAdapter({ addItem: async () => serverCart }),
      initialCart: EMPTY,
    });

    await cartStore.addItem(cab);
    await flushDebouncedCartWork();

    expect(cartStore.getSnapshot().cart?.lines[0].id).toBe(OPTIMISTIC_CAB_ID);
    expect(cartStore.getSnapshot().cart?.promotions).toEqual(serverCart.promotions);
  });

  it('merges a local add into a seeded line when product ids differ but the purchase option matches', async () => {
    const start = snapshot('cart', [
      {
        id: 'srv-1',
        productId: 'slug-cab',
        sku: 'cab-750',
        title: '2022 Cabernet Bottle',
        quantity: 1,
        unitPrice: 4500,
      },
    ]);
    cartStore.configure({ adapter: stubAdapter(), initialCart: start });

    await cartStore.addItem({ ...cab, sku: 'cab-750' });

    const s = cartStore.getSnapshot();
    expect(s.cart?.lines).toHaveLength(1);
    expect(s.cart?.lines[0]).toMatchObject({ id: 'srv-1', quantity: 2 });
  });

  it('adds a different variation of a seeded product as a new line, not a quantity bump', async () => {
    const start = snapshot('cart', [
      {
        id: 'srv-navy',
        productId: 'paso-hat',
        purchaseOptionId: 'var-navy',
        variantId: 'var-navy',
        title: 'Anniversary Logo Hat — Navy + Mesh',
        quantity: 1,
        unitPrice: 3200,
      },
    ]);
    const adapter = stubAdapter();
    cartStore.configure({ adapter, initialCart: start });

    await cartStore.addItem({
      productId: 'paso-hat',
      purchaseOptionId: 'var-black',
      variantId: 'var-black',
      quantity: 1,
      display: { title: 'Anniversary Logo Hat — Black', unitPrice: 3200 },
    });
    await flushDebouncedCartWork();

    const lines = cartStore.getSnapshot().cart?.lines ?? [];
    expect(lines.map((line) => [line.id, line.quantity])).toEqual([
      ['srv-navy', 1],
      ['opt:purchaseOption:var-black', 1],
    ]);
    expect(adapter.updateItem).not.toHaveBeenCalled();
    expect(adapter.addItem).toHaveBeenCalledWith(
      expect.objectContaining({ purchaseOptionId: 'var-black' }),
    );
  });

  it('keeps a failed optimistic add visible and marks it unsynced', async () => {
    const confirmed = snapshot('cart', [
      { id: 'kept', productId: 'p-keep', title: 'Kept', quantity: 1, unitPrice: 2000 },
    ]);
    const addItem = vi.fn(async () => {
      throw new CartRequestError({ code: 'item_unavailable', message: 'nope' });
    });
    cartStore.configure({
      adapter: stubAdapter({ addItem }),
      initialCart: confirmed,
    });

    await cartStore.addItem(cab);
    await flushDebouncedCartWork();

    const s = cartStore.getSnapshot();
    expect(addItem).toHaveBeenCalledOnce();
    expect(s.cart?.lines.map((l) => l.id).sort()).toEqual(['kept', OPTIMISTIC_CAB_ID].sort());
    expect(s.error?.code).toBe('item_unavailable');
    expect(s.lineSync[OPTIMISTIC_CAB_ID]).toMatchObject({
      status: 'failed',
      error: { code: 'item_unavailable' },
    });
    expect(s.isMutating).toBe(false);
  });

  it('debounces a burst of quantity updates into the latest write', async () => {
    const start = snapshot('cart', [
      { id: 'L1', productId: 'p1', title: 'Wine', quantity: 1, unitPrice: 1000 },
    ]);
    const updateItem = vi.fn(async () => EMPTY);
    cartStore.configure({ adapter: stubAdapter({ updateItem }), initialCart: start });

    void cartStore.updateItem('L1', 2);
    void cartStore.updateItem('L1', 3);
    void cartStore.updateItem('L1', 4);

    // Local state reflects the latest tap instantly.
    expect(cartStore.getSnapshot().cart?.lines[0].quantity).toBe(4);
    expect(cartStore.getSnapshot().isMutating).toBe(false);
    expect(cartStore.getSnapshot().lineSync.L1).toBeUndefined();

    await flushDebouncedCartWork();

    const quantitiesSent = updateItem.mock.calls.map((call) => call[1]);
    expect(quantitiesSent).toEqual([4]);
    expect(cartStore.getSnapshot().cart?.lines[0].quantity).toBe(4);
    expect(cartStore.getSnapshot().isMutating).toBe(false);
  });

  it('addresses the real server id for edits made after an add resolves', async () => {
    const updateItem = vi.fn(async () => EMPTY);
    cartStore.configure({
      adapter: stubAdapter({ addItem: async () => serverCabCart, updateItem }),
      initialCart: EMPTY,
    });

    await cartStore.addItem(cab);
    await flushDebouncedCartWork(); // optimistic id adopted → 'srv-1'
    void cartStore.updateItem(OPTIMISTIC_CAB_ID, 3);
    await flushDebouncedCartWork();

    expect(updateItem).toHaveBeenCalledWith('srv-1', 3);
  });

  it('defers an edit on a not-yet-acknowledged line until the add resolves', async () => {
    const gate = deferred<CartSnapshot>();
    const addItem = vi.fn(() => gate.promise);
    const updateItem = vi.fn(async () => EMPTY);
    cartStore.configure({ adapter: stubAdapter({ addItem, updateItem }), initialCart: EMPTY });

    void cartStore.addItem(cab);
    void cartStore.updateItem(OPTIMISTIC_CAB_ID, 5); // line not acknowledged yet
    await flush();

    expect(cartStore.getSnapshot().cart?.lines[0].quantity).toBe(5); // local applied
    expect(updateItem).not.toHaveBeenCalled(); // but no remote write yet

    await flushDebouncedCartWork();
    expect(addItem).toHaveBeenCalledWith({ ...cab, quantity: 5 });
    expect(updateItem).not.toHaveBeenCalled();

    gate.resolve(serverCabCart);
    await flush();

    expect(updateItem).not.toHaveBeenCalled();
  });

  it('seeds the displayed cart only on the initial load', async () => {
    const getCart = vi.fn(async () => EMPTY);
    cartStore.configure({ adapter: stubAdapter({ getCart }), initialCart: null });

    await cartStore.refresh(); // initial load seeds
    expect(getCart).toHaveBeenCalledTimes(1);

    await cartStore.addItem(cab);
    await flushDebouncedCartWork();
    getCart.mockClear();

    await cartStore.refresh(); // already seeded → no server read, no override
    expect(getCart).not.toHaveBeenCalled();
    expect(cartStore.getSnapshot().cart?.lines[0].id).toBe(OPTIMISTIC_CAB_ID);
  });

  it('blocks checkout when a visible line failed to persist', async () => {
    const createCheckout = vi.fn(async () => ({ url: 'https://checkout.example' }));
    cartStore.configure({
      adapter: stubAdapter({
        addItem: async () => {
          throw new CartRequestError({ code: 'item_unavailable', message: 'nope' });
        },
        createCheckout,
      }),
      initialCart: EMPTY,
    });

    await cartStore.addItem(cab);
    await flushDebouncedCartWork();

    await expect(cartStore.checkout()).rejects.toThrow('Some cart changes could not be saved');
    expect(createCheckout).not.toHaveBeenCalled();
    expect(cartStore.getSnapshot().error?.code).toBe('cart_request_failed');
  });

  it('waits for pending writes before creating checkout', async () => {
    const start = snapshot('cart', [
      { id: 'L1', productId: 'p1', title: 'Wine', quantity: 1, unitPrice: 1000 },
    ]);
    const gate = deferred<CartSnapshot>();
    const updateItem = vi.fn(() => gate.promise);
    const createCheckout = vi.fn(async () => ({ url: 'https://checkout.example' }));
    cartStore.configure({
      adapter: stubAdapter({ updateItem, createCheckout }),
      initialCart: start,
    });

    void cartStore.updateItem('L1', 2);
    const checkoutPromise = cartStore.checkout();
    await flush();

    expect(updateItem).toHaveBeenCalledWith('L1', 2);
    expect(createCheckout).not.toHaveBeenCalled();

    gate.resolve(
      snapshot('cart', [
        { id: 'L1', productId: 'p1', title: 'Wine', quantity: 2, unitPrice: 1000 },
      ]),
    );
    await checkoutPromise;

    expect(createCheckout).toHaveBeenCalledTimes(1);
  });

  it('marks failed quantity writes and clears the failure on the next edit', async () => {
    const start = snapshot('cart', [
      { id: 'L1', productId: 'p1', title: 'Wine', quantity: 1, unitPrice: 1000 },
    ]);
    const updateItem = vi
      .fn()
      .mockRejectedValueOnce(new CartRequestError({ code: 'invalid_quantity', message: 'nope' }))
      .mockResolvedValue(EMPTY);
    cartStore.configure({ adapter: stubAdapter({ updateItem }), initialCart: start });

    void cartStore.updateItem('L1', 3);
    await flushDebouncedCartWork();

    expect(cartStore.getSnapshot().cart?.lines[0].quantity).toBe(3);
    expect(cartStore.getSnapshot().lineSync.L1?.status).toBe('failed');

    void cartStore.updateItem('L1', 4);
    expect(cartStore.getSnapshot().lineSync.L1).toBeUndefined();
    await flushDebouncedCartWork();

    expect(cartStore.getSnapshot().lineSync.L1).toBeUndefined();
    expect(updateItem.mock.calls.map((call) => call[1])).toEqual([3, 4]);
  });

  it('ignores a stale in-flight failure when a newer quantity is queued', async () => {
    const start = snapshot('cart', [
      { id: 'L1', productId: 'p1', title: 'Wine', quantity: 1, unitPrice: 1000 },
    ]);
    const first = deferred<CartSnapshot>();
    const updateItem = vi.fn((_, quantity) => {
      if (quantity === 2) return first.promise;
      return Promise.resolve(EMPTY);
    });
    cartStore.configure({ adapter: stubAdapter({ updateItem }), initialCart: start });

    void cartStore.updateItem('L1', 2);
    await flushDebouncedCartWork();
    expect(updateItem).toHaveBeenCalledWith('L1', 2);

    void cartStore.updateItem('L1', 4);
    first.reject(new CartRequestError({ code: 'invalid_quantity', message: 'stale failure' }));
    await flushDebouncedCartWork();

    expect(updateItem.mock.calls.map((call) => call[1])).toEqual([2, 4]);
    expect(cartStore.getSnapshot().cart?.lines[0].quantity).toBe(4);
    expect(cartStore.getSnapshot().lineSync.L1).toBeUndefined();
    expect(cartStore.getSnapshot().error).toBeNull();
  });

  it('restores a removed line when the remote delete fails', async () => {
    const start = snapshot('cart', [
      { id: 'L1', productId: 'p1', title: 'Wine', quantity: 1, unitPrice: 1000 },
    ]);
    cartStore.configure({
      adapter: stubAdapter({
        removeItem: async () => {
          throw new CartRequestError({ code: 'cart_request_failed', message: 'delete failed' });
        },
      }),
      initialCart: start,
    });

    void cartStore.removeItem('L1');
    expect(cartStore.getSnapshot().cart?.lines).toHaveLength(0);

    await flushDebouncedCartWork();

    expect(cartStore.getSnapshot().cart?.lines[0]).toMatchObject({ id: 'L1', quantity: 1 });
    expect(cartStore.getSnapshot().lineSync.L1).toMatchObject({
      status: 'failed',
      error: { code: 'cart_request_failed' },
    });
  });
});

describe('cartStore — lazy promotion quote', () => {
  const FREE_SHIP = {
    id: 'promo_free_ship',
    title: 'Free shipping',
    applied: false,
    nudge: 'Add $20.00 more for FREE ground shipping',
    progress: 0.6,
  };
  const SPRING = { id: 'promo_spring', title: 'Spring Sale', applied: true };
  const L1 = snapshot('cart', [
    { id: 'L1', productId: 'p1', title: 'Wine', quantity: 1, unitPrice: 1000 },
  ]);

  beforeEach(() => {
    cartStore.closeSidebar();
    cartStore.configure({ adapter: stubAdapter(), initialCart: null });
  });

  it('does not quote on the boot refresh, and the cart renders without it', async () => {
    const getPromotions = vi.fn(async () => [FREE_SHIP]);
    cartStore.configure({
      adapter: stubAdapter({ getCart: async () => L1, getPromotions }),
      initialCart: null,
    });

    await cartStore.refresh();
    await flush();

    expect(cartStore.getSnapshot().cart?.itemCount).toBe(1);
    expect(getPromotions).not.toHaveBeenCalled();
  });

  it('quotes once when the sheet opens on a cart with lines', async () => {
    const getPromotions = vi.fn(async () => [FREE_SHIP]);
    cartStore.configure({ adapter: stubAdapter({ getPromotions }), initialCart: L1 });

    cartStore.openSidebar();
    cartStore.openSidebar(); // a second open while the quote is in flight
    await flush();

    expect(getPromotions).toHaveBeenCalledTimes(1);
    expect(cartStore.getSnapshot().cart?.promotions).toEqual([FREE_SHIP]);

    // Reopening an unchanged cart reuses the quote.
    cartStore.closeSidebar();
    cartStore.openSidebar();
    await flush();
    expect(getPromotions).toHaveBeenCalledTimes(1);
  });

  it('quotes after the boot read when the sheet was opened while loading', async () => {
    const load = deferred<CartSnapshot>();
    const getPromotions = vi.fn(async () => [FREE_SHIP]);
    cartStore.configure({
      adapter: stubAdapter({ getCart: () => load.promise, getPromotions }),
      initialCart: null,
    });

    void cartStore.refresh();
    cartStore.openSidebar();
    expect(getPromotions).not.toHaveBeenCalled();

    load.resolve(L1);
    await flush();

    expect(getPromotions).toHaveBeenCalledTimes(1);
    expect(cartStore.getSnapshot().cart?.promotions).toEqual([FREE_SHIP]);
  });

  it('never quotes an empty cart', async () => {
    const getPromotions = vi.fn(async () => [FREE_SHIP]);
    cartStore.configure({ adapter: stubAdapter({ getPromotions }), initialCart: EMPTY });

    cartStore.openSidebar();
    await flush();

    expect(getPromotions).not.toHaveBeenCalled();
  });

  it('clears promotions without quoting when the last line is removed', async () => {
    const getPromotions = vi.fn(async () => [FREE_SHIP]);
    cartStore.configure({ adapter: stubAdapter({ getPromotions }), initialCart: L1 });
    cartStore.openSidebar();
    await flush();
    expect(getPromotions).toHaveBeenCalledTimes(1);

    void cartStore.removeItem('L1');
    expect(cartStore.getSnapshot().cart?.promotions).toEqual([]);
    await flushDebouncedCartWork();

    expect(getPromotions).toHaveBeenCalledTimes(1);
  });

  it('re-quotes after a write settles only while the sheet is open', async () => {
    const getPromotions = vi.fn(async () => [FREE_SHIP]);
    const updateItem = vi.fn(async () => L1);
    cartStore.configure({
      adapter: stubAdapter({ getPromotions, updateItem }),
      initialCart: L1,
    });

    // Sheet closed: the write goes through, no quote.
    void cartStore.updateItem('L1', 2);
    await flushDebouncedCartWork();
    expect(updateItem).toHaveBeenCalledTimes(1);
    expect(getPromotions).not.toHaveBeenCalled();

    // Opening quotes the changed cart once.
    cartStore.openSidebar();
    await flush();
    expect(getPromotions).toHaveBeenCalledTimes(1);

    // Sheet open: a write that settles re-quotes once, not per tap.
    void cartStore.updateItem('L1', 3);
    void cartStore.updateItem('L1', 4);
    expect(getPromotions).toHaveBeenCalledTimes(1); // not while the write is pending
    await flushDebouncedCartWork();
    expect(updateItem).toHaveBeenCalledTimes(2);
    expect(getPromotions).toHaveBeenCalledTimes(2);
  });

  it('does not quote while a write has failed, and quotes again once it is fixed', async () => {
    const getPromotions = vi.fn(async () => [FREE_SHIP]);
    const updateItem = vi
      .fn<CartAdapter['updateItem']>()
      .mockRejectedValueOnce(new CartRequestError({ code: 'invalid_quantity', message: 'no' }))
      .mockResolvedValue(L1);
    cartStore.configure({ adapter: stubAdapter({ getPromotions, updateItem }), initialCart: L1 });
    cartStore.openSidebar();
    await flush();
    expect(getPromotions).toHaveBeenCalledTimes(1);
    expect(cartStore.getSnapshot().cart?.promotions).toEqual([FREE_SHIP]);

    void cartStore.updateItem('L1', 5);
    await flushDebouncedCartWork();
    expect(cartStore.getSnapshot().lineSync.L1).toMatchObject({ status: 'failed' });
    expect(getPromotions).toHaveBeenCalledTimes(1);
    expect(cartStore.getSnapshot().cart?.promotions).toEqual([]);

    void cartStore.updateItem('L1', 2);
    await flushDebouncedCartWork();
    expect(cartStore.getSnapshot().lineSync.L1).toBeUndefined();
    expect(getPromotions).toHaveBeenCalledTimes(2);
    expect(cartStore.getSnapshot().cart?.promotions).toEqual([FREE_SHIP]);
  });

  it('quotes once after an add (which opens the sheet) is acknowledged', async () => {
    const getPromotions = vi.fn(async () => [SPRING]);
    cartStore.configure({ adapter: stubAdapter({ getPromotions }), initialCart: EMPTY });

    await cartStore.addItem(cab);
    expect(cartStore.getSnapshot().isSidebarOpen).toBe(true);
    expect(getPromotions).not.toHaveBeenCalled();

    await flushDebouncedCartWork();
    expect(getPromotions).toHaveBeenCalledTimes(1);
    expect(cartStore.getSnapshot().cart?.promotions).toEqual([SPRING]);
  });

  it('discards a quote that lands after the cart changed, then quotes the newer cart', async () => {
    const first = deferred<CartPromotionView[]>();
    const second = deferred<CartPromotionView[]>();
    const getPromotions = vi
      .fn<() => Promise<CartPromotionView[]>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    cartStore.configure({
      adapter: stubAdapter({ getPromotions, updateItem: async () => L1 }),
      initialCart: L1,
    });

    cartStore.openSidebar();
    expect(getPromotions).toHaveBeenCalledTimes(1);

    void cartStore.updateItem('L1', 2);
    await flushDebouncedCartWork();
    // Only one quote in flight: the newer cart waits for the stale one.
    expect(getPromotions).toHaveBeenCalledTimes(1);

    first.resolve([FREE_SHIP]);
    await flush();
    expect(cartStore.getSnapshot().cart?.promotions ?? []).toEqual([]);
    expect(getPromotions).toHaveBeenCalledTimes(2);

    second.resolve([SPRING]);
    await flush();
    expect(cartStore.getSnapshot().cart?.promotions).toEqual([SPRING]);
  });

  it('ignores a quote from a replaced adapter, and drops its promotions', async () => {
    const stale = deferred<CartPromotionView[]>();
    cartStore.configure({
      adapter: stubAdapter({ getPromotions: () => stale.promise }),
      initialCart: { ...L1, promotions: [SPRING] },
    });
    cartStore.openSidebar(); // adapter A's quote is now in flight

    const fresh = vi.fn(async () => [FREE_SHIP]);
    cartStore.configure({ adapter: stubAdapter({ getPromotions: fresh }) });
    // The carried-over cart drops adapter A's promotions; adapter B quotes.
    expect(cartStore.getSnapshot().cart?.promotions).toEqual([]);
    expect(fresh).toHaveBeenCalledTimes(1);

    stale.resolve([SPRING]);
    await flush();
    expect(cartStore.getSnapshot().cart?.promotions).toEqual([FREE_SHIP]);
  });

  it('logs a failed quote, shows no promotions, and retries on the next open (no loop)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const getPromotions = vi
      .fn<() => Promise<CartPromotionView[]>>()
      .mockRejectedValueOnce(new CartRequestError({ code: 'cart_request_failed', message: '500' }))
      .mockResolvedValue([FREE_SHIP]);
    cartStore.configure({ adapter: stubAdapter({ getPromotions }), initialCart: L1 });

    cartStore.openSidebar();
    await flush();
    await flush();
    expect(getPromotions).toHaveBeenCalledTimes(1);
    expect(cartStore.getSnapshot().cart?.promotions ?? []).toEqual([]);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('promotion quote failed'),
      expect.anything(),
    );

    cartStore.closeSidebar();
    cartStore.openSidebar();
    await flush();
    expect(getPromotions).toHaveBeenCalledTimes(2);
    expect(cartStore.getSnapshot().cart?.promotions).toEqual([FREE_SHIP]);
    consoleError.mockRestore();
  });

  it('drops promotions for an older cart while the sheet is closed', async () => {
    const getPromotions = vi.fn(async () => [FREE_SHIP]);
    cartStore.configure({
      adapter: stubAdapter({ getPromotions, updateItem: async () => L1 }),
      initialCart: L1,
    });
    cartStore.openSidebar();
    await flush();
    cartStore.closeSidebar();

    void cartStore.updateItem('L1', 3);
    expect(cartStore.getSnapshot().cart?.promotions).toEqual([]);
    await flushDebouncedCartWork();
    expect(getPromotions).toHaveBeenCalledTimes(1);

    cartStore.openSidebar();
    await flush();
    expect(getPromotions).toHaveBeenCalledTimes(2);
    expect(cartStore.getSnapshot().cart?.promotions).toEqual([FREE_SHIP]);
  });

  it('still merges promotions from write responses for adapters without getPromotions', async () => {
    cartStore.configure({
      adapter: stubAdapter({ addItem: async () => ({ ...serverCabCart, promotions: [SPRING] }) }),
      initialCart: EMPTY,
    });

    await cartStore.addItem(cab);
    await flushDebouncedCartWork();

    expect(cartStore.getSnapshot().cart?.promotions).toEqual([SPRING]);
  });
});
