import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CartLineView } from '../cart/cart-types.js';
import { CartSidebarView } from './CartSidebar.js';
import { exampleCartSidebarThemes } from './cart-sidebar-example-themes.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BUNDLE: CartLineView = {
  id: 'box',
  productId: 'estate-six',
  title: 'Estate Six',
  unitPrice: 24000,
  purchaseQty: 2,
  mode: 'purchase',
  components: [
    { title: '2024 Roussanne', quantity: 3 },
    { title: '2024 Garnacha', quantity: 3 },
  ],
};

const WINE: CartLineView = {
  id: 'cab',
  productId: 'cab',
  title: '2022 Cabernet',
  unitPrice: 4500,
  purchaseQty: 1,
  mode: 'purchase',
};

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = '';
});

function render(
  lines: CartLineView[],
  props: Partial<Parameters<typeof CartSidebarView>[0]> = {},
  handlers = { onRemove: vi.fn(), onUpdateQuantity: vi.fn() },
) {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      createElement(CartSidebarView, {
        theme: exampleCartSidebarThemes.noir,
        lines,
        onClose: vi.fn(),
        onCheckout: vi.fn(),
        ...handlers,
        ...props,
      }),
    ),
  );
  return { container, ...handlers };
}

describe('CartSidebarView bundle lines', () => {
  it('captions a bundle line with what one bundle holds and no other line', () => {
    const { container } = render([BUNDLE, WINE]);

    const captions = [...container.querySelectorAll('.pgc-includes')];
    expect(captions.map((caption) => caption.textContent)).toEqual([
      'Includes: 2024 Roussanne × 3 · 2024 Garnacha × 3',
    ]);
    expect(captions[0]?.closest('.pgc-item')?.textContent).toContain('Estate Six');
  });

  it('lets the site reword the caption', () => {
    const { container } = render([BUNDLE], {
      includesCaption: (components) => `Contains ${components.length} wines`,
    });

    expect(container.querySelector('.pgc-includes')?.textContent).toBe('Contains 2 wines');
  });

  it('keeps the stepper and Remove working on the bundle line', () => {
    const { container, onRemove, onUpdateQuantity } = render([BUNDLE]);

    act(() =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Increase Estate Six quantity"]')
        ?.click(),
    );
    act(() => container.querySelector<HTMLButtonElement>('.pgc-remove')?.click());

    expect(onUpdateQuantity).toHaveBeenCalledWith('box', 3);
    expect(onRemove).toHaveBeenCalledWith('box');
  });
});
