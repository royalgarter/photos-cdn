/**
 * Daily indexer — two-phase design to stay within 512MB RAM:
 *
 * Phase 1 (crawlFeeds): fetch metadata from all providers, save as PendingPhotos.
 *   No image downloading or processing. Runs every 4h.
 *
 * Phase 2 (processOnePending): pick 1 pending photo, download + resize + upload + save to Images.
 *   Runs every 1 minute. Processes exactly one photo then exits, keeping peak RAM minimal.
 */

import { Buffer } from "node:buffer";
import sharp from "sharp";
import { matchGenre } from "../providers/static-photos.ts";
import { fetchOpenversePhotos } from "../providers/openverse.ts";
import { fetchBingDaily, fetchWikimediaFeatured, fetchFlickrPublic, fetchShopifyBurst, fetchFreestocks, fetchLifeOfPix, fetchImgSearch, fetchPxHere } from "../providers/free-providers.ts";
import type { PendingPhoto } from "../server.ts";

// ── Types ────────────────────────────────────────────────────────────────────

export interface IndexerDeps {
	getSettings: () => Promise<any>;
	getImages: () => Promise<any[]>;
	addImage: (doc: any) => Promise<void>;
	addPendingPhoto: (photo: Omit<PendingPhoto, "_key" | "createdAt">) => Promise<void>;
	getPendingPhotoUrls: () => Promise<Set<string>>;
	popOnePendingPhoto: () => Promise<PendingPhoto | null>;
	countPendingPhotos: () => Promise<number>;
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

// ── Provider feed fetchers ────────────────────────────────────────────────────

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

// ── Phase 1: Crawl feeds, enqueue pending ────────────────────────────────────

export async function crawlFeeds(deps: IndexerDeps): Promise<{ queued: number; skipped: number }> {
	const settings = await deps.getSettings();

	const existing = await deps.getImages();
	const existingUrls = new Set<string>(existing.map((img: any) => img.sourceUrl));
	const pendingUrls = await deps.getPendingPhotoUrls();
	const knownUrls = new Set([...existingUrls, ...pendingUrls]);

	const ovClientId = settings.openverseClientId || process.env.OPENVERSE_CLIENT_ID || "";
	const ovClientSecret = settings.openverseClientSecret || process.env.OPENVERSE_CLIENT_SECRET || "";
	const indexerQueries = ["nature landscape", "street photography", "portrait", "architecture", "wildlife"];

	const [
		pexelsPhotos, unsplashPhotos, pixabayPhotos, picjumboPhotos,
		bingPhotos, wikimediaPhotos, flickrPhotos,
		shopifyPhotos, freestocksPhotos,
		...rest
	] = await Promise.allSettled([
		fetchPexelsCurated(settings.pexelsApiKey || process.env.PEXELS_API_KEY || ""),
		fetchUnsplashEditorial(settings.unsplashAccessKey || process.env.UNSPLASH_ACCESS_KEY || ""),
		fetchPixabayEditors(settings.pixabayApiKey || process.env.PIXABAY_API_KEY || ""),
		fetchPicjumboRSS(),
		fetchBingDaily(16).then(photos => photos.map(p => ({ ...p, provider: "Bing" } as RawPhoto))),
		fetchWikimediaFeatured("Quality_images_of_landscapes", 20).then(photos => photos.map(p => ({ ...p, provider: "Wikimedia" } as RawPhoto))),
		fetchFlickrPublic("landscape nature", 20).then(photos => photos.map(p => ({ ...p, provider: "Flickr" } as RawPhoto))),
		fetchShopifyBurst("nature").then(photos => photos.map(p => ({ ...p, provider: "ShopifyBurst" } as RawPhoto))),
		fetchFreestocks(1).then(photos => photos.map(p => ({ ...p, provider: "Freestocks" } as RawPhoto))),
		// LifeOfPix, ImgSearch, PxHere — one query per genre sample
		...indexerQueries.flatMap(q => [
			fetchLifeOfPix(q, 5).then(photos => photos.map(p => ({ ...p, provider: "LifeOfPix" } as RawPhoto))),
			fetchImgSearch(q, 10).then(photos => photos.map(p => ({ ...p, provider: "ImgSearch" } as RawPhoto))),
			fetchPxHere(q, 1).then(photos => photos.map(p => ({ ...p, provider: "PxHere" } as RawPhoto))),
		]),
		...(ovClientId ? indexerQueries.map(q =>
			fetchOpenversePhotos(ovClientId, ovClientSecret, q, 10).then(photos =>
				photos.map(p => ({ ...p, provider: "Openverse" } as RawPhoto))
			)
		) : []),
	]);

	const allPhotos: RawPhoto[] = [
		...(pexelsPhotos.status === "fulfilled" ? pexelsPhotos.value : []),
		...(unsplashPhotos.status === "fulfilled" ? unsplashPhotos.value : []),
		...(pixabayPhotos.status === "fulfilled" ? pixabayPhotos.value : []),
		...(picjumboPhotos.status === "fulfilled" ? picjumboPhotos.value : []),
		...(bingPhotos.status === "fulfilled" ? bingPhotos.value : []),
		...(wikimediaPhotos.status === "fulfilled" ? wikimediaPhotos.value : []),
		...(flickrPhotos.status === "fulfilled" ? flickrPhotos.value : []),
		...(shopifyPhotos.status === "fulfilled" ? shopifyPhotos.value : []),
		...(freestocksPhotos.status === "fulfilled" ? freestocksPhotos.value : []),
		...rest.flatMap(r => r.status === "fulfilled" ? r.value : []),
	];

	let queued = 0, skipped = 0;
	for (const photo of allPhotos) {
		if (knownUrls.has(photo.sourceUrl)) { skipped++; continue; }
		await deps.addPendingPhoto(photo);
		knownUrls.add(photo.sourceUrl);
		queued++;
	}

	deps.addLog("system", `[Crawler] Fetched ${allPhotos.length} photos — queued: ${queued}, skipped: ${skipped}`);
	return { queued, skipped };
}

// ── Phase 2: Process exactly one pending photo ────────────────────────────────

const PHOTO_TIMEOUT_MS = 60_000;

export async function processOnePending(deps: IndexerDeps): Promise<"processed" | "skipped" | "empty" | "error"> {
	const photo = await deps.popOnePendingPhoto();
	if (!photo) return "empty";

	const settings = await deps.getSettings();

	const timeout = new Promise<"error">((resolve) => setTimeout(() => resolve("error"), PHOTO_TIMEOUT_MS));
	const work = _processPhoto(photo, deps, settings);
	return Promise.race([work, timeout]);
}

async function _processPhoto(
	photo: PendingPhoto,
	deps: IndexerDeps,
	settings: any,
): Promise<"processed" | "error"> {
	try {
		const imgRes = await fetch(photo.sourceUrl, { signal: AbortSignal.timeout(12000) });
		if (!imgRes.ok) return "error";

		const raw = Buffer.from(await imgRes.arrayBuffer());
		const { genre, staticSlug: category } = matchGenre(`${photo.alt} ${photo.category}`);
		const text = `${photo.alt} ${category} ${photo.provider}`.toLowerCase();
		const embedding = await deps.getEmbeddingVector(text);

		const key = `idx-${photo.provider.toLowerCase()}-${Math.random().toString(36).substring(2, 9)}`;
		const variants: Record<string, string> = {};

		for (const [resName, dim] of Object.entries(deps.RESOLUTIONS)) {
			const rawBuf = await sharp(raw)
				.resize(dim.w, dim.h, { fit: "cover" })
				.jpeg({ quality: 85 })
				.toBuffer();
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
			genre,
			text,
			embedding,
			seed: Math.floor(Math.random() * 10000),
			variants,
			provider: photo.provider,
			indexedAt: new Date().toISOString(),
		});

		const cdnUrl = variants["800x600"] || variants["1200x630"] || Object.values(variants)[0] || "";
		deps.addLog("system", `[Processor] Saved ${key} from ${photo.provider}: "${photo.alt.slice(0, 60)}" → ${cdnUrl}`);
		return "processed";
	} catch (err) {
		deps.addLog("system", `[Processor] Error processing ${photo.sourceUrl}: ${(err as Error).message}`);
		return "error";
	}
}

// ── Legacy runDailyIndexer (kept for /api/indexer/trigger compat) ─────────────

export async function runDailyIndexer(deps: IndexerDeps): Promise<IndexerResult> {
	const start = Date.now();
	deps.addLog("system", "[Indexer] crawlFeeds started");
	await crawlFeeds(deps);
	deps.addLog("system", "[Indexer] crawlFeeds done — photos queued for per-minute processor");
	return {
		duration: Date.now() - start,
		indexed: 0,
		skipped: 0,
		errors: 0,
		byProvider: {},
	};
}

export function startDailyIndexer(deps: IndexerDeps): IndexerStatus {
	return {
		running: false,
		lastRun: null,
		lastResult: null,
		nextRun: null,
	};
}
