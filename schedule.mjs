// Which day each puzzle belongs to. The boards run one a day from LAUNCH, in order; a daily game adds a board a day.
export const LAUNCH = '2026-09-20';
const DAY_MS = 864e5;
const pad = n => String(n).padStart(2, '0');
// Noon, so a daylight-saving change never tips a date into the day before or after.
const noon = day => new Date(`${day}T12:00:00`);
export const iso = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
export const today = (now = Date.now()) => iso(new Date(now));
export const daysBetween = (from, to) => Math.round((noon(to) - noon(from)) / DAY_MS);
export const addDays = (day, n) => { const d = noon(day); d.setDate(d.getDate() + n); return iso(d); };
export const dayOf = index => addDays(LAUNCH, index);
export const indexOfDay = (day, count) => { const i = daysBetween(LAUNCH, day); return i >= 0 && i < count ? i : -1; };
export const shortDate = day => noon(day).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
export const monthDay = day => noon(day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
export const monthTitle = (year, month) => new Date(year, month, 15).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
