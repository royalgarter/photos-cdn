# Performance TODO

## Speed Improvements

- [x] 1. In-memory LRU image cache (TTL 5s) — eliminate per-request `FOR img IN Images RETURN img`
- [x] 2. Embedding cache — skip Gemini round-trip for repeated text queries (LRU 500 entries, TTL 1h)
- [x] 3. ArangoDB vector index — `APPROX_NEAR_COSINE` index on `Images.embedding` (128-dim cosine), JS scan fallback
- [x] 4. Pre-generate webp/png variants at upload time — zero fetch+convert on delivery, direct 302 to S3
- [x] 5. Drop resmush.it from hot path — sharp inline compression (`mozjpeg`, quality 82), resmush as async post-process
- [x] 6. Stale-while-revalidate — return best match immediately (`max-age=60, stale-while-revalidate=86400`), generate in background
- [x] 7. Cloudflare edge cache headers — `Vary: Accept`, `ETag`, `X-Image-Key` for CDN-aware caching
