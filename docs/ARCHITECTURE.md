# After The Last Page Recommendation Architecture

## Runtime design

The microservice is now deterministic and vector-first. User-facing endpoints do not call LLMs, Google Books, OpenLibrary, or any paid API. They query MongoDB plus an in-memory vector index loaded from prepared book embeddings.

## Data sources

The built-in bootstrap dataset uses the existing Project Gutenberg curated catalog. For larger free coverage, run `npm run ingest:openlibrary` to ingest OpenLibrary subject metadata before building the vector index. OpenLibrary is free and works well as an initial public-domain/open metadata source; future bulk dump importers can write into the same `books` schema.

## Collections

- `books`: normalized metadata, deduplication key, local embedding text, embedding vector, source identifiers, quality and popularity signals.
- `readerinteractions`: optional app-provided reader events used to build collaborative edges.
- `bookassociations`: precomputed semantic and collaborative recommendation edges.
- `vectorindexmetadatas`: build status and index stats.

## Warm-up flow

`POST /admin/build-vector-index` or `npm run build:index`:

1. Upserts the curated Gutenberg catalog.
2. Embeds missing/stale books with `@huggingface/transformers` and `Xenova/all-MiniLM-L6-v2` locally.
3. Reloads the in-memory vector index.
4. Precomputes semantic book-to-book associations.
5. Precomputes collaborative co-occurrence associations from reader interactions.
6. Writes index metadata.

## Endpoint behavior

- `POST /api/recommendations/library`: genre preference recommendations; empty genres return curated defaults instead of errors.
- `POST /api/recommendations/similar`: semantic/thematic/genre/author-proximity recommendations for the current book.
- `POST /api/recommendations/collaborative` and `GET /api/recommendations/collaborative/:sourceId`: “readers also read” graph recommendations with semantic/default fallback.
- `POST /api/recommendations`: backward-compatible alias for library recommendations.

## Render deployment

Set environment variables:

```bash
MONGODB_URI=mongodb+srv://...
ADMIN_INDEX_TOKEN=<long random secret>
ALLOW_ADMIN_INDEX_BUILD=false
EMBEDDING_MODEL=Xenova/all-MiniLM-L6-v2
EMBEDDING_DIMENSIONS=384
DEFAULT_RECOMMENDATION_LIMIT=24
MAX_RECOMMENDATION_LIMIT=50
VECTOR_CANDIDATE_LIMIT=7500
```

Build command: `npm install`
Start command: `npm start`

To rebuild indexes safely, temporarily set `ALLOW_ADMIN_INDEX_BUILD=true`, deploy, call the admin endpoint with `x-admin-token`, then set it back to `false`. For one-off Render shell jobs, prefer `npm run build:index`.

## Performance notes

- Embeddings are generated only during warm-up or when similar recommendations receive an unknown request book.
- Prepared vectors are loaded into memory once; endpoints score local candidates with cosine similarity and metadata boosts.
- Genre inverted lists prune candidate scans for low latency.
- All recommendation responses deduplicate by title/author and gracefully fill from curated defaults.
