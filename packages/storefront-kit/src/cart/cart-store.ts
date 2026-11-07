import { appendUtmToUrl } from '../utm/core.js';
import { readStoredUtm } from '../utm/storage.js';
import type {
  AddToCartInput,
  CartAdapter,
  CartErrorPayload,
  CartLine,
  CartPromotionView,
  CartSnapshot,
} from './cart-types.js';
import { CartRequestError, toCartErrorPayload } from './cart-types.js';
import {
  applyAddItem,
  applyRemoveItem,
  applyUpdateItem,
  isOptimisticLineId,
  optimisticLineId,
  sameCartLine,
} from './optimistic.js';
import { decidePromotionQuote } from './promotion-quote.js';
import { restCartAdapter } from './rest-cart-client.js';

export interface CartStoreState {
  cart: CartSnapshot | null;
  error: CartErrorPayload | null;
  /** True after the host runtime selects the real adapter for this page. */
  isConfigured: boolean;
  isLoading: boolean;
  /** True only while checkout is flushing local changes and creating the
   * checkout session. Background cart persistence is intentionally invisible so
   * line controls and PDP CTAs stay responsive. */
  isMutating: boolean;
  isSidebarOpen: boolean;
  /** Per-visible-line persistence failure. Missing means the line is usable;
   * it may still be syncing in the background. */
  lineSync: Record<string, CartLineSyncState>;
  /** Last-known itemCount from a prior session (read from localStorage at boot).
   * Display-only: the cart indicator shows it before the live `cart` loads so the
   * badge doesn't pop in from empty on a cold page load. Always null on the
   * server snapshot (see getServerSnapshot) so SSR/hydration stay consistent;
   * the live `cart` supersedes it the moment a real cart is read. */
  persistedItemCount: number | null;
}

export interface CartLineSyncState {
  status: 'failed';
  error?: CartErrorPayload;
}

interface ConfigureCartStoreOptions {
  adapter?: CartAdapter;
  initialCart?: CartSnapshot | null;
}

type CartStoreListener = () => void;

const initialState: CartStoreState = {
  cart: null,
  error: null,
  isConfigured: false,
  isLoading: false,
  isMutating: false,
  isSidebarOpen: false,
  lineSync: {},
  persistedItemCount: null,
};

// Display-only last-known count, persisted across sessions/loads. Keyed once per
// origin (each winery site is its own origin), so no per-site key is needed.
const CART_COUNT_STORAGE_KEY = 'pg_cart_item_count_v1';

function loadPersistedItemCount(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CART_COUNT_STORAGE_KEY);
    if (raw == null) return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  } catch {
    return null;
  }
}

function persistItemCount(count: number | null) {
  if (typeof window === 'undefined') return;
  try {
    if (count == null) window.localStorage.removeItem(CART_COUNT_STORAGE_KEY);
    else window.localStorage.setItem(CART_COUNT_STORAGE_KEY, String(count));
  } catch {
    // localStorage may be unavailable (private mode / quota). It's display-only.
  }
}

let state = initialState;
// Seed the display-only count on the client so the indicator can render the
// last-known badge immediately on a cold load. initialState stays pristine for
// the server snapshot, so this never affects SSR or the hydration match.
const bootItemCount = loadPersistedItemCount();
if (bootItemCount != null) state = { ...state, persistedItemCount: bootItemCount };
let adapter: CartAdapter = restCartAdapter;
let refreshPromise: Promise<CartSnapshot> | null = null;
let adapterVersion = 0;

// --- Local-first model -------------------------------------------------------
// The displayed cart updates immediately. Remote writes are serialized per line
// in a small outbox, and checkout is the durability boundary: it waits for the
// outbox and refuses to continue while any visible line failed to persist.
let seeded = false;
let checkoutWrites = 0;
const serverLineIds = new Map<string, string>();
const optimisticInputs = new Map<string, AddToCartInput>();
const QUANTITY_WRITE_DEBOUNCE_MS = 500;
// Per-line quantity coalescing: while a line is debounced or in flight, further
// taps only update the desired quantity; the drain loop sends the latest once free.
const pendingQuantity = new Map<string, number>();
const drainingLines = new Map<string, Promise<void>>();
const drainTimers = new Map<string, ReturnType<typeof setTimeout>>();
const failedLineErrors = new Map<string, CartErrorPayload>();
const removedLineSnapshots = new Map<string, CartLine>();

// --- Lazy promotion quote -----------------------------------------------------
// Order promotions come from a separate quote read that only the open cart
// sheet shows. `cartGeneration` bumps whenever the displayed cart's contents
// change; a quote is tagged with the generation it was started for, so a result
// that lands after the cart moved on is discarded (see promotion-quote.ts).
let cartGeneration = 0;
let quotedGeneration: number | null = null;
let inFlightQuoteGeneration: number | null = null;

const listeners = new Set<CartStoreListener>();

function emit() {
  for (const listener of listeners) listener();
}

function buildLineSync(): Record<string, CartLineSyncState> {
  const visibleLineIds = new Set(state.cart?.lines.map((line) => line.id) ?? []);
  const lineSync: Record<string, CartLineSyncState> = {};

  for (const [lineId, error] of failedLineErrors) {
    if (visibleLineIds.has(lineId)) lineSync[lineId] = { status: 'failed', error };
  }

  return lineSync;
}

function setState(nextState: Partial<CartStoreState>) {
  state = { ...state, ...nextState };
  state = { ...state, lineSync: buildLineSync() };
  // Mirror the live count to localStorage whenever the cart changes, so the next
  // cold load can show it immediately (see persistedItemCount).
  if ('cart' in nextState) {
    const persistedItemCount = state.cart?.itemCount ?? null;
    state = { ...state, persistedItemCount };
    persistItemCount(persistedItemCount);
  }
  emit();
}

function emptySnapshot(): CartSnapshot {
  return {
    id: 'local-cart',
    currency: 'USD',
    itemCount: 0,
    subtotal: 0,
    checkoutUrl: '',
    lines: [],
    promotions: [],
    updatedAt: new Date().toISOString(),
  };
}

function currentCart(): CartSnapshot {
  return state.cart ?? emptySnapshot();
}

function withLines(cart: CartSnapshot, lines: CartLine[]): CartSnapshot {
  const active = lines.filter((line) => line.quantity > 0);
  return {
    ...cart,
    lines: active,
    itemCount: active.reduce((total, line) => total + line.quantity, 0),
    subtotal: active.reduce((total, line) => total + line.quantity * line.unitPrice, 0),
    updatedAt: new Date().toISOString(),
  };
}

/** For adapters without `getPromotions`, promotions ride on write responses. */
function mergeServerPromotions(serverCart: CartSnapshot) {
  if (adapter.getPromotions) return;
  if (!('promotions' in serverCart)) return;
  setState({ cart: { ...currentCart(), promotions: serverCart.promotions ?? [] } });
}

function isOutboxIdle() {
  return pendingQuantity.size === 0 && drainingLines.size === 0 && drainTimers.size === 0;
}

/** The displayed cart's contents changed: any quote so far is out of date. */
function bumpCartGeneration() {
  cartGeneration += 1;
}

function setPromotions(promotions: CartPromotionView[]) {
  if (!state.cart) return;
  setState({ cart: { ...state.cart, promotions } });
}

/** Imperative shell around decidePromotionQuote: gathers the facts, then
 * quotes, clears, or does nothing. Safe to call after any state change. */
function syncPromotions() {
  if (!state.isConfigured) return;
  const decision = decidePromotionQuote({
    canQuote: typeof adapter.getPromotions === 'function',
    isSidebarOpen: state.isSidebarOpen,
    lineCount: state.cart?.lines.length ?? 0,
    hasPromotions: (state.cart?.promotions?.length ?? 0) > 0,
    outboxIdle: isOutboxIdle(),
    hasFailedWrites: failedLineErrors.size > 0,
    cartGeneration,
    quotedGeneration,
    inFlightGeneration: inFlightQuoteGeneration,
  });
  if (decision === 'clear') setPromotions([]);
  if (decision === 'quote') void quotePromotions();
}

async function quotePromotions() {
  const getPromotions = adapter.getPromotions;
  if (!getPromotions) return;
  const version = adapterVersion;
  const generation = cartGeneration;
  inFlightQuoteGeneration = generation;

  let promotions: CartPromotionView[] | null;
  try {
    promotions = await getPromotions.call(adapter);
  } catch (error) {
    console.error('[storefront] cart promotion quote failed', error);
    promotions = null;
  }

  // configure() with a new adapter resets the quote bookkeeping itself.
  if (version !== adapterVersion) return;
  inFlightQuoteGeneration = null;
  if (generation !== cartGeneration) {
    // The cart changed while this was in flight: drop the result and quote
    // the newer cart if it is still visible.
    syncPromotions();
    return;
  }
  if (promotions === null) {
    // Promotions are an optional nudge, not cart state: show none, and leave
    // this generation unquoted so the next sheet open or edit retries. No
    // immediate re-sync, which would retry a failing quote in a loop.
    setPromotions([]);
    return;
  }
  quotedGeneration = generation;
  setPromotions(promotions);
}

function restoreRemovedLine(lineId: string) {
  const removedLine = removedLineSnapshots.get(lineId);
  if (!removedLine) return;

  const cart = currentCart();
  if (cart.lines.some((line) => line.id === lineId)) return;
  setState({ cart: withLines(cart, [...cart.lines, removedLine]) });
}

function beginCheckout() {
  checkoutWrites += 1;
  setState({ error: null, isMutating: true });
}

function endCheckout() {
  checkoutWrites = Math.max(0, checkoutWrites - 1);
  setState({ isMutating: checkoutWrites > 0 });
}

function markLineFailed(lineId: string, error: unknown) {
  const payload = toCartErrorPayload(error);
  failedLineErrors.set(lineId, payload);
  setState({ error: payload });
}

function clearLineState(lineId: string) {
  failedLineErrors.delete(lineId);
  setState({});
}

/** The server id to address for a displayed line, or null when the line was
 * added optimistically and the server has not acknowledged it yet (its write
 * waits for the add to resolve and supply the real id). */
function serverIdFor(localId: string): string | null {
  const mapped = serverLineIds.get(localId);
  if (mapped) return mapped;
  return isOptimisticLineId(localId) ? null : localId;
}

/** Learn the real server id for a just-added line from the add response, so
 * later edits (and checkout) target the right line. Displayed state is untouched. */
function adoptServerLineId(input: AddToCartInput, serverCart: CartSnapshot) {
  const optId = optimisticLineId(input);
  const serverLine = serverCart.lines.find((line) => sameCartLine(line, input));
  if (!serverLine) return false;
  serverLineIds.set(optId, serverLine.id);
  optimisticInputs.delete(optId);
  // Flush edits that were queued against the not-yet-acknowledged line.
  if (pendingQuantity.has(optId)) void drainLine(optId);
  return true;
}

function missingServerLineError() {
  return new CartRequestError({
    code: 'cart_request_failed',
    message: 'Cart line was saved, but the server response could not be matched.',
  });
}

function blockedCheckoutError() {
  return new CartRequestError({
    code: 'cart_request_failed',
    message: 'Some cart changes could not be saved. Adjust the highlighted items and try again.',
  });
}

function cartNotReadyError() {
  return new CartRequestError({
    code: 'cart_unavailable',
    message: 'Cart is not ready yet.',
  });
}

function drainLine(localId: string) {
  const existing = drainingLines.get(localId);
  if (existing) return existing;

  const promise = drainLineQueue(localId).finally(() => {
    drainingLines.delete(localId);
    if (!pendingQuantity.has(localId) && !failedLineErrors.has(localId)) {
      clearLineState(localId);
    }
    // The last write settling is when a quote can match the displayed cart.
    syncPromotions();
  });
  drainingLines.set(localId, promise);
  return promise;
}

function scheduleDrainLine(localId: string) {
  const existing = drainTimers.get(localId);
  if (existing) globalThis.clearTimeout(existing);

  const timeout = globalThis.setTimeout(() => {
    drainTimers.delete(localId);
    void drainLine(localId);
  }, QUANTITY_WRITE_DEBOUNCE_MS);
  drainTimers.set(localId, timeout);
}

function flushScheduledDrains() {
  for (const [lineId, timeout] of drainTimers) {
    globalThis.clearTimeout(timeout);
    drainTimers.delete(lineId);
    void drainLine(lineId);
  }
}

async function drainLineQueue(localId: string) {
  try {
    while (pendingQuantity.has(localId)) {
      const target = pendingQuantity.get(localId) as number;
      pendingQuantity.delete(localId);

      const serverId = serverIdFor(localId);
      if (serverId === null) {
        if (target <= 0) {
          clearLineState(localId);
          optimisticInputs.delete(localId);
          removedLineSnapshots.delete(localId);
          continue;
        }

        const input = optimisticInputs.get(localId);
        if (!input) {
          markLineFailed(localId, missingServerLineError());
          break;
        }

        try {
          const serverCart = await adapter.addItem({ ...input, quantity: target });
          mergeServerPromotions(serverCart);
          if (!adoptServerLineId(input, serverCart)) throw missingServerLineError();
        } catch (error) {
          if (pendingQuantity.has(localId)) continue;
          markLineFailed(localId, error);
          break;
        }

        continue;
      }

      try {
        if (target <= 0) {
          const serverCart = await adapter.removeItem(serverId);
          mergeServerPromotions(serverCart);
          clearLineState(localId);
          serverLineIds.delete(localId);
          optimisticInputs.delete(localId);
          removedLineSnapshots.delete(localId);
        } else {
          const serverCart = await adapter.updateItem(serverId, target);
          mergeServerPromotions(serverCart);
          clearLineState(localId);
        }
      } catch (error) {
        if (pendingQuantity.has(localId)) continue;
        if (target <= 0) restoreRemovedLine(localId);
        markLineFailed(localId, error);
        break;
      }
    }
  } catch (error) {
    markLineFailed(localId, error);
  }
}

async function waitForWritableCart() {
  flushScheduledDrains();

  while (drainingLines.size > 0 || drainTimers.size > 0) {
    flushScheduledDrains();
    await Promise.allSettled([...drainingLines.values()]);
  }

  if (failedLineErrors.size > 0) {
    throw blockedCheckoutError();
  }
}

export const cartStore = {
  configure(options: ConfigureCartStoreOptions) {
    if (options.adapter) {
      adapter = options.adapter;
      adapterVersion += 1;
      refreshPromise = null;
      seeded = false;
      checkoutWrites = 0;
      serverLineIds.clear();
      optimisticInputs.clear();
      pendingQuantity.clear();
      for (const timeout of drainTimers.values()) globalThis.clearTimeout(timeout);
      drainTimers.clear();
      drainingLines.clear();
      failedLineErrors.clear();
      removedLineSnapshots.clear();
      quotedGeneration = null;
      inFlightQuoteGeneration = null;
      bumpCartGeneration();
      setState({
        // Promotions belong to the previous adapter's server cart.
        cart: state.cart ? { ...state.cart, promotions: [] } : null,
        error: null,
        isConfigured: true,
        isLoading: false,
        isMutating: false,
      });
    }
    if ('initialCart' in options) {
      const cart = options.initialCart ?? null;
      if (cart) seeded = true;
      bumpCartGeneration();
      setState({ cart });
    }
    syncPromotions();
  },

  getSnapshot() {
    return state;
  },

  /** Stable, pristine snapshot for SSR and the hydration render. It never carries
   * the localStorage-seeded `persistedItemCount`, so the server-rendered markup
   * matches the first client render; useSyncExternalStore then swaps to the live
   * getSnapshot (which has the seeded count) right after hydration. */
  getServerSnapshot() {
    return initialState;
  },

  subscribe(listener: CartStoreListener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** Reads the cart from the server. Only the initial read seeds the displayed
   * cart; once seeded (by a load or any mutation) the local cart is authoritative
   * and a server read never overrides it. */
  async refresh() {
    if (!state.isConfigured) return currentCart();
    if (seeded) return currentCart();
    if (refreshPromise) return refreshPromise;

    const version = adapterVersion;
    setState({ error: null, isLoading: true });
    refreshPromise = adapter
      .getCart()
      .then((cart) => {
        if (version !== adapterVersion) return cart;
        if (!seeded) {
          seeded = true;
          bumpCartGeneration();
          setState({ cart, isLoading: false });
          // Quotes only if the sheet was opened while the cart was loading.
          syncPromotions();
        } else {
          setState({ isLoading: false });
        }
        return cart;
      })
      .catch((error) => {
        if (version !== adapterVersion) throw error;
        setState({ error: toCartErrorPayload(error), isLoading: false });
        throw error;
      })
      .finally(() => {
        if (version === adapterVersion) refreshPromise = null;
      });

    return refreshPromise;
  },

  addItem(input: AddToCartInput) {
    if (!state.isConfigured) return Promise.reject(cartNotReadyError());
    seeded = true;
    bumpCartGeneration();
    setState({ cart: applyAddItem(currentCart(), input), error: null, isSidebarOpen: true });

    const line = currentCart().lines.find((cartLine) => sameCartLine(cartLine, input));
    const localId = line?.id ?? optimisticLineId(input);
    if (isOptimisticLineId(localId)) {
      optimisticInputs.set(localId, {
        ...input,
        quantity: input.quantity ?? 1,
      });
    }
    pendingQuantity.set(localId, line?.quantity ?? input.quantity ?? 1);
    scheduleDrainLine(localId);
    return Promise.resolve(state.cart as CartSnapshot);
  },

  updateItem(lineId: string, quantity: number) {
    if (!state.isConfigured) return Promise.reject(cartNotReadyError());
    seeded = true;
    failedLineErrors.delete(lineId);
    bumpCartGeneration();
    setState({ cart: applyUpdateItem(currentCart(), lineId, quantity), error: null });
    pendingQuantity.set(lineId, quantity);
    scheduleDrainLine(lineId);
    syncPromotions();
    return Promise.resolve(state.cart as CartSnapshot);
  },

  removeItem(lineId: string) {
    if (!state.isConfigured) return Promise.reject(cartNotReadyError());
    seeded = true;
    const line = currentCart().lines.find((cartLine) => cartLine.id === lineId);
    if (line) removedLineSnapshots.set(lineId, line);
    failedLineErrors.delete(lineId);
    bumpCartGeneration();
    setState({ cart: applyRemoveItem(currentCart(), lineId), error: null });
    // Queue a server delete; for a not-yet-acknowledged line it fires once the
    // add resolves and supplies the real id.
    pendingQuantity.set(lineId, 0);
    scheduleDrainLine(lineId);
    // An emptied cart drops its promotions now rather than after the write.
    syncPromotions();
    return Promise.resolve(state.cart as CartSnapshot);
  },

  async checkout() {
    if (!state.isConfigured) throw cartNotReadyError();
    beginCheckout();
    try {
      await waitForWritableCart();
      const utm = readStoredUtm();
      const { url } = await adapter.createCheckout(utm ? { utm } : undefined);
      window.location.href = appendUtmToUrl(url, utm);
    } catch (error) {
      setState({ error: toCartErrorPayload(error) });
      endCheckout();
      throw error;
    }
  },

  /** Opening the sheet is what makes promotions visible, so it is the one
   * place (besides writes made while it is open) that quotes them. */
  openSidebar() {
    setState({ isSidebarOpen: true });
    syncPromotions();
    void cartStore.refresh();
  },

  closeSidebar() {
    setState({ isSidebarOpen: false });
  },
};

// Standard cross-site event names (all kit-based sites share them); inline
// scripts and Astro components can poke the store without importing it.
if (typeof window !== 'undefined') {
  window.addEventListener('pg:cart-refresh', () => {
    void cartStore.refresh();
  });

  window.addEventListener('pg:cart-open', () => {
    cartStore.openSidebar();
  });
}
