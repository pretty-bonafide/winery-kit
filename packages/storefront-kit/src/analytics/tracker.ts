// SDK-agnostic imperative shell: holds the tracker state, reads the stored
// acquisition, queues events until the sink loads, and delivers them. The kit's
// hooks import THIS module (never client.ts), so a site that doesn't install
// the optional Amplitude peer never has its bundler resolve the SDK import.
//
// Analytics must never break commerce: `track` never throws, a failed sink
// load or send warns once, and the events are dropped.
import { readStoredAcquisition } from '../utm/storage.js';
import { type AnalyticsEvent, type AnalyticsEventInput, buildAnalyticsEvent } from './core.js';

export interface AnalyticsSink {
  send(event: AnalyticsEvent): void;
}

type TrackerState =
  | { status: 'off' }
  | { status: 'loading'; site: string; queue: AnalyticsEvent[] }
  | { status: 'ready'; site: string; sink: AnalyticsSink }
  | { status: 'failed' };

let state: TrackerState = { status: 'off' };
let started: Promise<void> | null = null;
let hasWarned = false;

function warnOnce(message: string, detail?: unknown) {
  if (hasWarned) return;
  hasWarned = true;
  console.warn(`analytics: ${message}`, detail);
}

function deliver(sink: AnalyticsSink, event: AnalyticsEvent) {
  try {
    sink.send(event);
  } catch (error) {
    warnOnce('sending an event failed — dropping it.', error);
  }
}

/**
 * Starts the tracker once per page; later calls return the first start's
 * promise. Events tracked while the sink loads are queued and flushed in order.
 * The promise never rejects: a failed load warns once and drops every event.
 */
export function startTracker(site: string, loadSink: () => Promise<AnalyticsSink>): Promise<void> {
  if (started) return started;

  const queue: AnalyticsEvent[] = [];
  state = { status: 'loading', site, queue };
  started = Promise.resolve()
    .then(loadSink)
    .then(
      (sink) => {
        state = { status: 'ready', site, sink };
        for (const event of queue) deliver(sink, event);
      },
      (error) => {
        state = { status: 'failed' };
        warnOnce('the analytics SDK failed to load — events are dropped.', error);
      },
    );
  return started;
}

/** Records one funnel event. A no-op until `initAnalytics` has been called with
 * a key (and after a failed SDK load). Never throws. */
export function track(input: AnalyticsEventInput): void {
  try {
    if (state.status === 'off' || state.status === 'failed') return;

    const event = buildAnalyticsEvent(input, {
      site: state.site,
      acquisition: readStoredAcquisition(),
    });
    if (!event) {
      console.warn(`analytics: dropped an invalid ${input.type} event.`, input);
      return;
    }

    if (state.status === 'loading') state.queue.push(event);
    else deliver(state.sink, event);
  } catch (error) {
    warnOnce('tracking an event failed — dropping it.', error);
  }
}

/** Records a `page_viewed` for the current location. Call it on load (and on
 * `astro:page-load` for Client Router sites). */
export function trackPageView(): void {
  if (typeof window === 'undefined') return;
  track({ type: 'page_viewed', path: window.location.pathname });
}
