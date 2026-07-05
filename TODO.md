# Performance TODO

## Speed Improvements

- [x] 1. In-memory LRU image cache (TTL 5s) — eliminate per-request `FOR img IN Images RETURN img`
- [x] 2. Embedding cache — skip Gemini round-trip for repeated text queries (LRU 500 entries, TTL 1h)
- [x] 3. ArangoDB vector index — `APPROX_NEAR_COSINE` index on `Images.embedding` (128-dim cosine), JS scan fallback
- [x] 4. Pre-generate webp/png variants at upload time — zero fetch+convert on delivery, direct 302 to S3
- [x] 5. Drop resmush.it from hot path — sharp inline compression (`mozjpeg`, quality 82), resmush as async post-process
- [x] 6. Stale-while-revalidate — return best match immediately (`max-age=60, stale-while-revalidate=86400`), generate in background
- [x] 7. Cloudflare edge cache headers — `Vary: Accept`, `ETag`, `X-Image-Key` for CDN-aware caching

## Providers
- [x] https://www.bing.com/HPImageArchive.aspx — no auth, 16 daily editorial photos 1920x1080
- [x] https://commons.wikimedia.org/wiki/Main_Page — no auth, CC-licensed, 1200px+ quality images
- [x] https://www.flickr.com/services/feeds/photos_public.gne — no auth, public feed with _b suffix for 1024px
- [ ] https://www.flickr.com/services/api/ — API key for full search (register at flickr.com/services/apps/create)
- [x] https://www.shopify.com/stock-photos/free-images — Burst by Shopify, HTML scrape burst.shopifycdn.com
- [x] https://www.lifeofpix.com/ — GraphQL API at /api/, lopixsStatus:"approved" filter
- [ ] https://stocksnap.io/ — Cloudflare challenge blocks server-side requests
- [ ] https://kaboompics.com/ — Cloudflare challenge blocks server-side requests
- [x] https://freestocks.org/ — HTML scrape WordPress uploads, strip -WxH suffix for full-size


## AI Generator
- https://raphael.app/
- https://perchance.org/ai-text-to-image-generator
- https://app.leonardo.ai/