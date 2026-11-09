import { beforeEach, describe, expect, it, vi } from 'vitest';
import { trackStoreLinkClicks } from './store-link-clicks.js';

const mocks = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock('./tracker.js', () => ({ track: mocks.track }));

const STORE = 'https://store.example.com';

// Each test gets its own document, so listeners never leak between tests.
function createDoc(html: string): Document {
  const doc = document.implementation.createHTMLDocument('test');
  doc.body.innerHTML = html;
  // Keep the test page from navigating; a site handler cancelling the
  // navigation doesn't hide the click either.
  doc.addEventListener('click', (event) => event.preventDefault(), { capture: true });
  return doc;
}

function click(target: Element, init: MouseEventInit & { type?: 'click' | 'auxclick' } = {}) {
  const { type = 'click', ...rest } = init;
  target.dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, button: 0, ...rest }),
  );
}

function get(doc: Document, selector: string): Element {
  const element = doc.querySelector(selector);
  if (!element) throw new Error(`no ${selector}`);
  return element;
}

beforeEach(() => {
  mocks.track.mockReset();
  window.history.replaceState(null, '', '/club');
  if (window.location.origin === STORE) throw new Error('a test navigated to the store');
});

describe('trackStoreLinkClicks', () => {
  it('tracks a click on a store link with its destination, store path and page path', () => {
    const doc = createDoc(
      `<a id="join" href="${STORE}/clubs/reserve/join?utm_source=ig" data-store-destination="club_join"><span id="label">Join</span></a>`,
    );
    trackStoreLinkClicks({ origins: STORE, doc });

    click(get(doc, '#label'));

    expect(mocks.track).toHaveBeenCalledTimes(1);
    expect(mocks.track).toHaveBeenCalledWith({
      type: 'store_link_clicked',
      destination: 'club_join',
      linkPath: '/clubs/reserve/join',
      path: '/club',
    });
  });

  it('reports other for a missing or unknown destination', () => {
    const doc = createDoc(
      `<a id="a" href="${STORE}/gift-cards"></a><a id="b" href="${STORE}/x" data-store-destination="nope"></a>`,
    );
    trackStoreLinkClicks({ origins: [STORE], doc });

    click(get(doc, '#a'));
    click(get(doc, '#b'));

    expect(mocks.track.mock.calls.map(([input]) => input.destination)).toEqual(['other', 'other']);
  });

  it('ignores links to the site itself or other sites', () => {
    const doc = createDoc(
      `<a id="site" href="/wines"></a><a id="ext" href="https://www.instagram.com/paco"></a><button id="btn">x</button>`,
    );
    trackStoreLinkClicks({ origins: STORE, doc });

    click(get(doc, '#site'));
    click(get(doc, '#ext'));
    click(get(doc, '#btn'));

    expect(mocks.track).not.toHaveBeenCalled();
  });

  it('counts modified primary clicks and middle clicks, not right or Alt clicks', () => {
    const doc = createDoc(`<a id="shop" href="${STORE}/" data-store-destination="shop"></a>`);
    trackStoreLinkClicks({ origins: STORE, doc });
    const link = get(doc, '#shop');

    click(link, { metaKey: true });
    click(link, { ctrlKey: true });
    click(link, { shiftKey: true });
    click(link, { type: 'auxclick', button: 1 });
    expect(mocks.track).toHaveBeenCalledTimes(4);

    click(link, { type: 'auxclick', button: 2 });
    click(link, { altKey: true });
    click(link, { button: 1 }); // a middle click some browsers also report as click
    expect(mocks.track).toHaveBeenCalledTimes(4);
  });

  it('counts a click even when a site handler stops its propagation', () => {
    const doc = createDoc(`<a id="shop" href="${STORE}/"></a>`);
    get(doc, '#shop').addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    trackStoreLinkClicks({ origins: STORE, doc });

    click(get(doc, '#shop'));

    expect(mocks.track).toHaveBeenCalledTimes(1);
  });

  it('counts links added after it was installed (delegated)', () => {
    const doc = createDoc('');
    trackStoreLinkClicks({ origins: STORE, doc });
    doc.body.innerHTML = `<a id="late" href="${STORE}/account" data-store-destination="account"></a>`;

    click(get(doc, '#late'));

    expect(mocks.track).toHaveBeenCalledWith(expect.objectContaining({ destination: 'account' }));
  });

  it('installs one listener per document; a later call only replaces the origins', () => {
    const doc = createDoc(
      `<a id="old" href="${STORE}/"></a><a id="new" href="https://paco-v2.prettygood.live/"></a>`,
    );
    trackStoreLinkClicks({ origins: STORE, doc });
    trackStoreLinkClicks({ origins: STORE, doc });
    click(get(doc, '#old'));
    expect(mocks.track).toHaveBeenCalledTimes(1);

    trackStoreLinkClicks({ origins: 'https://paco-v2.prettygood.live', doc });
    click(get(doc, '#old'));
    click(get(doc, '#new'));
    expect(mocks.track).toHaveBeenCalledTimes(2);
    expect(mocks.track).toHaveBeenLastCalledWith(expect.objectContaining({ linkPath: '/' }));
  });

  it('throws on invalid origins before installing anything', () => {
    const doc = createDoc(`<a id="shop" href="${STORE}/"></a>`);
    expect(() => trackStoreLinkClicks({ origins: 'store.example.com', doc })).toThrow(/origins/);

    click(get(doc, '#shop'));
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it('never lets a tracking failure break the click', () => {
    mocks.track.mockImplementation(() => {
      throw new Error('boom');
    });
    const doc = createDoc(`<a id="shop" href="${STORE}/"></a>`);
    trackStoreLinkClicks({ origins: STORE, doc });

    expect(() => click(get(doc, '#shop'))).not.toThrow();
  });

  it('installs on the global document by default', () => {
    trackStoreLinkClicks({ origins: STORE });
    document.body.innerHTML = `<a id="global" href="${STORE}/"></a>`;
    document.addEventListener('click', (event) => event.preventDefault(), {
      capture: true,
      once: true,
    });

    click(get(document, '#global'));

    expect(mocks.track).toHaveBeenCalledTimes(1);
    document.body.innerHTML = '';
  });
});
