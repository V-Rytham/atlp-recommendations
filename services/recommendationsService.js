import { Book } from '../models/Book.js';
import { gutenbergCatalog } from '../seed/gutenbergCatalog.js';

const GROQ_API_URL = String(process.env.GROQ_API_URL || 'https://api.groq.com/openai/v1/chat/completions');
const GROQ_MODEL = String(process.env.GROQ_MODEL || 'llama-3.1-8b-instant');
const GROQ_TIMEOUT_MS = Number(process.env.GROQ_TIMEOUT_MS || 12_000);

const GOOGLE_BOOKS_API_KEY = String(process.env.GOOGLE_BOOKS_API_KEY || '').trim();
const GOOGLE_BOOKS_HOST = 'https://www.googleapis.com/books/v1/volumes';

const OPEN_LIBRARY_HOST = 'https://openlibrary.org';

const MIN_RESULTS = 50;
const MAX_RESULTS = 50;

const UNKNOWN_GENRES = new Set(['unknown', 'n/a', 'none', 'null', 'undefined', 'misc', 'general']);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const normalizeWhitespace = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const normalizeGenreToken = (value) => normalizeWhitespace(value).toLowerCase();

const normalizeTitleAuthorKey = (title, author) => `${normalizeWhitespace(title).toLowerCase()}::${normalizeWhitespace(author).toLowerCase()}`;

const ensureNonEmptyGenres = (genres) => {
  const list = Array.isArray(genres) ? genres : [];
  const cleaned = Array.from(
    new Set(
      list
        .map(normalizeGenreToken)
        .filter(Boolean)
        .filter((g) => !UNKNOWN_GENRES.has(g)),
    ),
  );
  return cleaned;
};

const withTimeout = async (url, init = {}, timeoutMs = 12_000) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
};

const safeJson = async (response) => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const buildGutenbergCover = (gutenbergId) => (
  `https://www.gutenberg.org/cache/epub/${gutenbergId}/pg${gutenbergId}.cover.medium.jpg`
);

const extractFirstJsonObject = (rawContent) => {
  const raw = String(rawContent || '').trim();
  if (!raw) return '';
  const unfenced = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return '';
  return unfenced.slice(start, end + 1).trim();
};

const parseGroqBooks = (rawContent) => {
  const candidates = [String(rawContent || ''), extractFirstJsonObject(rawContent)].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      const list = Array.isArray(parsed?.books) ? parsed.books : null;
      if (list) return list;
    } catch {
      // continue
    }
  }
  return [];
};

const buildGroqPrompt = (genres, excludePairs = []) => {
  const excludeHint = excludePairs.length
    ? `Avoid these title+author pairs (do not repeat): ${excludePairs.slice(0, 40).join(' | ')}.`
    : '';

  return `
Return STRICT JSON only, no markdown, no commentary.
Shape:
{
  "books": [
    {
      "title": "string",
      "author": "string",
      "genres": ["string"]
    }
  ]
}

Rules (mandatory):
- Provide at most ${MAX_RESULTS} books.
- genres MUST be present and must NOT be empty for every book.
- No duplicate title+author pairs.
- ${excludeHint}
- Target genres: ${genres.join(', ')}.
`.trim();
};

const callGroq = async ({ genres, excludePairs = [] }) => {
  const apiKey = String(process.env.GROQ_API_KEY || '').trim();
  if (!apiKey) {
    const error = new Error('Missing GROQ_API_KEY.');
    error.statusCode = 500;
    throw error;
  }

  const response = await withTimeout(
    GROQ_API_URL,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.25,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'You are a strict JSON generator for book recommendations.' },
          { role: 'user', content: buildGroqPrompt(genres, excludePairs) },
        ],
      }),
    },
    GROQ_TIMEOUT_MS,
  );

  const contentType = String(response.headers.get('content-type') || '');
  const payload = contentType.includes('application/json') ? await safeJson(response) : null;
  const raw = payload?.choices?.[0]?.message?.content ?? (await response.text());
  return String(raw || '');
};

const hardValidateGroqList = (books) => {
  const seen = new Set();
  const valid = [];

  for (const entry of Array.isArray(books) ? books : []) {
    const title = normalizeWhitespace(entry?.title);
    const author = normalizeWhitespace(entry?.author);
    const genres = ensureNonEmptyGenres(entry?.genres);

    if (!title || !author) continue;
    if (!genres.length) continue;

    const key = normalizeTitleAuthorKey(title, author);
    if (seen.has(key)) continue;
    seen.add(key);

    valid.push({ title, author, genres });
    if (valid.length >= MAX_RESULTS) break;
  }

  return valid;
};

const normalizeCatalog = (() => {
  const list = Array.isArray(gutenbergCatalog) ? gutenbergCatalog : [];
  const byKey = new Map();

  for (const entry of list) {
    const title = normalizeWhitespace(entry?.title);
    const author = normalizeWhitespace(entry?.author);
    const gutenbergId = Number(entry?.gutenbergId);
    if (!title || !author) continue;
    if (!Number.isFinite(gutenbergId) || gutenbergId <= 0) continue;

    const key = normalizeTitleAuthorKey(title, author);
    if (!byKey.has(key)) {
      byKey.set(key, {
        gutenbergId,
        tags: Array.isArray(entry?.tags) ? entry.tags : [],
      });
    }
  }

  return { byKey };
})();

const tryEnrichGutenberg = async (book) => {
  const key = normalizeTitleAuthorKey(book.title, book.author);
  const catalogHit = normalizeCatalog.byKey.get(key);

  if (!catalogHit) {
    return null;
  }

  const gutenbergId = Number(catalogHit.gutenbergId);
  const tags = ensureNonEmptyGenres(catalogHit.tags);
  const genres = book.genres.length ? book.genres : tags;
  if (!genres.length) return null;

  // Ensure a DB record exists so other modules can resolve this book.
  let internalId = null;
  try {
    const persisted = await Book.findOneAndUpdate(
      { gutenbergId },
      { $set: { title: book.title, author: book.author, gutenbergId, lastAccessedAt: new Date() } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).select('_id').lean();
    internalId = persisted?._id ? String(persisted._id) : null;
  } catch {
    internalId = null;
  }

  return {
    title: book.title,
    author: book.author,
    gutenbergId,
    coverImage: buildGutenbergCover(gutenbergId),
    genres,
    source: 'gutenberg',
    sourceId: String(gutenbergId),
    internalBookId: internalId,
  };
};

const searchOpenLibraryForMatch = async ({ title, author }) => {
  const url = `${OPEN_LIBRARY_HOST}/search.json?title=${encodeURIComponent(title)}&author=${encodeURIComponent(author)}&limit=3`;
  const response = await withTimeout(url, {}, 10_000);
  if (!response.ok) return null;
  const payload = await safeJson(response);
  const docs = Array.isArray(payload?.docs) ? payload.docs : [];
  return docs[0] || null;
};

const enrichFromOpenLibrary = async ({ title, author }) => {
  const doc = await searchOpenLibraryForMatch({ title, author });
  if (!doc) return null;

  const workKey = String(doc?.key || '').trim(); // "/works/OL..."
  const workId = workKey.replace(/^\/works\//, '').trim();
  const coverId = doc?.cover_i || null;
  const coverImage = coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : '';

  const subjects = ensureNonEmptyGenres(doc?.subject || doc?.subjects || []);

  return {
    source: 'openlibrary',
    sourceId: workId || String(doc?.edition_key?.[0] || doc?.cover_edition_key || '').trim() || workId || '',
    coverImage,
    inferredGenres: subjects,
  };
};

const searchGoogleBooksForMatch = async ({ title, author }) => {
  const q = `intitle:${title} inauthor:${author}`;
  const params = new URLSearchParams({
    q,
    maxResults: '1',
    printType: 'books',
  });
  if (GOOGLE_BOOKS_API_KEY) params.set('key', GOOGLE_BOOKS_API_KEY);

  const response = await withTimeout(`${GOOGLE_BOOKS_HOST}?${params.toString()}`, {}, 10_000);
  if (!response.ok) return null;
  const payload = await safeJson(response);
  const item = Array.isArray(payload?.items) ? payload.items[0] : null;
  return item || null;
};

const enrichFromGoogleBooks = async ({ title, author }) => {
  const item = await searchGoogleBooksForMatch({ title, author });
  if (!item) return null;

  const volume = item?.volumeInfo || {};
  const categories = ensureNonEmptyGenres(volume?.categories || []);
  const imageLinks = volume?.imageLinks || {};
  const coverImage = String(imageLinks.thumbnail || imageLinks.smallThumbnail || '').replace(/^http:\/\//i, 'https://');
  const sourceId = String(item?.id || '').trim();

  return {
    source: 'googlebooks',
    sourceId,
    coverImage,
    inferredGenres: categories,
  };
};

const enrichOne = async (book) => {
  // Priority 1: Gutenberg mapping via existing catalog.
  const gutenberg = await tryEnrichGutenberg(book);
  if (gutenberg) {
    return gutenberg;
  }

  // Priority 2: OpenLibrary enrichment.
  const openlibrary = await enrichFromOpenLibrary({ title: book.title, author: book.author });

  // Priority 3: Google Books enrichment.
  const google = await enrichFromGoogleBooks({ title: book.title, author: book.author });

  const genres = (() => {
    const fromGroq = ensureNonEmptyGenres(book.genres);
    if (fromGroq.length) return fromGroq;
    const fromOl = ensureNonEmptyGenres(openlibrary?.inferredGenres || []);
    if (fromOl.length) return fromOl;
    const fromGoogle = ensureNonEmptyGenres(google?.inferredGenres || []);
    return fromGoogle;
  })();

  if (!genres.length) {
    return null;
  }

  const coverImage = String(openlibrary?.coverImage || google?.coverImage || '').trim()
    || 'https://placehold.co/420x630?text=No+Cover';

  const source = openlibrary?.sourceId ? 'openlibrary' : (google?.sourceId ? 'googlebooks' : 'openlibrary');
  const sourceId = String(openlibrary?.sourceId || google?.sourceId || '').trim();
  if (!sourceId) {
    return null;
  }

  return {
    title: book.title,
    author: book.author,
    gutenbergId: null,
    coverImage,
    genres,
    source,
    sourceId,
  };
};

const mapWithConcurrency = async (items, limit, mapper) => {
  const list = Array.isArray(items) ? items : [];
  const results = new Array(list.length);
  let cursor = 0;

  const runWorker = async () => {
    while (cursor < list.length) {
      const index = cursor++;
      results[index] = await mapper(list[index], index);
    }
  };

  const workers = Array.from({ length: clamp(limit, 1, 8) }).map(runWorker);
  await Promise.all(workers);
  return results;
};

const fillFromOpenLibrarySubjects = async ({ genres, seenKeys, targetCount }) => {
  const results = [];
  const normalizedGenres = genres.map((g) => normalizeGenreToken(g)).filter(Boolean);

  for (const genre of normalizedGenres) {
    if (results.length >= targetCount) break;
    const subject = genre.replace(/\s+/g, '-');
    const response = await withTimeout(`${OPEN_LIBRARY_HOST}/subjects/${encodeURIComponent(subject)}.json?limit=50`, {}, 12_000);
    if (!response.ok) continue;
    const payload = await safeJson(response);
    const works = Array.isArray(payload?.works) ? payload.works : [];

    for (const work of works) {
      if (results.length >= targetCount) break;
      const title = normalizeWhitespace(work?.title);
      const author = normalizeWhitespace(work?.authors?.[0]?.name);
      if (!title || !author) continue;
      const key = normalizeTitleAuthorKey(title, author);
      if (seenKeys.has(key)) continue;

      const coverId = work?.cover_id || null;
      const coverImage = coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : 'https://placehold.co/420x630?text=No+Cover';
      const workId = String(work?.key || '').replace(/^\/works\//, '').trim();
      const inferred = ensureNonEmptyGenres(work?.subject || work?.subjects || [genre]);
      if (!inferred.length) continue;

      seenKeys.add(key);
      results.push({
        title,
        author,
        gutenbergId: null,
        coverImage,
        genres: inferred,
        source: 'openlibrary',
        sourceId: workId || `${subject}:${key}`,
      });
    }
  }

  return results;
};

export const buildRecommendations = async ({ genres }) => {
  const normalizedGenres = Array.from(new Set((Array.isArray(genres) ? genres : []).map(normalizeGenreToken).filter(Boolean)));
  if (normalizedGenres.length === 0) {
    const error = new Error('genres must be non-empty.');
    error.statusCode = 400;
    throw error;
  }

  let groqRaw = '';
  try {
    groqRaw = await callGroq({ genres: normalizedGenres });
  } catch (error) {
    console.warn('[RECOMMENDATIONS] Groq call failed, will attempt OpenLibrary fill:', error?.message || error);
    groqRaw = '';
  }


  const groqBooks = hardValidateGroqList(parseGroqBooks(groqRaw));
  const excludePairs = groqBooks.map((b) => `${b.title} by ${b.author}`);

  // Enrich + enforce genres (drop if we cannot produce valid genres).
  const enrichedPrimary = (await mapWithConcurrency(groqBooks, 5, enrichOne)).filter(Boolean);

  // Deduplicate after enrichment by title+author.
  const seenKeys = new Set();
  const merged = [];
  for (const book of enrichedPrimary) {
    const key = normalizeTitleAuthorKey(book.title, book.author);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    merged.push(book);
  }

  // Top up if we don't have enough.
  if (merged.length < MIN_RESULTS) {
    // One retry on Groq with excludes.
    let retryRaw = '';
    try {
      retryRaw = await callGroq({ genres: normalizedGenres, excludePairs });
    } catch (error) {
      console.warn('[RECOMMENDATIONS] Groq retry failed:', error?.message || error);
      retryRaw = '';
    }

    if (retryRaw) {
      const retryBooks = hardValidateGroqList(parseGroqBooks(retryRaw));
      const enrichedRetry = (await mapWithConcurrency(retryBooks, 5, enrichOne)).filter(Boolean);
      for (const book of enrichedRetry) {
        const key = normalizeTitleAuthorKey(book.title, book.author);
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        merged.push(book);
        if (merged.length >= MAX_RESULTS) break;
      }
    }
  }

  if (merged.length < MIN_RESULTS) {
    const fill = await fillFromOpenLibrarySubjects({
      genres: normalizedGenres,
      seenKeys,
      targetCount: MIN_RESULTS - merged.length,
    });
    merged.push(...fill);
  }

  const finalBooks = merged
    .map((book) => ({
      title: normalizeWhitespace(book.title),
      author: normalizeWhitespace(book.author),
      gutenbergId: Number.isFinite(Number(book.gutenbergId)) ? Number(book.gutenbergId) : null,
      coverImage: String(book.coverImage || '').trim() || 'https://placehold.co/420x630?text=No+Cover',
      genres: ensureNonEmptyGenres(book.genres),
      source: book.source,
      sourceId: String(book.sourceId || '').trim(),
    }))
    .filter((book) => book.title && book.author && book.sourceId && book.genres.length > 0)
    .filter((book) => !book.genres.some((g) => UNKNOWN_GENRES.has(normalizeGenreToken(g))))
    .slice(0, MAX_RESULTS);

  // Ensure 50 books even in worst case by filling with OpenLibrary subject search.
  if (finalBooks.length < MIN_RESULTS) {
    const fill = await fillFromOpenLibrarySubjects({
      genres: normalizedGenres,
      seenKeys: new Set(finalBooks.map((b) => normalizeTitleAuthorKey(b.title, b.author))),
      targetCount: MIN_RESULTS - finalBooks.length,
    });
    const safeFill = fill
      .map((book) => ({
        title: normalizeWhitespace(book.title),
        author: normalizeWhitespace(book.author),
        gutenbergId: null,
        coverImage: String(book.coverImage || '').trim() || 'https://placehold.co/420x630?text=No+Cover',
        genres: ensureNonEmptyGenres(book.genres),
        source: 'openlibrary',
        sourceId: String(book.sourceId || '').trim(),
      }))
      .filter((book) => book.title && book.author && book.sourceId && book.genres.length > 0);
    finalBooks.push(...safeFill.slice(0, MIN_RESULTS - finalBooks.length));
  }

  // Final strict bounds.
  const bounded = finalBooks.slice(0, clamp(finalBooks.length, MIN_RESULTS, MAX_RESULTS));

  // If Groq failed completely and fill isn't enough, throw (better than breaking contract silently).
  if (bounded.length < MIN_RESULTS) {
    const error = new Error('Unable to produce enough recommendations to satisfy contract.');
    error.statusCode = 502;
    throw error;
  }

  return { books: bounded };
};
