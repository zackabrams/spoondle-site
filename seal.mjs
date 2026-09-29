// Answers ship as fingerprints and sealed clues, so reading the page source doesn't spoil a board.
// This is a spoiler guard, not security: anyone willing to write code can still try every trade.
export function hash(text) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
// An answer reads as one word (CELLBLOCK) or two (RED LIGHT); a trade is checked against both.
export const labelsFor = words => [words.join(''), words.join(' ')];
export const answerDigest = (boardKey, ids, label) => hash(`${boardKey}|${ids.join('|')}|${label}`).toString(36);
export const tileOffset = (boardKey, id, length) => hash(`${boardKey}~${id}`) % length;
function keystream(label, length) {
  const bytes = [];
  for (let block = 0; bytes.length < length; block++) {
    let n = hash(`${label}#${block}`);
    for (let i = 0; i < 6; i++) { bytes.push(n % 256); n = Math.floor(n / 256); }
  }
  return bytes;
}
export function sealText(label, text) {
  const bytes = new TextEncoder().encode(text), key = keystream(label, bytes.length);
  return btoa(String.fromCharCode(...bytes.map((b, i) => b ^ key[i])));
}
export function openText(label, sealed) {
  const bytes = Uint8Array.from(atob(sealed), c => c.charCodeAt(0)), key = keystream(label, bytes.length);
  return new TextDecoder().decode(bytes.map((b, i) => b ^ key[i]));
}
