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
- [x] https://imgsearch.com/ Free AI Stock Images - Download and Use Anywhere
```sh

# Step 1
GET: https://imgsearch.com/search/blonde-beautiful-woman-wearing-a-cropped-satin-top-seen-from-an-elevated-angle-soft-light-highlights-her-curves-and-elegant-posture-with-fit-body-long-leg-super-short-jean

# Step 2
curl 'https://imgsearch.com/search-data' \
  -H 'accept: application/json, text/javascript, */*; q=0.01' \
  -H 'accept-language: en-US,en;q=0.9,vi;q=0.8,it;q=0.7' \
  -H 'content-type: application/x-www-form-urlencoded; charset=UTF-8' \
  -b 'XSRF-TOKEN=eyJpdiI6IlFRVjM0YTc2bnZlM05nblN4MGcxY0E9PSIsInZhbHVlIjoiZUxYNStVMjZKMkFscXRtNStzRURpQ3ZkMVZRbzR4RVBaaU01dGo3WVg1a25zaEUwVGdVM3c0TUdKeFNqdzhqOEpzS1N5ZTdXNFMxaDZEWGVRZnBQbmVGeHB2NGtOL0wwOUdCa0NrekxveGE0ZlhtZXZaaFhESEc1aHNlVVNBUWciLCJtYWMiOiJhYTQwNDc4NGQ3NmQwZTMxOWFkNDY0YTBlMTMzYjA4YTUwOTY4OWMyYWJmMWFmOTcwYTlkNDQ3NmM0ZjVjMTRiIiwidGFnIjoiIn0%3D; imgsearch_session=eyJpdiI6IjBJZmJ4bWFlcXNsUWlIMjBOZ0NEbGc9PSIsInZhbHVlIjoidm9yTmVHTG5JWWQyM3J2NDcyYmhtL3hYK0NmRFl0SEF1UEtTTUozbDB0UUVMK0pzVWp6V0l1QU5BViswYkpETXB1R3VaMExrSnBaWFExejZXR3lUb04vWnlZdG9WVTFRbGhlTnVtdFFWZmlhTVJHNW9qK3gxbUF5K2orRWZ0UWYiLCJtYWMiOiIwNjkwZjMyMjk1N2VkNGU3ZDdiMjU0MWIxMDgxOTQzNDkyYzk3MmFiNzk1NTc0ODc4ODg3ZmYzZTgwZWM2YzhkIiwidGFnIjoiIn0%3D' \
  -H 'dnt: 1' \
  -H 'origin: https://imgsearch.com' \
  -H 'priority: u=1, i' \
  -H 'referer: https://imgsearch.com/search/blonde-beautiful-woman-wearing-a-cropped-satin-top-seen-from-an-elevated-angle-soft-light-highlights-her-curves-and-elegant-posture-with-fit-body-long-leg-super-short-jean' \
  -H 'sec-ch-ua: "Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"' \
  -H 'sec-ch-ua-mobile: ?0' \
  -H 'sec-ch-ua-platform: "Windows"' \
  -H 'sec-fetch-dest: empty' \
  -H 'sec-fetch-mode: cors' \
  -H 'sec-fetch-site: same-origin' \
  -H 'user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36' \
  -H 'x-csrf-token: fNVjR0AR9EugEBQ7po7msVeD8Id3WuXGuPDLlWbA' \
  -H 'x-requested-with: XMLHttpRequest' \
  --data-raw 'perPage=90&page=1&searchQuery=blonde+beautiful+woman+wearing+a+cropped+satin+top+seen+from+an+elevated+angle+soft+light+highlights+her+curves+and+elegant+posture+with+fit+body+long+leg+super+short+jean'
```
- [x] https://commons.wikimedia.org/wiki/Main_Page — no auth, CC-licensed, 1200px+ quality images
- [x] https://www.bing.com/HPImageArchive.aspx — no auth, 16 daily editorial photos 1920x1080
- [x] https://www.flickr.com/services/feeds/photos_public.gne — no auth, public feed with _b suffix for 1024px
- [ ] https://www.flickr.com/services/api/ — API key for full search (register at flickr.com/services/apps/create)
- [x] https://www.shopify.com/stock-photos/free-images — Burst by Shopify, HTML scrape burst.shopifycdn.com
- [x] https://www.lifeofpix.com/ — GraphQL API at /api/, lopixsStatus:"approved" filter
- [x] https://pxhere.com/ — implemented; Cloudflare challenge blocks without valid cf_clearance (same as stocksnap/kaboompics), returns null gracefully
- [ ] https://stocksnap.io/ — Cloudflare challenge blocks server-side requests
- [ ] https://kaboompics.com/ — Cloudflare challenge blocks server-side requests
- [x] https://freestocks.org/ — HTML scrape WordPress uploads, strip -WxH suffix for full-size



## AI Generator
- https://raphael.app/
- https://perchance.org/ai-text-to-image-generator
- https://app.leonardo.ai/