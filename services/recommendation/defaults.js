import { gutenbergCatalog } from '../../seed/gutenbergCatalog.js';
import { cleanBookResponse } from './serializer.js';
import { normalizeGenres, normalizeTitleAuthorKey, normalizeWhitespace } from './text.js';

export const buildGutenbergCover = (gutenbergId) => `https://www.gutenberg.org/cache/epub/${gutenbergId}/pg${gutenbergId}.cover.medium.jpg`;

export const curatedDefaultBooks = (() => {
  const seen = new Set();
  return (Array.isArray(gutenbergCatalog) ? gutenbergCatalog : [])
    .map((entry, index) => ({
      title: normalizeWhitespace(entry.title),
      author: normalizeWhitespace(entry.author),
      description: normalizeWhitespace(entry.synopsis),
      coverImage: buildGutenbergCover(entry.gutenbergId),
      genres: normalizeGenres(entry.tags),
      source: 'gutenberg',
      sourceId: String(entry.gutenbergId),
      gutenbergId: Number(entry.gutenbergId),
      popularity: Math.max(1, 1000 - index),
    }))
    .filter((book) => {
      const key = normalizeTitleAuthorKey(book.title, book.author);
      if (!book.title || !book.author || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
})();

export const defaultRecommendationPayload = (limit) => curatedDefaultBooks
  .slice(0, limit)
  .map((book, index) => cleanBookResponse(book, 0.7 - index * 0.002));
