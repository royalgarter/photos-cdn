# Photos CDN

AI-powered image CDN with semantic vector search. Serves images by dimensions, category, or natural-language text query. Generates new images on-demand when no close match exists in the database.

## How It Works

```
GET /api/cdn/:width/:height?text=...&category=...&seed=...&format=...&output=...
```

**4-phase pipeline:**

1. **Intercept** — parse request params (width, height, category, seed, text, format, output)
2. **Vector Search** — embed `text` via Gemini (`gemini-embedding-2`, 128-dim) or keyword fallback → cosine similarity search across ArangoDB `Images` collection
3. **On-Demand Generation** — if best match similarity < 0.85, fetch semantically-closest base image from free sources (Unsplash, Pexels, Flickr, Picsum), pass through provider chain, resize to 12 variants via Jimp + resmush.it compression, upload to Cloudflare R2
4. **Delivery** — convert to requested output format (jpg/png/webp) via sharp, serve from ArangoDB cache or R2/S3

## Stack

| Layer | Tech |
|---|---|
| Server | Node.js + Express (`--experimental-strip-types` for TypeScript) |
| Database | ArangoDB (collections: `Images`, `Logs`, `Queue`, `Settings`) |
| Embeddings | Gemini `gemini-embedding-2` (128-dim); keyword fallback if no key |
| Image Gen | Provider chain: Gemini → Cloudflare AI → Pollinations.ai → HuggingFace |
| Image Processing | Jimp (cover-resize to 12 presets) + sharp (format conversion) |
| Compression | resmush.it API (82% quality, before S3 upload) |
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

Server listens on `http://0.0.0.0:3000`. Override with `PORT=3001 npm start`.

### 3. Configure API Keys (via UI)

Open `http://localhost:3000` → Settings tab. All credentials except `ARANGO_URL` are stored in the ArangoDB `Settings` collection:

| Setting | Purpose |
|---|---|
| `geminiApiKey` | Embeddings (`gemini-embedding-2`) + image gen (`gemini-2.5-flash-image`) |
| `cfAccountId` + `cfApiToken` | Cloudflare Workers AI (provider #2 in gen chain) |
| `hfApiToken` | HuggingFace Inference API — optional, improves rate limits (provider #4) |
| `r2AccessKeyId` / `r2SecretAccessKey` | Cloudflare R2 upload credentials |
| `r2BucketName` | R2 bucket name |
| `r2Endpoint` | R2 storage endpoint (`https://<account-id>.r2.cloudflarestorage.com`) |
| `cdnDomain` | Public CDN domain served to clients (e.g. `https://photos.newsrss.org`) |

## API Reference

### CDN Endpoint

```
GET /api/cdn/:width/:height
```

| Param | Type | Default | Description |
|---|---|---|---|
| `width` | path | 800 | Target width in pixels |
| `height` | path | 600 | Target height in pixels |
| `text` | query | — | Natural language description for semantic search + generation |
| `category` | query | `nature` | Category filter when no `text` provided |
| `seed` | query | `42` | Numeric seed for deterministic category-based selection |
| `format` | query | `image` | Response format: `image` \| `blurhash` \| `lqip` |
| `output` | query | `jpg` | Image encoding: `jpg` \| `png` \| `webp` |

**`format` behaviour:**

| Value | Response |
|---|---|
| `image` | Image bytes or 302 redirect to closest resolution variant |
| `blurhash` | `application/json` → `{ blurhash, sourceUrl, similarity, metadata }` |
| `lqip` | 150×150 thumbnail bytes (low-quality image placeholder) |

**`output` behaviour:**

| Value | Mechanism | Notes |
|---|---|---|
| `jpg` | 302 redirect to S3/CDN URL | Zero server-side conversion overhead |
| `png` | Fetch S3 asset → sharp convert → stream bytes | Lossless, larger files |
| `webp` | Fetch S3 asset → sharp convert → stream bytes | Best compression, ~25% smaller than jpg |

**Response headers:**

| Header | Description |
|---|---|
| `X-Similarity-Score` | Cosine similarity of matched image (0–1) |
| `X-Async-Generated` | `true` if a new image was generated for this request |
| `Cache-Control` | `public, max-age=31536000` (1 year) |

**Prefer: respond-async (RFC 7240):**

Add `Prefer: respond-async` header to receive a non-blocking `202 Accepted` response instead of waiting for generation. Poll the `Location` header URL until `303` redirect (ready) or `202` (still pending).

```
Client                          Server
  │── GET /api/cdn/800/600 ───► │  similarity < 0.85, generation needed
  │   Prefer: respond-async     │
  │◄── 202 Accepted ───────────  │  generation started in background
  │    Location: /status/job123  │
  │    Retry-After: 5            │
  │                              │
  │── GET /status/job123 ──────► │  still generating
  │◄── 202 pending ─────────────  │  Retry-After: 3
  │                              │
  │── GET /status/job123 ──────► │  done
  │◄── 303 → /api/cdn/800/600 ─  │  redirect to final image
```

**Examples:**

```bash
# Semantic search, WebP output
GET /api/cdn/1920/1080?text=sunset+over+ocean&output=webp

# Category + seed, PNG
GET /api/cdn/400/400?category=animals&seed=7&output=png

# Blurhash placeholder
GET /api/cdn/800/600?text=mountain+lake&format=blurhash

# LQIP for progressive loading
GET /api/cdn/800/600?text=cyberpunk+city&format=lqip

# Non-blocking async generation
GET /api/cdn/800/600?text=aurora+borealis
Prefer: respond-async
→ 202 + Location: /api/cdn/800/600/status/cdn-abc123

# Poll for result
GET /api/cdn/800/600/status/cdn-abc123?text=aurora+borealis
→ 202 (pending) or 303 → final image URL
```

### srcset Endpoint

Returns a complete `srcset` payload ready for native browser lazy loading across all 10 breakpoints.

```
GET /api/cdn/srcset
```

| Param | Type | Default | Description |
|---|---|---|---|
| `text` | query | — | Natural language description |
| `category` | query | `nature` | Category filter when no `text` |
| `seed` | query | `42` | Deterministic seed |
| `output` | query | `jpg` | `jpg` \| `png` \| `webp` |

**Request headers:**

| Header | Effect |
|---|---|
| `Prefer: respond-async` | Returns `202` immediately with `Location` poll URL + fallback payload |

**Response (200):**

```json
{
  "key": "gen-abc123",
  "src": "https://photos.newsrss.org/medium/gen-abc123.jpg",
  "srcset": "https://photos.newsrss.org/thumbnail/gen-abc123.jpg 150w, ..., https://photos.newsrss.org/desktop_4k/gen-abc123.jpg 3840w",
  "sizes": "(max-width: 360px) 360px, (max-width: 768px) 768px, ..., 3840px",
  "width": 1920,
  "height": 1080,
  "alt": "misty mountain at dawn",
  "format": "webp",
  "similarity": 0.9998,
  "isFallback": false,
  "blurhash": "L6PZfHeD.AyD_N%g9GMy?v%0IAxG",
  "metadata": { "category": "nature", "seed": 42, "prompt": "..." }
}
```

**Response (202 — Prefer: respond-async):**

```json
{
  "status": "accepted",
  "jobId": "srcset-xyz789",
  "message": "Image generation started. Poll Location header for readiness.",
  "fallback": { ...same shape as 200 but isFallback: true }
}
```

**Poll endpoint:**

```
GET /api/cdn/srcset/status/:jobId?text=...&output=...
```
Returns `200` with full payload when ready, `202` with `Retry-After: 3` while pending.

**Integration example:**

```js
// Instant (stale-while-revalidate, never blocks)
const { src, srcset, sizes, alt } = await fetch(
  '/api/cdn/srcset?text=sunset+beach&output=webp'
).then(r => r.json());

img.src = src;
img.srcset = srcset;
img.sizes = sizes;
img.loading = 'lazy';

// Non-blocking async with auto-upgrade
const res = await fetch('/api/cdn/srcset?text=sunset+beach', {
  headers: { 'Prefer': 'respond-async' }
});
if (res.status === 202) {
  const { fallback } = await res.json();
  img.src = fallback.src;                  // show fallback immediately
  const pollUrl = res.headers.get('Location');
  const poll = setInterval(async () => {
    const r = await fetch(pollUrl);
    if (r.status === 200) {
      const data = await r.json();
      img.srcset = data.srcset;            // upgrade to real image
      img.src = data.src;
      clearInterval(poll);
    }
  }, 3000);
}
```

### Other Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/cdn/:w/:h` | Main CDN image endpoint |
| GET | `/api/cdn/:w/:h/status/:jobId` | Poll async generation job |
| GET | `/api/cdn/srcset` | srcset payload for lazy loading |
| GET | `/api/cdn/srcset/status/:jobId` | Poll async srcset job |
| GET | `/api/images` | All images in database |
| GET | `/api/queue` | Last 50 queue jobs |
| GET | `/api/logs` | Last 100 system logs |
| GET | `/api/settings` | Current settings |
| POST | `/api/settings` | Update settings |
| POST | `/api/reset` | Clear and reseed database |

## Image Generation Provider Chain

When similarity < 0.85, generation is attempted in order until one succeeds:

| Priority | Provider | Key required | Model |
|---|---|---|---|
| 1 | Gemini | `geminiApiKey` | `gemini-2.5-flash-image` |
| 2 | Cloudflare Workers AI | `cfAccountId` + `cfApiToken` | `sdxl-lightning` → `sdxl-base-1.0` |
| 3 | Pollinations.ai | none (free) | FLUX |
| 4 | HuggingFace | `hfApiToken` (optional) | `FLUX.1-schnell` → `sdxl-base-1.0` |
| — | Replicate / Stability / OpenAI | — | *(placeholders)* |
| last | Semantic best-fit source image | — | Always available |

## Image Variants

Every generated image is cover-resized to 12 presets and compressed via resmush.it before upload:

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

The closest preset to the requested `width`×`height` is selected. Variants are stored as base64 in ArangoDB or as S3 URLs when R2 is configured.

## Semantic Vector Search

Each image document stores a 128-dimensional embedding:

1. Query text embedded via Gemini `gemini-embedding-2` (128-dim, unit-normalized)
2. Falls back to keyword vectorizer if Gemini unavailable — maps 10 semantic dimensions (nature, water, sky, darkness, urban, warmth, coldness, futuristic, animals, minimalism) + 118 deterministic hash dims
3. Cosine similarity computed against all stored embeddings
4. Best match ≥ 0.85 → served with `Cache-Control: public, max-age=31536000`
5. Best match < 0.85 → on-demand generation triggered synchronously

## Environment Variables

Only one env var is required at the OS level:

```bash
ARANGO_URL=https://user:pass@host:port/dbname   # required
GEMINI_API_KEY=...                               # optional bootstrap (overridden by Settings collection)
HF_API_TOKEN=...                                 # optional bootstrap for HuggingFace
PORT=3000                                        # optional, default 3000
```
