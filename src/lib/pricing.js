// Price in GBP to generate the full book, once the free preview is read.
// £7 covers up to 30,000 words (the base band), then +£2 for every
// additional 10,000-word band, uniformly, no irregular tier jumps.
const BASE_PRICE = 7;
const BASE_WORDS = 30000;
const BAND_WORDS = 10000;
const BAND_PRICE = 2;

export function estimatePrice(wordCount) {
  const words = wordCount || BASE_WORDS;
  if (words <= BASE_WORDS) return BASE_PRICE;
  const extraBands = Math.ceil((words - BASE_WORDS) / BAND_WORDS);
  return BASE_PRICE + extraBands * BAND_PRICE;
}
