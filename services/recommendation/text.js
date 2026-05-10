const STOP_WORDS = new Set(['a', 'an', 'and', 'are', 'as', 'at', 'by', 'for', 'from', 'in', 'into', 'is', 'of', 'on', 'or', 'the', 'to', 'with']);
const UNKNOWN_GENRES = new Set(['unknown', 'n/a', 'none', 'null', 'undefined', 'misc', 'general']);

export const normalizeWhitespace = (value) => String(value || '').replace(/\s+/g, ' ').trim();
export const normalizeLower = (value) => normalizeWhitespace(value).toLowerCase();
export const normalizeTitleAuthorKey = (title, author) => `${normalizeLower(title)}::${normalizeLower(author)}`;
export const normalizeSourceKey = (source, sourceId) => `${normalizeLower(source)}:${normalizeLower(sourceId)}`;
export const stableBookId = (book) => normalizeSourceKey(book.source || 'local', book.sourceId || normalizeTitleAuthorKey(book.title, book.author));

export const normalizeGenres = (genres) => Array.from(new Set((Array.isArray(genres) ? genres : [])
  .map(normalizeLower)
  .filter(Boolean)
  .filter((genre) => !UNKNOWN_GENRES.has(genre))));

export const tokenize = (value) => normalizeLower(value)
  .replace(/[^a-z0-9\s'-]/g, ' ')
  .split(/\s+/)
  .map((token) => token.replace(/^['-]+|['-]+$/g, ''))
  .filter((token) => token.length > 2 && !STOP_WORDS.has(token));

export const buildEmbeddingText = (book) => [
  `Title: ${normalizeWhitespace(book.title)}`,
  `Author: ${normalizeWhitespace(book.author)}`,
  `Genres: ${normalizeGenres(book.genres).join(', ')}`,
  `Subjects: ${(Array.isArray(book.subjects) ? book.subjects : []).map(normalizeWhitespace).filter(Boolean).slice(0, 30).join(', ')}`,
  `Themes: ${(Array.isArray(book.themes) ? book.themes : []).map(normalizeWhitespace).filter(Boolean).slice(0, 20).join(', ')}`,
  `Tone: ${(Array.isArray(book.emotionalTones) ? book.emotionalTones : []).map(normalizeWhitespace).filter(Boolean).slice(0, 10).join(', ')}`,
  `Description: ${normalizeWhitespace(book.description || book.synopsis)}`,
].filter((line) => !line.endsWith(': ')).join('\n');
