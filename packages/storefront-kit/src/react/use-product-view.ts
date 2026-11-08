// Shell for product_viewed, shared by the PDP panel and product cards. A view
// means the visitor saw the wine, not that its island mounted: a one-page site
// mounts every wine's panel on load, and a shop page mounts every card. The
// caller attaches the returned ref to the element that shows the wine; once
// half of it has been on screen and `view` has resolved, one event is tracked.
import { useEffect, useRef, useState } from 'react';
import type { ProductViewedInput } from '../analytics/core.js';
import { track } from '../analytics/tracker.js';
import { productViewToEmit } from './product-view.js';

/** Share of the element that must be on screen to count as a view. */
const PRODUCT_VIEW_THRESHOLD = 0.5;

/** Returns the ref to attach. Nothing attached, nothing reported. */
export function useProductView(view: ProductViewedInput | null): (node: Element | null) => void {
  const [node, setNode] = useState<Element | null>(null);
  const [seen, setSeen] = useState(false);
  const emitted = useRef(false);

  useEffect(() => {
    if (!node || seen) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { threshold: PRODUCT_VIEW_THRESHOLD },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, seen]);

  useEffect(() => {
    const event = productViewToEmit({ view, seen, emitted: emitted.current });
    if (!event) return;
    emitted.current = true;
    track(event);
  }, [view, seen]);

  return setNode;
}
