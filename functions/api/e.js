// Copyright (c) 2026 Zack Abrams. All rights reserved. Not licensed for reuse; see LICENSE.
// Cloudflare Pages Function: POST /api/e records one anonymous play event in the D1 database bound as DB
// (setup and queries: analytics/README.md). It stores no IP address, no cookie, and no user agent; the only thing about
// where someone is from is a country code, which Cloudflare supplies. Anything it doesn't recognize is dropped without an error.

const EVENTS = new Set(['visit', 'start', 'solve', 'giveup', 'share', 'open', 'tutorial_start', 'tutorial_solved', 'tutorial_done', 'tutorial_skip', 'leave']);
const DEVICES = new Set(['phone', 'tablet', 'desktop']);
const int = (x, max) => Number.isFinite(x) ? Math.max(0, Math.min(max, Math.round(x))) : null;
const text = (x, pattern, max) => typeof x === 'string' && x.length <= max && pattern.test(x) ? x : null;

// Returns the row to store, or null when the body isn't a valid event.
export function parseEvent(body, now = Date.now()) {
  let d; try { d = JSON.parse(body); } catch { return null; }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  const visit = text(d.v, /^[0-9a-z]{8,24}$/, 24), event = typeof d.e === 'string' && EVENTS.has(d.e) ? d.e : null;
  if (!visit || !event) return null;
  return {
    ts: now, visit, event,
    puzzle: int(d.p, 100000), ms: int(d.ms, 86400000), hints: int(d.h, 1000), peeks: int(d.k, 1000), secs: int(d.s, 86400),
    started: d.a === 1 ? 1 : d.a === 0 ? 0 : null, solved: d.o === 1 ? 1 : d.o === 0 ? 0 : null, repeat_visit: d.r === 1 ? 1 : d.r === 0 ? 0 : null,
    ref: text(d.f, /^[0-9a-z.-]*$/i, 60) || null, device: DEVICES.has(d.d) ? d.d : null, note: text(d.n, /^[A-Za-z_]{1,24}$/, 24),
  };
}

export const INSERT = 'INSERT INTO events (ts, visit, event, puzzle, ms, hints, peeks, secs, started, solved, repeat_visit, ref, device, note, country) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';

export async function onRequestPost({ request, env }) {
  const done = new Response(null, { status: 204 });
  try {
    const origin = request.headers.get('origin');
    if (!env.DB || (origin && origin !== 'https://spoondle.app')) return done;
    if (/bot|crawl|spider|headless|preview/i.test(request.headers.get('user-agent') ?? '')) return done;
    const body = await request.text();
    if (body.length > 600) return done;
    const row = parseEvent(body);
    if (!row) return done;
    const country = /^[A-Z]{2}$/.test(request.cf?.country ?? '') ? request.cf.country : null;
    await env.DB.prepare(INSERT).bind(row.ts, row.visit, row.event, row.puzzle, row.ms, row.hints, row.peeks, row.secs, row.started, row.solved, row.repeat_visit, row.ref, row.device, row.note, country).run();
  } catch {}
  return done;
}
