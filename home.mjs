// Copyright (c) 2026 Zack Abrams. All rights reserved. Not licensed for reuse; see LICENSE.
// Add to Home Screen: who can do it and how, and what to carry along. Pure, so it can be tested without a browser.

// Browsers inside other apps (Instagram, Reddit, and so on) have no Add to Home Screen.
const IN_APP = /FBAN|FBAV|Instagram|Snapchat|Twitter|LinkedInApp|Pinterest|Line\/|MicroMessenger|Reddit|; wv\)/;

// 'ios' or 'android' where this browser can add a Home Screen icon and hasn't already; otherwise null.
export function homeScreenKind({ userAgent = '', platform = '', maxTouchPoints = 0, standalone = false } = {}) {
  if (standalone || IN_APP.test(userAgent)) return null;
  if (/iPhone|iPad|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1)) return 'ios';   // iPadOS reports itself as a Mac
  if (/Android/.test(userAgent)) return 'android';
  return null;
}

// The steps shown in the Add to Home Screen guide: plain words, what to look for, and which little picture goes with each.
export const GUIDE = {
  ios: [
    { title: 'Open the Share menu', hint: 'Tap the Share button at the bottom of your screen. No Share button? Press and hold the address bar, then tap “Share”.', art: 'share2' },
    { title: 'Tap “Add to Home Screen”', hint: 'You may need to swipe up to find it.', art: 'row' },
    { title: 'Tap “Add”', hint: 'It’s in the top right corner.', art: 'add' },
  ],
  android: [
    { title: 'Tap the menu button', hint: 'It’s the three dots in the top right corner of your browser.', art: 'menu' },
    { title: 'Tap “Add to Home screen”', hint: 'Some phones say “Install app” instead.', art: 'row' },
    { title: 'Tap “Add”', hint: 'Spoondle will appear with your other apps.', art: 'add' },
  ],
};

// An iPhone's Home Screen icon opens with its own, empty storage, so the page's link carries the saved puzzles and settings
// along after the # (which stays in the browser and is never sent to a server). index.html reads them when the icon opens.
// Only puzzles that were started go, to keep the link short.
export function carryPayload(storage, progressKey) {
  const out = {};
  for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (k.startsWith('spoondle-')) out[k] = storage.getItem(k); }
  try {
    const progress = JSON.parse(out[progressKey]);
    progress.records = Object.fromEntries(Object.entries(progress.records ?? {}).filter(([, r]) => r && r.startedAt));
    out[progressKey] = JSON.stringify(progress);
  } catch {}
  return JSON.stringify(out);
}
