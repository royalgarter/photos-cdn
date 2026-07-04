/**
 * Daily indexer worker — fetches curated/editorial images from free stock providers,
 * deduplicates against existing DB, vectorizes, uploads to R2, and saves to ArangoDB.
 * Chain: Pexels curated → Unsplash editorial → Pixabay editors-choice → Picjumbo RSS
 */

import { Buffer } from "node:buffer";
import { Jimp } from "jimp";
import sharp from "sharp";

// ── Types ────────────────────────────────────────────────────────────────────

export interface IndexerDeps {
  getSettings: () => Promise<any>;
  getImages: () => Promise<any[]>;
  addImage: (doc: any) => Promise<void>;
  getEmbeddingVector: (text: string) => Promise<number[]>;
  uploadToS3: (settings: any, resName: string, key: string, buffer: Buffer, mime: string) => Promise<string | null>;
  compressImage: (buffer: Buffer, mime: string) => Promise<Buffer>;
  convertBuffer: (buffer: Buffer, fmt: string) => Promise<Buffer>;
  addLog: (type: string, msg: string) => void;
  RESOLUTIONS: Record<string, { w: number; h: number }>;
}

export interface IndexerStatus {
  running: boolean;
  lastRun: string | null;
  lastResult: IndexerResult | null;
  nextRun: string | null;
}

export interface IndexerResult {
  duration: number;
  indexed: number;
  skipped: number;
  errors: number;
  byProvider: Record<string, { indexed: number; skipped: number; errors: number }>;
}

// ── Curated feed fetchers ─────────────────────────────────────────────────────

interface RawPhoto {
  sourceUrl: string;
  pageUrl: string;
  alt: string;
  category: string;
  provider: string;
  width: number;
  height: number;
}

async function fetchPexelsCurated(apiKey: string, perPage = 40): Promise<RawPhoto[]> {
  const res = await fetch(
    `https://api.pexels.com/v1/curated?per_page=${perPage}`,
    { headers: { Authorization: apiKey }, signal: AbortSignal.timeout(10000) }
  );
  if (!res.ok) return [];
  const json = await res.json() as any;
  return (json.photos || []).map((p: any) => ({
    sourceUrl: p.src?.large || p.src?.medium || p.src?.original,
    pageUrl: p.url,
    alt: p.alt || `${p.photographer} pexels photo`,
    category: "nature",
    provider: "Pexels",
    width: p.width,
    height: p.height,
  })).filter((p: RawPhoto) => p.sourceUrl);
}

async function fetchUnsplashEditorial(accessKey: string, perPage = 30): Promise<RawPhoto[]> {
  const res = await fetch(
    `https://api.unsplash.com/photos?order_by=editorial&per_page=${perPage}`,
    {
      headers: { Authorization: `Client-ID ${accessKey}`, "Accept-Version": "v1" },
      signal: AbortSignal.timeout(10000)
    }
  );
  if (!res.ok) return [];
  const json = await res.json() as any;
  return (Array.isArray(json) ? json : []).map((p: any) => ({
    sourceUrl: p.urls?.regular || p.urls?.full,
    pageUrl: p.links?.html || "",
    alt: p.alt_description || p.description || `${p.user?.name} unsplash photo`,
    category: p.topic_submissions ? Object.keys(p.topic_submissions)[0] || "nature" : "nature",
    provider: "Unsplash",
    width: p.width,
    height: p.height,
  })).filter((p: RawPhoto) => p.sourceUrl);
}

async function fetchPixabayEditors(apiKey: string, perPage = 40): Promise<RawPhoto[]> {
  if (!apiKey) return [];
  const res = await fetch(
    `https://pixabay.com/api/?key=${apiKey}&editors_choice=true&per_page=${perPage}&image_type=photo&safesearch=true`,
    { signal: AbortSignal.timeout(10000) }
  );
  if (!res.ok) return [];
  const json = await res.json() as any;
  return (json.hits || []).map((p: any) => ({
    sourceUrl: p.largeImageURL || p.webformatURL,
    pageUrl: p.pageURL,
    alt: p.tags || "pixabay photo",
    category: (p.tags || "nature").split(",")[0].trim(),
    provider: "Pixabay",
    width: p.imageWidth,
    height: p.imageHeight,
  })).filter((p: RawPhoto) => p.sourceUrl);
}

async function fetchPicjumboRSS(): Promise<RawPhoto[]> {
  // Picjumbo free RSS feed — parse enclosure URLs
  const res = await fetch("https://picjumbo.com/feed/", { signal: AbortSignal.timeout(10000) });
  if (!res.ok) return [];
  const xml = await res.text();
  const items: RawPhoto[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRegex.exec(xml)) !== null) {
    const body = m[1];
    const urlMatch = body.match(/<enclosure[^>]+url="([^"]+)"/);
    const titleMatch = body.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/);
    if (!urlMatch) continue;
    items.push({
      sourceUrl: urlMatch[1],
      pageUrl: (body.match(/<link>([^<]+)<\/link>/) || [])[1] || "",
      alt: titleMatch ? titleMatch[1].trim() : "picjumbo photo",
      category: "nature",
      provider: "Picjumbo",
      width: 0,
      height: 0,
    });
  }
  return items.slice(0, 20);
}

// ── Category inference from alt text ─────────────────────────────────────────

const CAT_KEYWORDS: [string, string[]][] = [
  ["technology",   ["tech", "computer", "phone", "digital", "code", "device", "robot", "ai"]],
  ["office",       ["office", "desk", "work", "business", "meeting", "corporate"]],
  ["food",         ["food", "meal", "eat", "restaurant", "cook", "dish", "fruit", "vegetable"]],
  ["travel",       ["travel", "trip", "tourism", "vacation", "destination", "adventure"]],
  ["people",       ["person", "people", "man", "woman", "child", "portrait", "face", "crowd"]],
  ["cityscape",    ["city", "urban", "street", "building", "skyline", "architecture"]],
  ["nature",       ["nature", "forest", "mountain", "lake", "water", "tree", "flower", "sky"]],
  ["animals",      ["animal", "bird", "dog", "cat", "wildlife", "fish", "horse"]],
  ["abstract",     ["abstract", "art", "pattern", "color", "texture", "design"]],
  ["wellness",     ["yoga", "fitness", "meditation", "spa", "health", "relax"]],
];

function inferCategory(alt: string, providerCategory: string): string {
  const lower = alt.toLowerCase();
  for (const [cat, words] of CAT_KEYWORDS) {
    if (words.some(w => lower.includes(w))) return cat;
  }
  return providerCategory || "nature";
}

// ── Core indexing logic ───────────────────────────────────────────────────────

const PHOTO_TIMEOUT_MS = 20_000;

async function indexPhoto(
  photo: RawPhoto,
  deps: IndexerDeps,
  settings: any,
  existingUrls: Set<string>
): Promise<"indexed" | "skipped" | "error"> {
  if (existingUrls.has(photo.sourceUrl)) return "skipped";

  const timeout = new Promise<"error">((resolve) => setTimeout(() => resolve("error"), PHOTO_TIMEOUT_MS));

  return Promise.race([_indexPhotoCore(photo, deps, settings, existingUrls), timeout]);
}

async function _indexPhotoCore(
  photo: RawPhoto,
  deps: IndexerDeps,
  settings: any,
  existingUrls: Set<string>
): Promise<"indexed" | "skipped" | "error"> {
  try {
    const imgRes = await fetch(photo.sourceUrl, { signal: AbortSignal.timeout(12000) });
    if (!imgRes.ok) return "error";

    const raw = Buffer.from(await imgRes.arrayBuffer());
    const category = inferCategory(photo.alt, photo.category);
    const text = `${photo.alt} ${category} ${photo.provider}`.toLowerCase();
    const embedding = await deps.getEmbeddingVector(text);

    const jimpImg = await Jimp.read(raw);
    const key = `idx-${photo.provider.toLowerCase()}-${Math.random().toString(36).substring(2, 9)}`;
    const variants: Record<string, string> = {};

    for (const [resName, dim] of Object.entries(deps.RESOLUTIONS)) {
      const cloned = jimpImg.clone().cover({ w: dim.w, h: dim.h });
      const rawBuf = await cloned.getBuffer("image/jpeg", { quality: 85 });
      const jpgBuffer = await deps.compressImage(rawBuf, "image/jpeg");
      const [webpBuffer, pngBuffer] = await Promise.all([
        deps.convertBuffer(jpgBuffer, "webp"),
        deps.convertBuffer(jpgBuffer, "png"),
      ]);
      const [jpgUrl, webpUrl, pngUrl] = await Promise.all([
        deps.uploadToS3(settings, resName, key, jpgBuffer, "image/jpeg"),
        deps.uploadToS3(settings, `${resName}_webp`, key, webpBuffer, "image/webp"),
        deps.uploadToS3(settings, `${resName}_png`, key, pngBuffer, "image/png"),
      ]);
      if (jpgUrl) {
        variants[resName] = jpgUrl;
        if (webpUrl) variants[`${resName}_webp`] = webpUrl;
        if (pngUrl) variants[`${resName}_png`] = pngUrl;
      }
    }

    await deps.addImage({
      _key: key,
      sourceUrl: photo.sourceUrl,
      category,
      text,
      embedding,
      seed: Math.floor(Math.random() * 10000),
      variants,
      provider: photo.provider,
      indexedAt: new Date().toISOString(),
    });

    existingUrls.add(photo.sourceUrl);
    deps.addLog("system", `[Indexer] Saved ${key} from ${photo.provider}: "${photo.alt.slice(0, 60)}"`);
    return "indexed";
  } catch (err) {
    deps.addLog("system", `[Indexer] Error indexing ${photo.sourceUrl}: ${(err as Error).message}`);
    return "error";
  }
}

// ── Main run function ─────────────────────────────────────────────────────────

const RUN_TIMEOUT_MS = 4 * 60 * 1000; // 4-minute hard cap

export async function runDailyIndexer(deps: IndexerDeps): Promise<IndexerResult> {
  const start = Date.now();
  const deadline = start + RUN_TIMEOUT_MS;
  deps.addLog("system", "[Indexer] Daily scan started");

  const settings = await deps.getSettings();
  const existing = await deps.getImages();
  const existingUrls = new Set<string>(existing.map((img: any) => img.sourceUrl));

  deps.addLog("system", `[Indexer] ${existingUrls.size} existing images in DB — fetching curated feeds...`);

  // Fetch all provider feeds in parallel
  const [pexelsPhotos, unsplashPhotos, pixabayPhotos, picjumboPhotos] = await Promise.allSettled([
    fetchPexelsCurated(settings.pexelsApiKey || process.env.PEXELS_API_KEY || ""),
    fetchUnsplashEditorial(settings.unsplashAccessKey || process.env.UNSPLASH_ACCESS_KEY || ""),
    fetchPixabayEditors(settings.pixabayApiKey || process.env.PIXABAY_API_KEY || ""),
    fetchPicjumboRSS(),
  ]);

  const allPhotos: RawPhoto[] = [
    ...(pexelsPhotos.status === "fulfilled" ? pexelsPhotos.value : []),
    ...(unsplashPhotos.status === "fulfilled" ? unsplashPhotos.value : []),
    ...(pixabayPhotos.status === "fulfilled" ? pixabayPhotos.value : []),
    ...(picjumboPhotos.status === "fulfilled" ? picjumboPhotos.value : []),
  ];

  deps.addLog("system", `[Indexer] Fetched ${allPhotos.length} total photos from all providers`);

  const byProvider: Record<string, { indexed: number; skipped: number; errors: number }> = {};
  let totalIndexed = 0, totalSkipped = 0, totalErrors = 0;

  // Process with concurrency limit (4 at a time to avoid hammering S3/APIs)
  const CONCURRENCY = 4;
  for (let i = 0; i < allPhotos.length; i += CONCURRENCY) {
    if (Date.now() >= deadline) {
      deps.addLog("system", `[Indexer] 4-minute deadline reached — stopping at batch ${i}/${allPhotos.length}`);
      break;
    }
    const batch = allPhotos.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(photo => indexPhoto(photo, deps, settings, existingUrls))
    );
    for (let j = 0; j < batch.length; j++) {
      const p = batch[j].provider;
      if (!byProvider[p]) byProvider[p] = { indexed: 0, skipped: 0, errors: 0 };
      const r = results[j];
      byProvider[p][r]++;
      if (r === "indexed") totalIndexed++;
      else if (r === "skipped") totalSkipped++;
      else totalErrors++;
    }
  }

  const duration = Date.now() - start;
  const result: IndexerResult = { duration, indexed: totalIndexed, skipped: totalSkipped, errors: totalErrors, byProvider };
  deps.addLog("system", `[Indexer] Done in ${(duration / 1000).toFixed(1)}s — indexed: ${totalIndexed}, skipped: ${totalSkipped}, errors: ${totalErrors}`);
  return result;
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function startDailyIndexer(deps: IndexerDeps): IndexerStatus {
  const status: IndexerStatus = {
    running: false,
    lastRun: null,
    lastResult: null,
    nextRun: new Date(Date.now() + INTERVAL_MS).toISOString(),
  };

  const run = async () => {
    if (status.running) return;
    status.running = true;
    status.lastRun = new Date().toISOString();
    try {
      status.lastResult = await runDailyIndexer(deps);
    } catch (err) {
      deps.addLog("system", `[Indexer] Fatal error: ${(err as Error).message}`);
    } finally {
      status.running = false;
      status.nextRun = new Date(Date.now() + INTERVAL_MS).toISOString();
    }
  };

  // Run once at startup (after 30s delay to let server warm up), then every 24h
  setTimeout(run, 30_000);
  setInterval(run, INTERVAL_MS);

  return status;
}
