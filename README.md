# Photos CDN

AI-powered image CDN with semantic vector search. Serves images by dimensions, category, or natural-language text query. Generates new images on-demand when no close match exists in the database.

## How It Works

```
GET /api/cdn/:width/:height?text=...&category=...&seed=...&format=...
```

**4-phase pipeline:**

1. **Intercept** — parse request params (width, height, category, seed, text, format)
2. **Vector Search** — embed `text` via Gemini (`gemini-embedding-2`, 128-dim) or keyword fallback → cosine similarity search across ArangoDB `Images` collection
3. **On-Demand Generation** — if best match similarity < 0.85, fetch a semantically-closest base image from free sources (Unsplash, Pexels, Flickr, Picsum), re-imagine it with `gemini-2.5-flash-image`, resize to 12 variants via Jimp, upload to Cloudflare R2
4. **Delivery** — serve from ArangoDB base64 cache, redirect to R2/S3 URL, or redirect to source CDN with resize params

## Stack

| Layer | Tech |
|---|---|
| Server | Node.js + Express (`--experimental-strip-types` for TypeScript) |
| Database | ArangoDB (collections: `Images`, `Logs`, `Queue`, `Settings`) |
| Embeddings | Gemini `gemini-embedding-2` (128-dim); keyword fallback if no key |
| Image Gen | Gemini `gemini-2.5-flash-image` |
| Image Processing | Jimp (cover-resize to 12 resolutions) |
| Object Storage | Cloudflare R2 (S3-compatible via `@aws-sdk/client-s3`) |
| Frontend | Alpine.js + Lucide icons (served as static files) |

## Setup

### 1. ArangoDB

Required. Provide connection URL with credentials and database name:

```
ARANGO_URL=https://root:password@your-arango-host:8529/photosdb
```

On first start, the server auto-creates collections (`Images`, `Logs`, `Queue`, `Settings`) and seeds 7 sample images with 128-dimensional embeddings.

### 2. Install & Run

```bash
npm install
npm start          # or: npm run dev
```

Server listens on `http://0.0.0.0:3000`.

### 3. Configure API Keys (via UI)

Open `http://localhost:3000` → Settings tab. All credentials except `ARANGO_URL` are stored in the ArangoDB `Settings` collection:

| Setting | Purpose |
|---|---|
| `geminiApiKey` | Embeddings + image generation (optional — falls back to keyword vectors) |
| `r2AccessKeyId` / `r2SecretAccessKey` | Cloudflare R2 upload credentials |
| `r2BucketName` | R2 bucket name |
| `r2Endpoint` | R2 endpoint URL |

## API Reference

### CDN Endpoint

```
GET /api/cdn/:width/:height
```

| Param | Type | Default | Description |
|---|---|---|---|
| `width` | path | 800 | Output width in pixels |
| `height` | path | 600 | Output height in pixels |
| `text` | query | — | Natural language description for semantic search |
| `category` | query | `nature` | Fallback category filter when no `text` |
| `seed` | query | `42` | Numeric seed for deterministic category-based selection |
| `format` | query | `image` | `image` \| `blurhash` \| `lqip` |

**Response formats:**

- `image` — 302 redirect to closest resolution variant or CDN URL
- `blurhash` — JSON `{ blurhash, sourceUrl, similarity, metadata }`
- `lqip` — 150×150 thumbnail bytes or redirect to low-quality placeholder

**Response headers:**

- `X-Similarity-Score` — cosine similarity of matched image (0–1)
- `X-Async-Generated` — `true` if a new image was generated for this request

### Other Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/images` | All images in database |
| GET | `/api/queue` | Last 50 queue jobs |
| GET | `/api/logs` | Last 100 system logs |
| GET | `/api/settings` | Current settings |
| POST | `/api/settings` | Update settings |
| POST | `/api/reset` | Clear and reseed database |

## Image Variants

Every generated image is resized to 12 resolution variants:

| Name | Resolution |
|---|---|
| `desktop_4k` | 3840×2160 |
| `desktop_1440p` | 2560×1440 |
| `desktop_1080p` | 1920×1080 |
| `desktop_budget` | 1366×768 |
| `tablet_wide` | 1280×800 |
| `tablet_standard` | 768×1024 |
| `mobile_large` | 412×915 |
| `mobile_medium` | 390×844 |
| `mobile_standard` | 360×800 |
| `original` | 1024×1024 |
| `medium` | 400×400 |
| `thumbnail` | 150×150 |

Variants are stored as base64 in ArangoDB or uploaded to R2 when credentials are configured. Requests are served from the closest matching resolution.

## Semantic Vector Search

Each image document stores a 128-dimensional embedding. At query time:

1. Query text is embedded (Gemini API or keyword fallback)
2. Cosine similarity is computed against all stored embeddings
3. Best match ≥ 0.85 → served immediately with long-lived cache
4. Best match < 0.85 → on-demand generation triggered synchronously

The keyword fallback maps 10 semantic dimensions (nature, water, sky, darkness, urban, warmth, coldness, futuristic, animals, minimalism) and fills remaining 118 dimensions with deterministic hash values.

## Environment Variables

Only one env var is required at the OS level:

```bash
ARANGO_URL=https://user:pass@host:port/dbname   # required
GEMINI_API_KEY=...                               # optional bootstrap (overridden by Settings collection)
```
