// Length of free-text profile fields as both sides count it: the profile form imports this file
// for its counters, and the server (src/platform/profile.js) imports the same file to enforce the
// limits. Characters of alphabetic scripts count 1; Chinese, Japanese, Korean, other wide
// characters and emoji count 2, so a Chinese and an English text of the same weight say about as
// much and take about as much room on a card. The narrow ranges are the ones Twitter uses for
// its weighted tweet length.
const NARROW = [
  [0x0000, 0x10ff], // Latin, Greek, Cyrillic, Hebrew, Arabic, Indic scripts, ... Georgian
  [0x2000, 0x200d], // spaces and joiners
  [0x2010, 0x201f], // dashes and quotation marks
  [0x2032, 0x2037], // primes
];

export function textWeight(text) {
  let n = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0);
    n += NARROW.some(([lo, hi]) => c >= lo && c <= hi) ? 1 : 2;
  }
  return n;
}
