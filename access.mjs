// Who may open which day's puzzle. Everything is free for now. If a paywall is ever worth it, it starts here:
// freeDays = 7, say, keeps the last week open to everyone, and the archive then needs a way to become a member.
// (A real paywall also has to keep locked puzzles out of the page, served only once someone has paid,
// since everything in this folder ships to every browser.)
import { daysBetween } from './schedule.mjs';

export const policy = { freeDays: Infinity };
let member = false;
export const setMember = yes => { member = !!yes; };
// 'future' (not out yet), 'open', or 'locked'.
export function access(day, today) {
  const age = daysBetween(day, today);
  if (age < 0) return 'future';
  return member || age < policy.freeDays ? 'open' : 'locked';
}
