import { Book } from '../../models/Book.js';
import { BookAssociation } from '../../models/BookAssociation.js';
import { ReaderInteraction } from '../../models/ReaderInteraction.js';
import { VectorIndexMetadata } from '../../models/VectorIndexMetadata.js';
import { config } from '../../config/recommendations.js';
import { gutenbergCatalog } from '../../seed/gutenbergCatalog.js';
import { buildGutenbergCover } from './defaults.js';
import { embedText } from './embeddingService.js';
import { invalidateVectorIndex, loadVectorIndex, searchSimilar } from './vectorIndex.js';
import { buildEmbeddingText, normalizeGenres, normalizeLower, normalizeTitleAuthorKey, normalizeWhitespace } from './text.js';

const inferMetadataQuality = (book) => {
  let score = 0;
  if (book.title) score += 0.15;
  if (book.author) score += 0.15;
  if (book.description && book.description.length > 80) score += 0.25;
  if (book.coverImage) score += 0.1;
  if (book.genres?.length) score += 0.15;
  if (book.subjects?.length) score += 0.1;
  if (book.themes?.length || book.emotionalTones?.length) score += 0.1;
  return Math.min(1, score);
};

export const normalizeBookRecord = (entry, index = 0) => {
  const source = normalizeLower(entry.source || (entry.gutenbergId ? 'gutenberg' : 'local'));
  const sourceId = normalizeWhitespace(entry.sourceId || entry.gutenbergId || entry.id || normalizeTitleAuthorKey(entry.title, entry.author));
  const genres = normalizeGenres(entry.genres || entry.tags || entry.subjects);
  const book = {
    title: normalizeWhitespace(entry.title),
    author: normalizeWhitespace(entry.author),
    description: normalizeWhitespace(entry.description || entry.synopsis || ''),
    coverImage: normalizeWhitespace(entry.coverImage || (entry.gutenbergId ? buildGutenbergCover(entry.gutenbergId) : '')),
    genres,
    subjects: Array.from(new Set([...(Array.isArray(entry.subjects) ? entry.subjects : []), ...genres].map(normalizeLower).filter(Boolean))).slice(0, 60),
    themes: Array.from(new Set((Array.isArray(entry.themes) ? entry.themes : genres).map(normalizeLower).filter(Boolean))).slice(0, 30),
    emotionalTones: Array.from(new Set((Array.isArray(entry.emotionalTones) ? entry.emotionalTones : []).map(normalizeLower).filter(Boolean))).slice(0, 20),
    source,
    sourceId,
    canonicalKey: normalizeTitleAuthorKey(entry.title, entry.author),
    popularity: Number(entry.popularity || Math.max(1, 1000 - index)),
    rating: Number(entry.rating || 0),
    gutenbergId: Number.isFinite(Number(entry.gutenbergId)) ? Number(entry.gutenbergId) : null,
  };
  book.embeddingText = buildEmbeddingText(book);
  book.metadataQuality = inferMetadataQuality(book);
  return book;
};

export const seedDefaultDataset = async () => {
  const operations = gutenbergCatalog.map((entry, index) => {
    const book = normalizeBookRecord(entry, index);
    return {
      updateOne: {
        filter: { source: book.source, sourceId: book.sourceId },
        update: { $set: book },
        upsert: true,
      },
    };
  });
  if (!operations.length) return { upserted: 0, modified: 0 };
  const result = await Book.bulkWrite(operations, { ordered: false });
  return { upserted: result.upsertedCount || 0, modified: result.modifiedCount || 0 };
};

export const embedMissingBooks = async () => {
  let embedded = 0;
  const cursor = Book.find({ $or: [{ embedding: { $exists: false } }, { 'embedding.0': { $exists: false } }, { embeddingModel: { $ne: config.embeddingModel } }] })
    .select('embeddingText title author genres description subjects themes emotionalTones')
    .cursor();

  for await (const book of cursor) {
    const text = book.embeddingText || buildEmbeddingText(book);
    const embedding = await embedText(text);
    await Book.updateOne({ _id: book._id }, { $set: { embedding, embeddingModel: config.embeddingModel, embeddingText: text } });
    embedded += 1;
    if (embedded % 100 === 0) console.info(`[INDEX_BUILD] Embedded ${embedded} books...`);
  }
  return embedded;
};

export const precomputeSemanticAssociations = async ({ limitPerBook = 30 } = {}) => {
  await loadVectorIndex({ force: true });
  const embeddedBooks = await Book.find({ embedding: { $exists: true, $type: 'array', $ne: [] } })
    .select('+embedding title author genres source sourceId canonicalKey')
    .lean();
  let associationCount = 0;

  for (const book of embeddedBooks) {
    const matches = await searchSimilar({
      embedding: book.embedding,
      genres: book.genres,
      author: book.author,
      excludeKeys: [book.canonicalKey, `${book.source}:${book.sourceId}`],
      limit: limitPerBook,
    });
    const operations = matches.slice(0, limitPerBook).map(({ book: candidate, score }) => ({
      updateOne: {
        filter: { bookKey: book.canonicalKey, recommendedBookKey: candidate.bookKey },
        update: { $set: { bookKey: book.canonicalKey, recommendedBookKey: candidate.bookKey, weight: score, support: 0, confidence: 0 } },
        upsert: true,
      },
    }));
    if (operations.length) {
      const result = await BookAssociation.bulkWrite(operations, { ordered: false });
      associationCount += (result.upsertedCount || 0) + (result.modifiedCount || 0);
    }
  }
  return associationCount;
};

export const precomputeCollaborativeAssociations = async () => {
  const interactions = await ReaderInteraction.find({}).select('userId bookKey weight eventType').lean();
  const byUser = new Map();
  const eventWeights = { saved: 1, currently_reading: 2, read: 3, finished: 4, rated: 4 };

  for (const interaction of interactions) {
    if (!byUser.has(interaction.userId)) byUser.set(interaction.userId, new Map());
    const userBooks = byUser.get(interaction.userId);
    userBooks.set(interaction.bookKey, (userBooks.get(interaction.bookKey) || 0) + Number(interaction.weight || 1) * (eventWeights[interaction.eventType] || 1));
  }

  const edges = new Map();
  for (const userBooks of byUser.values()) {
    const entries = Array.from(userBooks.entries()).slice(0, 250);
    for (let i = 0; i < entries.length; i += 1) {
      for (let j = 0; j < entries.length; j += 1) {
        if (i === j) continue;
        const [a, weightA] = entries[i];
        const [b, weightB] = entries[j];
        const key = `${a}\t${b}`;
        const edge = edges.get(key) || { bookKey: a, recommendedBookKey: b, support: 0, weight: 0 };
        edge.support += 1;
        edge.weight += Math.sqrt(weightA * weightB);
        edges.set(key, edge);
      }
    }
  }

  const operations = Array.from(edges.values())
    .filter((edge) => edge.bookKey !== edge.recommendedBookKey)
    .map((edge) => ({
      updateOne: {
        filter: { bookKey: edge.bookKey, recommendedBookKey: edge.recommendedBookKey },
        update: { $set: { ...edge, confidence: edge.weight / Math.max(1, edge.support) } },
        upsert: true,
      },
    }));

  if (!operations.length) return 0;
  const result = await BookAssociation.bulkWrite(operations, { ordered: false });
  return (result.upsertedCount || 0) + (result.modifiedCount || 0);
};

export const buildVectorIndex = async () => {
  const startedAt = Date.now();
  await VectorIndexMetadata.findOneAndUpdate({ name: 'books' }, { $set: { status: 'building', error: '' } }, { upsert: true });
  try {
    const seedResult = await seedDefaultDataset();
    const embedded = await embedMissingBooks();
    invalidateVectorIndex();
    const semanticAssociations = await precomputeSemanticAssociations();
    const collaborativeAssociations = await precomputeCollaborativeAssociations();
    const bookCount = await Book.countDocuments({ embedding: { $exists: true, $type: 'array', $ne: [] } });
    const associationCount = await BookAssociation.countDocuments();
    await VectorIndexMetadata.findOneAndUpdate({ name: 'books' }, {
      $set: {
        status: 'ready', embeddingModel: config.embeddingModel, dimensions: config.embeddingDimensions,
        bookCount, associationCount, builtAt: new Date(), error: '',
      },
    }, { upsert: true });
    await loadVectorIndex({ force: true });
    return { ok: true, elapsedMs: Date.now() - startedAt, seedResult, embedded, semanticAssociations, collaborativeAssociations, bookCount, associationCount };
  } catch (error) {
    await VectorIndexMetadata.findOneAndUpdate({ name: 'books' }, { $set: { status: 'failed', error: error?.message || String(error) } }, { upsert: true });
    throw error;
  }
};
