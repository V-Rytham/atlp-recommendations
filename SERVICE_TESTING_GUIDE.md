# Vector Recommendations Engine — SERVICE_TESTING_GUIDE

## A. Service Overview

**Purpose**
- Provides recommendation endpoints backed by a local vector index / embeddings workflow.
- Contains an admin endpoint to build a vector index (disabled by default).

**Main responsibilities**
- Generate recommendations for genres and library
- Generate “similar books” recommendations
- Generate collaborative recommendations using a source/sourceId key
- Provide admin-only vector index build endpoint

**Port**
- Default: `3000` (`PORT` env var)

**Environment variables**
See:
- `D:\After The Last Page\atlp-services\Recommendations-engine\atlp-recommendations\.env.example`
- `D:\After The Last Page\atlp-services\Recommendations-engine\atlp-recommendations\config\recommendations.js`

Key variables:
- `MONGODB_URI` (or `MONGO_URI`)
- `PORT`
- Admin controls:
  - `ADMIN_INDEX_TOKEN`
  - `ALLOW_ADMIN_INDEX_BUILD` (`true|false`)
- Embeddings/vector tuning:
  - `EMBEDDING_MODEL`
  - `EMBEDDING_DIMENSIONS`
  - `EMBEDDING_BATCH_SIZE`
  - `VECTOR_CANDIDATE_LIMIT`
  - `DEFAULT_RECOMMENDATION_LIMIT`
  - `MAX_RECOMMENDATION_LIMIT`
  - `CURATED_COLLECTION_SIZE`
  - `DISABLE_LOCAL_EMBEDDINGS` (when `true`, disables local embeddings)

**Dependencies**
- MongoDB
- Local embeddings via `@xenova/transformers` or similar (depending on implementation)

## B. Startup Instructions

### Installation
From `D:\After The Last Page\atlp-services\Recommendations-engine\atlp-recommendations`:
- `npm install`

### Configure env
- Copy `.env.example` → `.env`
- Minimum example:
```env
MONGODB_URI=mongodb://localhost:27017/after_the_last_page
PORT=3000
ALLOW_ADMIN_INDEX_BUILD=false
ADMIN_INDEX_TOKEN=replace-with-long-random-secret
```

### Run
- `npm run start`
- Dev: `npm run dev`

### Seed/setup
- This service includes `seed/` and `scripts/`. If you want a prebuilt vector index, use the admin endpoint (see below) once data is available.

## C. API Endpoint Documentation

**Base URL (local default)**: `http://localhost:3000`

### `GET /health`

| Item | Details |
|---|---|
| Purpose | Liveness probe |
| Success | `200` with `{ ok:true, service:..., architecture:... }` |

### `POST /api/recommendations/`

| Item | Details |
|---|---|
| Purpose | Library-style recommendations |
| Auth | None |
| Body | `{ "genres"?: string[], "limit"?: number }` |
| Success | `200` with engine result |

Notes
- `postRecommendations` calls `recommendForLibrary({ genres, limit })`.
- Input validation is minimal at the controller layer; engine may enforce more.

### `POST /api/recommendations/library`
Same as `/api/recommendations/` (controller calls the same function).

### `POST /api/recommendations/similar`

| Item | Details |
|---|---|
| Purpose | Recommend books similar to a given book |
| Body | Either `{ "book": { ... }, "limit"?: number }` OR `{ "source": string, "sourceId": string, "limit"?: number }` |
| Success | `200` with engine result |
| Failures | `400` if neither book nor source/sourceId is provided |

Validation rules (implemented)
- Must provide either `book` object OR both `source` and `sourceId`.

### `POST /api/recommendations/collaborative`

| Item | Details |
|---|---|
| Purpose | Collaborative recommendations based on a source/sourceId |
| Body | `{ "source"?: string, "sourceId": string, "bookKey"?: string, "limit"?: number }` |
| Query (optional) | `source`, `limit` |
| Success | `200` with engine result |

### `GET /api/recommendations/collaborative/:sourceId`
Alternative route for collaborative recommendations.

---

## Admin

### `POST /admin/build-vector-index`

| Item | Details |
|---|---|
| Purpose | Build/rebuild the vector index (expensive operation) |
| Auth | Requires admin token AND `ALLOW_ADMIN_INDEX_BUILD=true` |
| Headers | `X-Admin-Token: <ADMIN_INDEX_TOKEN>` |
| Body (optional) | `{ "adminToken": "<token>" }` |
| Success | `200` with ingestion result |
| Failures | `403` when disabled/unauthorized, `500` when build fails |

Sample request
```bash
curl -s -X POST http://localhost:3000/admin/build-vector-index \
  -H "Content-Type: application/json" \
  -H "X-Admin-Token: replace-with-long-random-secret" \
  -d "{}"
```

Security note
- This endpoint should never be exposed publicly.

## D. Testing Instructions

### Smoke tests
1. Health:
   - `curl -s http://localhost:3000/health`
2. Recommendations:
   - `POST /api/recommendations` with `{ "genres": ["fantasy"], "limit": 10 }`
3. Similar:
   - `POST /api/recommendations/similar` with a `source` + `sourceId`

### Expected success results
- `200` with a recommendation payload (structure depends on engine implementation).

### Expected failure results
- `POST /api/recommendations/similar` missing both inputs → `400`
- Admin build with missing token or disabled flag → `403`

### Edge cases
- `limit` above max configured (`MAX_RECOMMENDATION_LIMIT`) should be clamped/rejected (verify engine behavior).
- Unknown `source` values (should default to `gutenberg` for collaborative endpoint).

## E. Validation Analysis

What exists
- Basic presence validation for similar recommendations input.
- Admin authorization check compares token and checks `ALLOW_ADMIN_INDEX_BUILD`.

Missing/weak validation
- Genre list validation is not enforced at controller layer.
- `sourceId` is not strongly validated.
- No schema validation library.

## F. Error Handling Analysis

What exists
- Central error middleware logs stack and returns `{ message: ... }` with `statusCode || 500`.
- Admin controller wraps vector build in try/catch and returns `500` with error message.

Potential issues
- Error format differs from core API; consider standardizing if this is a long-lived service.
- Admin controller includes `error` field with the message; ensure this is safe for your environment.

## G. Architecture Notes

Folder structure
- `server.js` — HTTP server startup
- `app.js` — Express app + routes + error handler
- `routes/` — HTTP route definitions
- `controllers/` — request handlers (thin wrappers around engine services)
- `services/recommendation/` — core recommendation engine + ingestion service
- `config/` — env parsing and defaults

How services communicate
- This service is standalone; the core API can be configured to point at it via `RECOMMENDATIONS_SERVICE_URL`.

