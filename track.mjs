// Copyright (c) 2026 Zack Abrams. All rights reserved. Not licensed for reuse; see LICENSE.
// Anonymous play counts for spoondle.app, sent to /api/e (see analytics/README.md).
// Nothing is saved on the device: a visit gets a random id that lives only in this page's memory, so one visit's events
// can be lined up, but a player who comes back cannot be followed. Nothing is sent when the browser asks not to be
// tracked, or from anywhere but spoondle.app.

const randomId = (bytes = 6) => {
  const b = new Uint8Array(bytes);
  (globalThis.crypto ?? { getRandomValues: a => a.map(() => Math.floor(Math.random() * 256)) }).getRandomValues(b);
  return [...b].map(x => x.toString(36).padStart(2, '0')).join('');
};

// A tracker with everything it touches passed in, so it can be tested without a browser.
//   enabled: whether to send at all   send(json): delivers one event   now(): milliseconds   context: extra fields for the visit event
export function createTracker({ enabled, send, now = () => Date.now(), context = {} }) {
  const visit = randomId();
  let started = false, solved = false, seen = 0, shownAt = now(), showing = true;
  const post = (e, data = {}) => { if (enabled) { try { send(JSON.stringify({ v: visit, e, ...data })); } catch {} } };
  return {
    visit,
    track(e, data = {}) {
      if (e === 'start') started = true;
      if (e === 'solve') solved = true;
      post(e, e === 'visit' ? { ...context, ...data } : data);
    },
    // The visit's visible time, so a bounce (gone in seconds, never started) shows up. Sent each time the page is hidden.
    shown() { if (!showing) { showing = true; shownAt = now(); } },
    hidden() {
      if (showing) { showing = false; seen += now() - shownAt; }
      post('leave', { s: Math.round(seen / 1000), a: started ? 1 : 0, o: solved ? 1 : 0 });
    },
  };
}

export function browserTracker() {
  const host = location.hostname;
  const enabled = host === 'spoondle.app' && navigator.doNotTrack !== '1' && navigator.globalPrivacyControl !== true;
  const send = json => {
    if (navigator.sendBeacon?.('/api/e', new Blob([json], { type: 'text/plain' }))) return;
    fetch('/api/e', { method: 'POST', body: json, keepalive: true }).catch(() => {});
  };
  let ref = '';
  try { const r = new URL(document.referrer); if (r.hostname && r.hostname !== host) ref = r.hostname.replace(/^www\./, '').slice(0, 60); } catch {}
  const device = innerWidth < 600 ? 'phone' : innerWidth < 1000 ? 'tablet' : 'desktop';
  const tracker = createTracker({ enabled, send, now: () => performance.now(), context: { f: ref, d: device } });
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' ? tracker.hidden() : tracker.shown());
  return tracker;
}
