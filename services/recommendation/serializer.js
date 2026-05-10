import { normalizeGenres, normalizeWhitespace } from './text.js';

export const cleanBookResponse = (book, recommendationScore = 0) => ({
  title: normalizeWhitespace(book?.title),
  author: normalizeWhitespace(book?.author),
  coverImage: normalizeWhitespace(book?.coverImage) || 'https://placehold.co/420x630?text=No+Cover',
  genres: normalizeGenres(book?.genres),
  description: normalizeWhitespace(book?.description).slice(0, 900),
  source: normalizeWhitespace(book?.source || 'local'),
  sourceId: normalizeWhitespace(book?.sourceId || ''),
  recommendationScore: Number(Number(recommendationScore || book?.recommendationScore || 0).toFixed(4)),
});
