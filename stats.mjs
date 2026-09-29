// Statistics from a list of plays, one per puzzle started:
// { day, category, done, onTime, gaveUp, ms, hints, reveals, found, total }. Pure, so it can be tested.
import { addDays, daysBetween } from './schedule.mjs';

export const TIME_BINS = [['Under 1 min', 60e3], ['1–2 min', 120e3], ['2–3 min', 180e3], ['3–5 min', 300e3], ['5–10 min', 600e3], ['10 min +', Infinity]];
export const HELP_BINS = ['0', '1', '2', '3', '4+'];

const solvedPlay = p => p.done && !p.gaveUp;
const median = xs => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// A day counts toward a streak when its puzzle was solved without giving up.
export function streaks(days, today) {
  const solved = new Set(days);
  let current = 0, day = solved.has(today) ? today : addDays(today, -1);
  while (solved.has(day)) { current++; day = addDays(day, -1); }
  let best = 0, run = 0, prev = null;
  for (const d of [...solved].sort()) { run = prev && daysBetween(prev, d) === 1 ? run + 1 : 1; best = Math.max(best, run); prev = d; }
  return { current, best };
}

export function summarize(plays, today) {
  const solved = plays.filter(solvedPlay), times = solved.map(p => p.ms);
  // A streak day is a puzzle solved on its own day; catching up in the archive doesn't fill the gaps.
  const { current, best } = streaks(solved.filter(p => p.onTime !== false).map(p => p.day), today);
  const timeBins = TIME_BINS.map(([label]) => ({ label, count: 0 }));
  for (const t of times) timeBins[TIME_BINS.findIndex(([, max]) => t < max)].count++;
  const helpBins = HELP_BINS.map(label => ({ label, count: 0 }));
  for (const p of solved) helpBins[Math.min(4, p.hints + p.reveals)].count++;
  const categories = [...new Set(plays.map(p => p.category))].map(name => {
    const mine = plays.filter(p => p.category === name && (p.done)), won = mine.filter(solvedPlay);
    return { name, played: mine.length, solved: won.length, typical: median(won.map(p => p.ms)) };
  });
  const byDay = new Map(plays.map(p => [p.day, !p.done ? 'started' : p.gaveUp ? 'gaveup' : p.hints + p.reveals ? 'helped' : 'clean']));
  const latest = solved.filter(p => p.day <= today).sort((a, b) => a.day < b.day ? -1 : 1).slice(-20);
  return {
    played: plays.length,
    finished: plays.filter(p => p.done).length,
    solved: solved.length,
    winRate: plays.filter(p => p.done).length ? Math.round(100 * solved.length / plays.filter(p => p.done).length) : 0,
    streak: current, bestStreak: best,
    bestTime: times.length ? Math.min(...times) : null,
    typicalTime: median(times),
    todayTime: solved.find(p => p.day === today)?.ms ?? null,
    clean: solved.filter(p => p.hints + p.reveals === 0).length,
    timeBins, helpBins, categories, byDay,
    trend: latest.map(p => ({ day: p.day, ms: p.ms })),
  };
}

