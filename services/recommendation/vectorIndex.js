import { Book } from '../../models/Book.js';
import { config } from '../../config/recommendations.js';
import { cosineSimilarity, jaccard } from './math.js';
import { normalizeGenres, normalizeLower, normalizeSourceKey, normalizeTitleAuthorKey } from './text.js';

const state = {
  loaded: false,
  loading: null,
  books: [],
  byBookKey: new Map(),
  bySourceKey: new Map(),
  byGenre: new Map(),
};

const addToGenre = (genre, index) => {
  if (!state.byGenre.has(genre)) state.byGenre.set(genre, []);
  state.byGenre.get(genre).push(index);
};

const hydrate = (doc) => {
  const obj = doc.toObject ? doc.toObject() : doc;
  return {
    ...obj,
    id: String(obj._id || ''),
    bookKey: obj.canonicalKey || normalizeTitleAuthorKey(obj.title, obj.author),
    sourceKey: normalizeSourceKey(obj.source, obj.sourceId),
    genres: normalizeGenres(obj.genres),
    authorKey: normalizeLower(obj.author),
  };
};

export const loadVectorIndex = async ({ force = false } = {}) => {
  if (state.loaded && !force) return state;
  if (state.loading && !force) return state.loading;

  state.loading = (async () => {
    const docs = await Book.find({ embedding: { $exists: true, $type: 'array', $ne: [] } })
      .select('+embedding title author description coverImage genres subjects themes emotionalTones source sourceId canonicalKey popularity rating metadataQuality')
      .lean();

    state.books = docs.map(hydrate);
    state.byBookKey = new Map();
    state.bySourceKey = new Map();
    state.byGenre = new Map();

    state.books.forEach((book, index) => {
      state.byBookKey.set(book.bookKey, book);
      state.bySourceKey.set(book.sourceKey, book);
      for (const genre of book.genres) addToGenre(genre, index);
    });

    state.loaded = true;
    state.loading = null;
    console.info(`[VECTOR_INDEX] Loaded ${state.books.length} embedded books into memory.`);
    return state;
  })();

  return state.loading;
};

export const invalidateVectorIndex = () => {
  state.loaded = false;
};

export const getBookByKey = async (keyOrSource, maybeSourceId) => {
  await loadVectorIndex();
  if (maybeSourceId) return state.bySourceKey.get(normalizeSourceKey(keyOrSource, maybeSourceId)) || null;
  const raw = String(keyOrSource || '');
  return state.byBookKey.get(raw) || state.bySourceKey.get(raw) || null;
};

const candidateIndexesForGenres = (genres) => {
  const normalized = normalizeGenres(genres);
  if (!normalized.length) return state.books.map((_, index) => index);
  const selected = new Set();
  for (const genre of normalized) {
    for (const index of state.byGenre.get(genre) || []) selected.add(index);
  }
  if (selected.size < 200) return state.books.map((_, index) => index);
  return Array.from(selected).slice(0, config.vectorCandidateLimit);
};

export const searchSimilar = async ({ embedding, genres = [], author = '', excludeKeys = [], limit = config.defaultLimit }) => {
  await loadVectorIndex();
  const excludes = new Set(excludeKeys.filter(Boolean));
  const candidateIndexes = candidateIndexesForGenres(genres);
  const authorKey = normalizeLower(author);

  return candidateIndexes
    .map((index) => {
      const book = state.books[index];
      if (!book?.embedding?.length || excludes.has(book.bookKey) || excludes.has(book.sourceKey)) return null;
      const semantic = cosineSimilarity(embedding, book.embedding);
      const genreScore = jaccard(normalizeGenres(genres), book.genres);
      const authorScore = authorKey && book.authorKey === authorKey ? 0.08 : 0;
      const quality = Math.min(0.08, Number(book.metadataQuality || 0) * 0.08);
      const popularity = Math.min(0.05, Math.log10(Math.max(1, Number(book.popularity || 0))) / 60);
      const score = semantic * 0.72 + genreScore * 0.15 + authorScore + quality + popularity;
      return { book, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit * 4);
};

export const genreRecommendations = async ({ genres, limit }) => {
  await loadVectorIndex();
  const normalized = normalizeGenres(genres);
  const targetEmbedding = new Array(config.embeddingDimensions).fill(0);
  const candidates = candidateIndexesForGenres(normalized)
    .map((index) => {
      const book = state.books[index];
      const genreScore = jaccard(normalized, book.genres);
      const quality = Number(book.metadataQuality || 0) * 0.2;
      const popularity = Math.log10(Math.max(1, Number(book.popularity || 0))) / 10;
      return { book, score: genreScore * 0.65 + quality + popularity + cosineSimilarity(targetEmbedding, book.embedding) * 0.01 };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit * 3);
  return candidates;
};
