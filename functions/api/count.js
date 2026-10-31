// Copyright (c) 2026 Zack Abrams. All rights reserved. Not licensed for reuse; see LICENSE.
// Cloudflare Pages Function: POST /api/count adds one to a puzzle's running total of people who solved it on its own day, and
// answers with the new total ({"n": 37}) for the "you're the 37th person" note. The total lives in the D1 database bound as DB,
// in a table that makes itself the first time (setup and queries: analytics/README.md). One number per puzzle, nothing about
// the person: no id, no IP address, no country. Like the play analytics, it counts browsers set to Do Not Track too (Zack's
// call, 2026-10-31). A puzzle's total starts from the solves the play analytics already logged for it, so switching the counter
// on partway through a day (as on Oct 31, for #42) doesn't start the day over at 1. Anything it doesn't accept is answered with
// {"n": null}, and the note then goes without a number.

export const LAUNCH = '2026-09-20';   // Spoondle #1's day, as in dist/schedule.mjs (a test keeps the two the same)
const DAY_MS = 86400000;

// The puzzles that are today's somewhere on Earth right now: the UTC day's, the day before (far west), and the day after (far east).
export function todaysPuzzles(now = Date.now()) {
  const n = Math.floor((now - Date.parse(`${LAUNCH}T00:00:00Z`)) / DAY_MS) + 1;
  return [n - 1, n, n + 1];
}

// The puzzle number to count, or null unless it's one of today's.
export function parseCount(body, now = Date.now()) {
  let d; try { d = JSON.parse(body); } catch { return null; }
  const p = d?.p;
  return Number.isInteger(p) && todaysPuzzles(now).includes(p) ? p : null;
}

export const TABLE = 'CREATE TABLE IF NOT EXISTS solve_counts (puzzle INTEGER PRIMARY KEY, solves INTEGER NOT NULL)';
// Each is one statement, so two people finishing at the same moment can't be given the same number.
export const ADD = 'UPDATE solve_counts SET solves = solves + 1 WHERE puzzle = ? RETURNING solves';
// A puzzle's first count: 1 plus the solves of it the play analytics logged in the last three days, leaving out the last few
// seconds (this solver's own solve event arrives alongside this request). If two first counts race, the second one adds one.
export const START = "INSERT INTO solve_counts (puzzle, solves) SELECT ?, 1 + COUNT(*) FROM events WHERE event = 'solve' AND puzzle = ? AND ts BETWEEN ? AND ? ON CONFLICT (puzzle) DO UPDATE SET solves = solves + 1 RETURNING solves";
// Without the play analytics table, a puzzle simply starts at 1.
export const BUMP = 'INSERT INTO solve_counts (puzzle, solves) VALUES (?, 1) ON CONFLICT (puzzle) DO UPDATE SET solves = solves + 1 RETURNING solves';

// Adds one to the puzzle's total and returns the row ({ solves }), making the table first if it isn't there yet.
export async function countSolve(DB, puzzle, now = Date.now()) {
  const missing = (e, table) => new RegExp(`no such table: ${table}`, 'i').test(String(e?.message));
  const add = async () => {
    const row = await DB.prepare(ADD).bind(puzzle).first();
    if (row) return row;
    try { return await DB.prepare(START).bind(puzzle, puzzle, now - 3 * DAY_MS, now - 5000).first(); }
    catch (e) { if (!missing(e, 'events')) throw e; return DB.prepare(BUMP).bind(puzzle).first(); }
  };
  try { return await add(); }
  catch (e) { if (!missing(e, 'solve_counts')) throw e; await DB.prepare(TABLE).run(); return add(); }
}

export async function onRequestPost({ request, env }) {
  const answer = n => new Response(JSON.stringify({ n }), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  try {
    const origin = request.headers.get('origin');
    if (!env.DB || (origin && origin !== 'https://spoondle.app')) return answer(null);
    if (/bot|crawl|spider|headless|preview/i.test(request.headers.get('user-agent') ?? '')) return answer(null);
    const body = await request.text();
    if (body.length > 100) return answer(null);
    const puzzle = parseCount(body);
    if (puzzle === null) return answer(null);
    const row = await countSolve(env.DB, puzzle);
    return answer(Number.isInteger(row?.solves) && row.solves > 0 ? row.solves : null);
  } catch { return answer(null); }
}
