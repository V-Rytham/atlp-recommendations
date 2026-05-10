import { Book } from '../../models/Book.js';
import { BookAssociation } from '../../models/BookAssociation.js';
import { config } from '../../config/recommendations.js';
import { embedText } from './embeddingService.js';
import { buildEmbeddingText, normalizeGenres, normalizeSourceKey, normalizeTitleAuthorKey, normalizeWhitespace } from './text.js';
import { defaultRecommendationPayload } from './defaults.js';
import { getBookByKey, genreRecommendations, loadVectorIndex, searchSimilar } from './vectorIndex.js';
import { cleanBookResponse } from './serializer.js';
import { clamp } from './math.js';

const boundedLimit = (limit) => clamp(Number(limit || config.defaultLimit), 1, config.maxLimit);

const uniqueClean = (ranked, limit) => {
  const seen = new Set();
  const books = [];
  for (const item of ranked) {
    const book = item.book || item;
    const key = normalizeTitleAuthorKey(book.title, book.author);
    if (!book.title || !book.author || seen.has(key)) continue;
    seen.add(key);
    books.push(cleanBookResponse(book, item.score || book.recommendationScore || 0));
    if (books.length >= limit) break;
  }
  return books;
};

const fillWithDefaults = (books, limit) => {
  if (books.length >= limit) return books.slice(0, limit);
  const seen = new Set(books.map((book) => normalizeTitleAuthorKey(book.title, book.author)));
  for (const book of defaultRecommendationPayload(limit)) {
    const key = normalizeTitleAuthorKey(book.title, book.author);
    if (seen.has(key)) continue;
    seen.add(key);
    books.push(book);
    if (books.length >= limit) break;
  }
  return books;
};

export const recommendForLibrary = async ({ genres = [], limit = config.defaultLimit }) => {
  const safeLimit = boundedLimit(limit);
  const normalizedGenres = normalizeGenres(genres);
  if (!normalizedGenres.length) {
    return { books: defaultRecommendationPayload(safeLimit), personalized: false, strategy: 'curated-default' };
  }

  try {
    const ranked = await genreRecommendations({ genres: normalizedGenres, limit: safeLimit });
    const books = fillWithDefaults(uniqueClean(ranked, safeLimit), safeLimit);
    return { books, personalized: true, strategy: 'genre-vector-index' };
  } catch (error) {
    console.warn('[RECOMMENDATIONS] Library fallback:', error?.message || error);
    return { books: defaultRecommendationPayload(safeLimit), personalized: false, strategy: 'curated-default-fallback' };
  }
};

export const recommendSimilarBooks = async ({ book, source, sourceId, limit = config.defaultLimit }) => {
  const safeLimit = boundedLimit(limit);
  try {
    await loadVectorIndex();
    let anchor = null;
    if (source && sourceId) anchor = await getBookByKey(source, sourceId);
    if (!anchor && book?.source && book?.sourceId) anchor = await getBookByKey(book.source, book.sourceId);

    const queryBook = anchor || {
      title: normalizeWhitespace(book?.title),
      author: normalizeWhitespace(book?.author),
      description: normalizeWhitespace(book?.description || book?.synopsis),
      genres: normalizeGenres(book?.genres || book?.tags),
      subjects: Array.isArray(book?.subjects) ? book.subjects : [],
      themes: Array.isArray(book?.themes) ? book.themes : [],
      emotionalTones: Array.isArray(book?.emotionalTones) ? book.emotionalTones : [],
      source: book?.source || 'request',
      sourceId: book?.sourceId || 'request',
    };

    const embedding = anchor?.embedding?.length ? anchor.embedding : await embedText(buildEmbeddingText(queryBook));
    const excludeKeys = [anchor?.bookKey, anchor?.sourceKey, normalizeTitleAuthorKey(queryBook.title, queryBook.author), normalizeSourceKey(queryBook.source, queryBook.sourceId)].filter(Boolean);
    const ranked = await searchSimilar({ embedding, genres: queryBook.genres, author: queryBook.author, excludeKeys, limit: safeLimit });
    const books = fillWithDefaults(uniqueClean(ranked, safeLimit), safeLimit);
    return { books, strategy: anchor ? 'stored-anchor-vector' : 'request-book-vector' };
  } catch (error) {
    console.warn('[RECOMMENDATIONS] Similar fallback:', error?.message || error);
    return { books: defaultRecommendationPayload(safeLimit), strategy: 'curated-default-fallback' };
  }
};

export const recommendCollaborativeBooks = async ({ source, sourceId, bookKey, limit = config.defaultLimit }) => {
  const safeLimit = boundedLimit(limit);
  try {
    let key = bookKey;
    if (!key && source && sourceId) {
      const book = await Book.findOne({ source, sourceId }).select('canonicalKey').lean();
      key = book?.canonicalKey;
    }
    if (!key) return { books: defaultRecommendationPayload(safeLimit), strategy: 'curated-default-no-anchor' };

    const associations = await BookAssociation.find({ bookKey: key, recommendedBookKey: { $ne: key } })
      .sort({ weight: -1, support: -1 })
      .limit(safeLimit * 3)
      .lean();

    const recommendedKeys = associations.map((edge) => edge.recommendedBookKey);
    const booksByKey = await Book.find({ canonicalKey: { $in: recommendedKeys } }).lean();
    const byKey = new Map(booksByKey.map((book) => [book.canonicalKey, book]));
    const ranked = associations
      .map((edge) => ({ book: byKey.get(edge.recommendedBookKey), score: edge.weight }))
      .filter((item) => item.book);

    const books = uniqueClean(ranked, safeLimit);
    if (books.length < safeLimit) {
      const anchor = await Book.findOne({ canonicalKey: key }).select('+embedding title author genres source sourceId canonicalKey').lean();
      if (anchor?.embedding?.length) {
        const semantic = await searchSimilar({ embedding: anchor.embedding, genres: anchor.genres, author: anchor.author, excludeKeys: [key], limit: safeLimit - books.length });
        books.push(...uniqueClean(semantic, safeLimit).filter((candidate) => !books.some((existing) => normalizeTitleAuthorKey(existing.title, existing.author) === normalizeTitleAuthorKey(candidate.title, candidate.author))));
      }
    }

    return { books: fillWithDefaults(books, safeLimit), strategy: associations.length ? 'collaborative-association-graph' : 'semantic-fallback' };
  } catch (error) {
    console.warn('[RECOMMENDATIONS] Collaborative fallback:', error?.message || error);
    return { books: defaultRecommendationPayload(safeLimit), strategy: 'curated-default-fallback' };
  }
};

export const buildRecommendations = recommendForLibrary;
