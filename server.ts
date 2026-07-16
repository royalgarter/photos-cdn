import express from "express";
import { createHash } from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import { Database } from "arangojs";
import sharp from "sharp";

// Limit sharp/libvips worker threads and cache to reduce native memory footprint
sharp.concurrency(1);
sharp.cache({ memory: 50, files: 20, items: 200 });
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { StaticPhotosProvider, matchGenre, applyGenreTemplate } from "./providers/static-photos.ts";
import { PexelsProvider } from "./providers/pexels.ts";
import { UnsplashProvider } from "./providers/unsplash.ts";
import { PicsumProvider } from "./providers/picsum.ts";
import { WallhavenProvider } from "./providers/wallhaven.ts";
import { OpenverseProvider } from "./providers/openverse.ts";
import { BingProvider, WikimediaProvider, FlickrPublicProvider, ShopifyBurstProvider, FreestocksProvider, LifeOfPixProvider, ImgSearchProvider, PxHereProvider } from "./providers/free-providers.ts";
import type { FallbackProvider } from "./providers/types.ts";
import { GENRES } from "./providers/types.ts";
import { startDailyIndexer, runDailyIndexer, type IndexerStatus } from "./workers/daily-indexer.ts";
import "./crons.ts";

const app = express();
const PORT = parseInt(process.env.PORT || "34070");

app.use(express.json());

// ==========================================
// ADMIN AUTH
// ==========================================

const ADMIN_KEY = process.env.ADMIN_KEY || "";
const ADMIN_TOKEN = ADMIN_KEY
	? createHash("sha256").update(ADMIN_KEY + "photos-cdn-admin").digest("hex")
	: "";

function parseCookies(req: express.Request): Record<string, string> {
	const list: Record<string, string> = {};
	const header = req.headers.cookie;
	if (!header) return list;
	for (const part of header.split(";")) {
		const [name, ...rest] = part.split("=");
		if (name) list[name.trim()] = decodeURIComponent(rest.join("=").trim());
	}
	return list;
}

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
	if (!ADMIN_KEY) return next(); // no ADMIN_KEY set = open (dev mode)

	const cookies = parseCookies(req);
	if (cookies.admin_token === ADMIN_TOKEN || req.query.key === ADMIN_KEY) return next();
	return res.status(401).json({ error: "Unauthorized. Visit /?key=ADMIN_KEY to authenticate." });
}

// Handle ?key= on any request — set session cookie then redirect without the key param
app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
	const key = req.query.key as string | undefined;
	if (key && ADMIN_KEY && key === ADMIN_KEY) {
		res.setHeader("Set-Cookie", `admin_token=${ADMIN_TOKEN}; Path=/; HttpOnly; SameSite=Strict`);
		if (req.path.startsWith("/api/")) return next();
		const qs = new URLSearchParams();
		for (const [k, v] of Object.entries(req.query)) {
			if (k !== "key" && typeof v === "string") qs.set(k, v);
		}
		const redirect = req.path + (qs.toString() ? "?" + qs.toString() : "");
		return res.redirect(302, redirect);
	}
	next();
});

app.get("/api/auth/check", (req: express.Request, res: express.Response) => {
	if (!ADMIN_KEY) return res.json({ authenticated: true });
	const cookies = parseCookies(req);
	if (cookies.admin_token === ADMIN_TOKEN) return res.json({ authenticated: true });
	return res.status(401).json({ authenticated: false });
});

// ==========================================
// 1. SCHEMAS & INTERFACES
// ==========================================

interface ImageDocument {
	_key: string;
	sourceUrl: string;
	category: string;
	genre?: string;
	text: string;
	embedding: number[];
	seed: number;
	generatedBy?: string;
	createdAt?: string;
	variants?: {
		[key: string]: string;
	};
}

interface LogEntry {
	id: string;
	timestamp: string;
	type: "api" | "queue" | "system";
	message: string;
	details?: any;
}

interface QueueJob {
	id: string;
	prompt: string;
	category: string;
	seed: number;
	status: "pending" | "processing" | "completed" | "failed";
	progress: number;
	createdAt: string;
}

interface AppSettings {
	geminiApiKey: string;
	replicateApiToken: string;
	r2AccessKeyId: string;
	r2SecretAccessKey: string;
	r2BucketName: string;
	r2Endpoint: string;
	// Image generation provider fallback chain
	cfAccountId: string;
	cfApiToken: string;
	hfApiToken: string;
	cdnDomain: string;
	// Fallback image providers
	pexelsApiKey: string;
	unsplashAccessKey: string;
	wallhavenApiKey: string;
	pixabayApiKey: string;
	openverseClientId: string;
	openverseClientSecret: string;
	// Provider priority ranks — lower number = higher priority (0 = disabled)
	providerRanks: Record<string, number>;
	// placeholder: stabilityApiKey: string;
	// placeholder: openaiApiKey: string;
	// Transient: set by generateImageWithFallback before calling providers
	baseImg?: { buffer: Buffer; mimeType: string; provider: string } | null;
}

// ==========================================
// OUTPUT FORMAT HELPERS
// ==========================================

type OutputFormat = "jpg" | "png" | "webp";

const OUTPUT_MIME: Record<OutputFormat, string> = {
	jpg: "image/jpeg",
	png: "image/png",
	webp: "image/webp"
};

function parseOutputFormat(raw: string | undefined): OutputFormat {
	const f = (raw || "jpg").toLowerCase().replace("jpeg", "jpg");
	if (f === "png" || f === "webp" || f === "jpg") return f;
	return "jpg";
}

async function convertBuffer(input: Buffer, fmt: OutputFormat): Promise<Buffer> {
	const s = sharp(input);
	if (fmt === "webp") return s.webp({ quality: 82 }).toBuffer();
	if (fmt === "png") return s.png({ compressionLevel: 8 }).toBuffer();
	return s.jpeg({ quality: 85 }).toBuffer();
}

async function fetchAndConvert(url: string, fmt: OutputFormat): Promise<Buffer | null> {
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
		if (!res.ok) return null;
		const raw = Buffer.from(await res.arrayBuffer());
		return convertBuffer(raw, fmt);
	} catch {
		return null;
	}
}

// ArangoDB instance configuration
const arangoUrl = process.env.ARANGO_URL;
let arangoDb: Database | null = null;

// Semantic dimensions for vector simulation (10 dimensions)
const SEMANTIC_DIMENSIONS = [
	"nature",      // 0: Trees, forest, plants, mountains, lakes, outdoor scenery
	"water",       // 1: Rivers, oceans, waterfalls, waves, rain, snow, ice
	"sky",         // 2: Clouds, sun, stars, galaxy, cosmic, sunrise, sunset
	"darkness",    // 3: Night, neon, shadows, dark, black, glowing
	"urban",       // 4: City, buildings, streets, concrete, architecture, indoor
	"warmth",      // 5: Heat, desert, fire, red, orange, gold, summer
	"coldness",    // 6: Ice, snow, blue, winter, frost, glacier
	"futuristic",  // 7: Cyberpunk, tech, robots, neon, spaceships, advanced
	"animals",     // 8: Animals, birds, fish, insects, cats, dogs, wildlife
	"minimalism"   // 9: Abstract, geometric, simple, white, black, patterns
];

// Helper to add system logs dynamically
async function writeLog(type: "api" | "queue" | "system", message: string, details?: any) {
	const log: LogEntry & { timestampRaw: number } = {
		id: Math.random().toString(36).substring(2, 9),
		timestamp: new Date().toLocaleTimeString(),
		timestampRaw: Date.now(),
		type,
		message,
		details
	};

	if (arangoDb) {
		try {
			const logsColl = arangoDb.collection("Logs");
			await logsColl.save({ _key: log.id, ...log });
		} catch (e) {
			// ignore or print to stderr
		}
	}

	console.log(`[${type.toUpperCase()}] ${message}`);
}

function addLog(type: "api" | "queue" | "system", message: string, details?: any) {
	writeLog(type, message, details).catch(console.error);
}

// Ops alert webhook (Slack/Discord/ntfy-compatible: POST JSON {text}).
// Throttled so a sustained failure (e.g. gateway 401 storm) sends one alert per window.
const ALERT_WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL || "";
const ALERT_THROTTLE_MS = 15 * 60 * 1000;
const lastAlertAt = new Map<string, number>();
function sendAlert(key: string, message: string) {
	if (!ALERT_WEBHOOK_URL) return;
	const now = Date.now();
	if (now - (lastAlertAt.get(key) || 0) < ALERT_THROTTLE_MS) return;
	lastAlertAt.set(key, now);
	fetch(ALERT_WEBHOOK_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ text: `[photos-cdn] ${message}` })
	}).catch(err => console.error(`[ALERT] Webhook delivery failed: ${(err as Error).message}`));
}

// Gemini vector embedding — gemini-embedding-2, 128 dims. No fallback.
async function getEmbeddingVector(text: string): Promise<number[]> {
	const cached = getCachedEmbedding(text);
	if (cached) return cached;

	try {
		return await computeEmbeddingVector(text);
	} catch (err) {
		sendAlert("embedding-failure", `Embedding failed — semantic matching degraded to category fallback. Error: ${(err as Error).message.slice(0, 300)}`);
		throw err;
	}
}

async function computeEmbeddingVector(text: string): Promise<number[]> {
	const settings = await getSettings();
	const geminiKey = settings.geminiApiKey || process.env.GEMINI_API_KEY;
	if (!geminiKey) throw new Error("GEMINI_API_KEY not configured — required for embeddings");

	const aiConfig: any = { apiKey: geminiKey };
	if (settings.cfAccountId) {
		const headers: Record<string, string> = {};
		if (settings.cfApiToken) {
			headers["cf-aig-authorization"] = `Bearer ${settings.cfApiToken}`;
		}
		aiConfig.httpOptions = {
			baseUrl: `https://gateway.ai.cloudflare.com/v1/${settings.cfAccountId}/ohara/google-ai-studio`,
			headers
		};
	}

	const ai = new GoogleGenAI(aiConfig);
	addLog("system", `[Gemini] Embedding: "${text.slice(0, 80)}"`);
	const response = await ai.models.embedContent({
		model: "gemini-embedding-2",
		contents: { parts: [{ text }] },
		config: { outputDimensionality: 128 }
	});

	const values: number[] | undefined =
		response.embedding?.values ??
		(response as any).embeddings?.[0]?.values;

	if (!Array.isArray(values) || values.length === 0) {
		throw new Error(`Gemini returned empty embedding for: "${text.slice(0, 80)}"`);
	}

	const magnitude = Math.sqrt(values.reduce((sum: number, val: number) => sum + val * val, 0));
	const vec = values.map((val: number) => Number((val / magnitude).toFixed(4)));
	setCachedEmbedding(text, vec);
	return vec;
}

// Cosine similarity between two vectors
function cosineSimilarity(vecA: number[], vecB: number[]): number {
	if (vecA.length !== vecB.length) return 0;
	const dotProduct = vecA.reduce((sum, val, idx) => sum + val * vecB[idx], 0);
	const magA = Math.sqrt(vecA.reduce((sum, val) => sum + val * val, 0));
	const magB = Math.sqrt(vecB.reduce((sum, val) => sum + val * val, 0));
	if (magA === 0 || magB === 0) return 0;
	return Number((dotProduct / (magA * magB)).toFixed(4));
}


// ==========================================
// 2. ARANGODB ACCESSORS & SERVICES LAYER
// ==========================================

async function ensureCollection(name: string) {
	if (!arangoDb) return;
	const collections = await arangoDb.listCollections();
	const exists = collections.some(c => c.name === name);
	if (!exists) {
		addLog("system", `Creating ArangoDB collection: '${name}'`);
		await arangoDb.createCollection(name);
	}
}

async function connectToArango() {
	if (!arangoUrl) {
		throw new Error("ARANGO_URL environment variable is missing. Real ArangoDB database is required!");
	}

	try {
		const parsed = new URL(arangoUrl);
		const dbName = parsed.pathname.replace(/^\//, "") || "_system";
		const hostUrl = `${parsed.protocol}//${parsed.host}`;
		const username = parsed.username ? decodeURIComponent(parsed.username) : "root";
		const password = parsed.password ? decodeURIComponent(parsed.password) : "";

		addLog("system", `Connecting to ArangoDB at ${hostUrl} (database: ${dbName})...`);

		arangoDb = new Database({
			url: hostUrl,
			databaseName: dbName,
			auth: { username, password }
		});

		const version = await arangoDb.version();
		addLog("system", `Connected to ArangoDB successfully! Engine Version: ${version.version}`);

		// Ensure collections exist
		await ensureCollection("Settings");
		await ensureCollection("Images");
		await ensureCollection("Logs");
		await ensureCollection("Queue");
		await ensureCollection("PendingPhotos");

		// Load or seed settings document
		const settingsColl = arangoDb.collection("Settings");
		const settingsExists = await settingsColl.documentExists("config").catch(() => false);
		if (!settingsExists) {
			await settingsColl.save({
				_key: "config",
				geminiApiKey: process.env.GEMINI_API_KEY || "",
				replicateApiToken: "",
				r2AccessKeyId: "",
				r2SecretAccessKey: "",
				r2BucketName: "",
				r2Endpoint: "",
				cfAccountId: "",
				cfApiToken: "",
				hfApiToken: "",
				cdnDomain: "",
				pexelsApiKey: process.env.PEXELS_API_KEY || "",
				unsplashAccessKey: process.env.UNSPLASH_ACCESS_KEY || "",
				wallhavenApiKey: process.env.WALLHAVEN_API_KEY || "",
				pixabayApiKey: process.env.PIXABAY_API_KEY || "",
				openverseClientId: process.env.OPENVERSE_CLIENT_ID || "",
				openverseClientSecret: process.env.OPENVERSE_CLIENT_SECRET || "",
				providerRanks: DEFAULT_PROVIDER_RANKS
			});
			addLog("system", "ArangoDB 'Settings' collection initialized with default configuration structure.");
		} else {
			addLog("system", "ArangoDB 'Settings' configuration loaded successfully.");
		}

		const countResult = await arangoDb.query(`RETURN LENGTH(Images)`);
		const count = await countResult.next();
		addLog("system", `ArangoDB 'Images' collection has ${count} documents.`);

	} catch (err) {
		addLog("system", `ArangoDB Connection Failed: ${(err as Error).message}`);
		throw err;
	}
}

// Settings Accessors
async function getSettings(): Promise<AppSettings> {
	if (!arangoDb) throw new Error("ArangoDB is not initialized");
	const settingsColl = arangoDb.collection("Settings");
	const doc = await settingsColl.document("config");
	return {
		geminiApiKey: doc.geminiApiKey || "",
		replicateApiToken: doc.replicateApiToken || "",
		r2AccessKeyId: doc.r2AccessKeyId || "",
		r2SecretAccessKey: doc.r2SecretAccessKey || "",
		r2BucketName: doc.r2BucketName || "",
		r2Endpoint: doc.r2Endpoint || "",
		cfAccountId: doc.cfAccountId || "",
		cfApiToken: doc.cfApiToken || "",
		hfApiToken: doc.hfApiToken || "",
		cdnDomain: doc.cdnDomain || "",
		pexelsApiKey: doc.pexelsApiKey || "",
		unsplashAccessKey: doc.unsplashAccessKey || "",
		wallhavenApiKey: doc.wallhavenApiKey || "",
		pixabayApiKey: doc.pixabayApiKey || "",
		providerRanks: doc.providerRanks || DEFAULT_PROVIDER_RANKS
	};
}

async function updateSettings(newSettings: AppSettings): Promise<void> {
	if (!arangoDb) throw new Error("ArangoDB is not initialized");
	const settingsColl = arangoDb.collection("Settings");
	await settingsColl.update("config", newSettings);
	addLog("system", "ArangoDB 'Settings' configuration updated successfully.");
}

// ==========================================
// IN-MEMORY LRU CACHE (images + embeddings)
// ==========================================

const IMAGES_CACHE_TTL = 5000; // 5s
let imagesCacheData: ImageDocument[] | null = null;
let imagesCacheExpiry = 0;

function invalidateImagesCache() {
	imagesCacheData = null;
	imagesCacheExpiry = 0;
}

const EMBED_CACHE = new Map<string, { vec: number[]; ts: number }>();
const EMBED_CACHE_TTL = 3600_000; // 1h — embeddings are deterministic, safe to cache long
const EMBED_CACHE_MAX = 500;

function getCachedEmbedding(text: string): number[] | null {
	const entry = EMBED_CACHE.get(text);
	if (!entry) return null;
	if (Date.now() - entry.ts > EMBED_CACHE_TTL) { EMBED_CACHE.delete(text); return null; }
	return entry.vec;
}

function setCachedEmbedding(text: string, vec: number[]) {
	if (EMBED_CACHE.size >= EMBED_CACHE_MAX) {
		// evict oldest
		const oldest = [...EMBED_CACHE.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
		if (oldest) EMBED_CACHE.delete(oldest[0]);
	}
	EMBED_CACHE.set(text, { vec, ts: Date.now() });
}

// Images Accessors
async function getImages(): Promise<ImageDocument[]> {
	if (!arangoDb) throw new Error("ArangoDB is not initialized");
	if (imagesCacheData && Date.now() < imagesCacheExpiry) return imagesCacheData;
	const cursor = await arangoDb.query(`FOR img IN Images RETURN img`);
	imagesCacheData = await cursor.all();
	imagesCacheExpiry = Date.now() + IMAGES_CACHE_TTL;
	return imagesCacheData;
}

async function addImage(img: ImageDocument): Promise<void> {
	if (!arangoDb) throw new Error("ArangoDB is not initialized");
	const imagesColl = arangoDb.collection("Images");
	await imagesColl.save(img);
	invalidateImagesCache();
	addLog("system", `ArangoDB: Inserted document '${img._key}'`);
}

export interface PendingPhoto {
	_key: string;
	sourceUrl: string;
	pageUrl: string;
	alt: string;
	category: string;
	provider: string;
	width: number;
	height: number;
	createdAt: string;
}

export async function addPendingPhoto(photo: Omit<PendingPhoto, "_key" | "createdAt">): Promise<void> {
	if (!arangoDb) throw new Error("ArangoDB not initialized");
	const coll = arangoDb.collection("PendingPhotos");
	const _key = `pending-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
	await coll.save({ _key, ...photo, createdAt: new Date().toISOString() });
}

export async function getPendingPhotoUrls(): Promise<Set<string>> {
	if (!arangoDb) return new Set();
	const cursor = await arangoDb.query(`FOR p IN PendingPhotos RETURN p.sourceUrl`);
	const urls = await cursor.all() as string[];
	return new Set(urls);
}

export async function popOnePendingPhoto(): Promise<PendingPhoto | null> {
	if (!arangoDb) return null;
	const cursor = await arangoDb.query(`FOR p IN PendingPhotos SORT p.createdAt ASC LIMIT 1 RETURN p`);
	const photo = await cursor.next() as PendingPhoto | undefined;
	if (!photo) return null;
	await arangoDb.collection("PendingPhotos").remove(photo._key);
	return photo;
}

export async function countPendingPhotos(): Promise<number> {
	if (!arangoDb) return 0;
	const cursor = await arangoDb.query(`RETURN LENGTH(PendingPhotos)`);
	return (await cursor.next() as number) || 0;
}

const MIN_SIMILARITY = 0.3; // below this, no match — serve fallback provider instead

// Vector index search — uses APPROX_NEAR_COSINE, falls back to JS cosine scan
async function findClosestImage(queryVec: number[], allImages: ImageDocument[]): Promise<{ image: ImageDocument; similarity: number } | null> {
	if (!arangoDb) return null;
	try {
		const cursor = await arangoDb.query({
			query: `
				FOR img IN Images
					LET score = APPROX_NEAR_COSINE(img.embedding, @vec)
					SORT score DESC
					LIMIT 1
					RETURN MERGE(img, { _score: score })
			`,
			bindVars: { vec: queryVec }
		});
		const result = await cursor.next() as (ImageDocument & { _score: number }) | undefined;
		if (result && result._score >= MIN_SIMILARITY) {
			return { image: result, similarity: result._score };
		}
	} catch (err) {
		addLog("system", `[VectorIndex] APPROX_NEAR_COSINE failed, falling back to JS scan: ${(err as Error).message}`);
	}

	// JS fallback cosine scan
	let best: ImageDocument | null = null;
	let maxSim = -1;
	for (const img of allImages) {
		const sim = cosineSimilarity(queryVec, img.embedding);
		if (sim > maxSim) { maxSim = sim; best = img; }
	}
	if (!best || maxSim < MIN_SIMILARITY) return null;
	return { image: best, similarity: maxSim };
}

// Reset Database Layer
async function resetDB(): Promise<void> {
	if (!arangoDb) throw new Error("ArangoDB is not initialized");
	invalidateImagesCache();
	addLog("system", "ArangoDB: Clearing Images, Logs and Queue collections...");
	await arangoDb.query(`FOR img IN Images REMOVE img IN Images`);
	await arangoDb.query(`FOR log IN Logs REMOVE log IN Logs`);
	await arangoDb.query(`FOR job IN Queue REMOVE job IN Queue`);
	addLog("system", "ArangoDB: Reset completed.");
}

// Queue Accessors
async function getQueue(): Promise<QueueJob[]> {
	if (!arangoDb) throw new Error("ArangoDB is not initialized");
	const cursor = await arangoDb.query(`FOR job IN Queue SORT job.createdAtRaw DESC LIMIT 50 RETURN job`);
	return await cursor.all();
}

async function updateQueueJob(job: QueueJob & { createdAtRaw?: number }): Promise<void> {
	if (!arangoDb) throw new Error("ArangoDB is not initialized");
	const queueColl = arangoDb.collection("Queue");
	const exists = await queueColl.documentExists(job.id).catch(() => false);
	if (exists) {
		await queueColl.update(job.id, job);
	} else {
		await queueColl.save({ _key: job.id, ...job });
	}
}

// Logs Accessors
async function getLogs(): Promise<LogEntry[]> {
	if (!arangoDb) throw new Error("ArangoDB is not initialized");
	const cursor = await arangoDb.query(`
		FOR log IN Logs
		FILTER log.type IN ['api']
		SORT log.timestampRaw DESC
		LIMIT 100
		RETURN log
	`);
	return await cursor.all();
}

// ==========================================
// 3. BACKGROUND WORKER (DENO KV QUEUE SIMULATOR)
// ==========================================

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const RESOLUTIONS: Record<string, { w: number; h: number }> = {
	desktop_1080p: { w: 1920, h: 1080 },
	desktop_1440p: { w: 2560, h: 1440 },
	desktop_4k: { w: 3840, h: 2160 },
	desktop_budget: { w: 1366, h: 768 },
	mobile_standard: { w: 360, h: 800 },
	mobile_medium: { w: 390, h: 844 },
	mobile_large: { w: 412, h: 915 },
	tablet_standard: { w: 768, h: 1024 },
	tablet_wide: { w: 1280, h: 800 },
	original: { w: 1024, h: 1024 },
	medium: { w: 400, h: 400 },
	thumbnail: { w: 150, h: 150 }
};

async function compressImage(buffer: Buffer, mimeType: string): Promise<Buffer> {
	// Use sharp inline — fast, no network round-trip
	try {
		const compressed = await sharp(buffer).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
		addLog("queue", `[Compress] sharp: ${buffer.length} → ${compressed.length} bytes (${Math.round((1 - compressed.length / buffer.length) * 100)}% saved)`);
		return compressed;
	} catch (err) {
		addLog("queue", `[Compress] sharp failed: ${(err as Error).message}. Using original buffer.`);
		return buffer;
	}
}

// Async resmush.it post-processing — further optimizes already-uploaded S3 object (fire-and-forget)
async function reoptimizeViaResmush(s3Url: string, settings: AppSettings, resName: string, key: string): Promise<void> {
	if (!s3Url.startsWith("http")) return;
	try {
		const formData = new FormData();
		const imgRes = await fetch(s3Url, { signal: AbortSignal.timeout(15000) });
		if (!imgRes.ok) return;
		const blob = new Blob([await imgRes.arrayBuffer()], { type: "image/jpeg" });
		formData.append("files", blob, "image.jpg");

		const res = await fetch("https://api.resmush.it/ws.php?qlty=82", { method: "POST", body: formData, signal: AbortSignal.timeout(15000) });
		if (!res.ok) return;
		const json = await res.json() as any;
		if (!json?.dest) return;

		const optimized = await fetch(json.dest, { signal: AbortSignal.timeout(15000) });
		if (!optimized.ok) return;
		const optimizedBuffer = Buffer.from(await optimized.arrayBuffer());

		// Re-upload optimized version to same S3 key
		await uploadToS3(settings, resName, key, optimizedBuffer, "image/jpeg");
		addLog("queue", `[Compress] resmush.it async re-optimized ${resName}/${key}: ${(await imgRes.arrayBuffer()).byteLength} → ${optimizedBuffer.length} bytes`);
	} catch {
		// silently ignore — background optimization
	}
}

async function uploadToS3(
	settings: AppSettings,
	resolutionName: string,
	imageKey: string,
	buffer: Buffer,
	mimeType: string
): Promise<string | null> {
	if (!settings.r2AccessKeyId || !settings.r2SecretAccessKey || !settings.r2BucketName) {
		return null;
	}

	try {
		const s3 = new S3Client({
			region: "auto",
			endpoint: settings.r2Endpoint || undefined,
			credentials: {
				accessKeyId: settings.r2AccessKeyId,
				secretAccessKey: settings.r2SecretAccessKey
			}
		});

		const key = `${resolutionName}/${imageKey}.jpg`;

		await s3.send(new PutObjectCommand({
			Bucket: settings.r2BucketName,
			Key: key,
			Body: buffer,
			ContentType: mimeType
		}));

		// Prefer explicit custom CDN domain, else fall back to r2Endpoint
		const cdnBase = settings.cdnDomain
			? settings.cdnDomain.replace(/\/$/, "")
			: (() => {
					let baseUrl = settings.r2Endpoint || "";
					if (baseUrl && !baseUrl.startsWith("http")) baseUrl = `https://${baseUrl}`;
					return baseUrl;
				})();

		if (cdnBase) return `${cdnBase}/${key}`;
		return `s3://${settings.r2BucketName}/${key}`;
	} catch (err) {
		addLog("queue", `S3/R2 Upload Failed for ${resolutionName}: ${(err as Error).message}`);
		return null;
	}
}

// ── Provider registry ─────────────────────────────────────────────────────────

export const DEFAULT_PROVIDER_RANKS: Record<string, number> = {
	Wallhaven: 1,
	Pexels: 2,
	Unsplash: 3,
	Openverse: 4,
	Wikimedia: 5,
	Bing: 6,
	Flickr: 7,
	ShopifyBurst: 8,
	ImgSearch: 9,
	LifeOfPix: 10,
	Freestocks: 11,
	PxHere: 12,
	StaticPhotos: 13,
	Picsum: 99,
};

const ALL_PROVIDERS: FallbackProvider[] = [
	new WallhavenProvider(async () => {
		const s = await getSettings().catch(() => ({} as any));
		return s.wallhavenApiKey || process.env.WALLHAVEN_API_KEY;
	}),
	new PexelsProvider(async () => {
		const s = await getSettings().catch(() => ({} as any));
		return s.pexelsApiKey || process.env.PEXELS_API_KEY;
	}),
	new UnsplashProvider(async () => {
		const s = await getSettings().catch(() => ({} as any));
		return s.unsplashAccessKey || process.env.UNSPLASH_ACCESS_KEY;
	}),
	new OpenverseProvider(
		async () => { const s = await getSettings().catch(() => ({} as any)); return s.openverseClientId || process.env.OPENVERSE_CLIENT_ID; },
		async () => { const s = await getSettings().catch(() => ({} as any)); return s.openverseClientSecret || process.env.OPENVERSE_CLIENT_SECRET; }
	),
	new WikimediaProvider(),
	new BingProvider(),
	new FlickrPublicProvider(),
	new ShopifyBurstProvider(),
	new FreestocksProvider(),
	new LifeOfPixProvider(),
	new ImgSearchProvider(),
	new PxHereProvider(),
	new StaticPhotosProvider(),
	new PicsumProvider(),
];

async function getFallbackChain(): Promise<FallbackProvider[]> {
	const settings = await getSettings().catch(() => ({ providerRanks: DEFAULT_PROVIDER_RANKS } as any));
	const ranks: Record<string, number> = { ...DEFAULT_PROVIDER_RANKS, ...(settings.providerRanks || {}) };
	return ALL_PROVIDERS
		.filter(p => (ranks[p.name] ?? 50) > 0)
		.sort((a, b) => (ranks[a.name] ?? 50) - (ranks[b.name] ?? 50));
}

async function fetchBaseImage(prompt: string, promptVector: number[]): Promise<{ buffer: Buffer; mimeType: string; provider: string; sourceUrl: string; genre: string; staticSlug: string } | null> {
	const chain = await getFallbackChain();
	for (const provider of chain) {
		try {
			const result = await provider.fetch(prompt, promptVector);
			if (result) {
				addLog("queue", `[Phase 2] Fallback provider "${provider.name}" succeeded (${result.buffer.length} bytes) genre=${result.genre}`);
				return result;
			}
			addLog("queue", `[Phase 2] Fallback provider "${provider.name}" returned null, trying next`);
		} catch (err) {
			addLog("queue", `[Phase 2] Fallback provider "${provider.name}" threw: ${(err as Error).message}, trying next`);
		}
	}
	// Last-resort: Picsum by prompt seed
	try {
		const url = `https://picsum.photos/seed/${encodeURIComponent(prompt.substring(0, 30))}/1024/1024`;
		const response = await fetch(url);
		if (response.ok) {
			const arrayBuffer = await response.arrayBuffer();
			const buffer = Buffer.from(arrayBuffer);
			const { genre, staticSlug } = matchGenre(prompt);
			return { buffer, mimeType: "image/jpeg", provider: "Picsum (last-resort)", sourceUrl: url, genre, staticSlug };
		}
	} catch (innerErr) {
		addLog("queue", `[Phase 2] Picsum last-resort also failed: ${(innerErr as Error).message}`);
	}
	return null;
}

// ==========================================
// IMAGE GENERATION PROVIDER CHAIN
// ==========================================

interface GeneratedImage {
	base64Image: string; // data:<mime>;base64,<data>
	provider: string;
}

async function generateWithGemini(
	prompt: string,
	settings: AppSettings
): Promise<GeneratedImage | null> {
	const apiKey = settings.geminiApiKey || process.env.GEMINI_API_KEY;
	if (!apiKey) {
		addLog("queue", `[Provider:Gemini] Skipped — no API key configured.`);
		return null;
	}
	const baseImg = settings.baseImg ?? null;
	const ai = new GoogleGenAI({
		apiKey,
		httpOptions: { headers: { "User-Agent": "aistudio-build" } }
	});

	try {
		let response;
		if (baseImg) {
			addLog("queue", `[Provider:Gemini] Sending base image from ${baseImg.provider} to gemini-2.5-flash-image...`);
			response = await ai.models.generateContent({
				model: "gemini-2.5-flash-image",
				contents: {
					parts: [
						{ inlineData: { data: baseImg.buffer.toString("base64"), mimeType: baseImg.mimeType } },
						{ text: `Re-imagine and edit this base image according to this description: ${prompt}` }
					]
				},
				config: { imageConfig: { aspectRatio: "1:1" } }
			});
		} else {
			addLog("queue", `[Provider:Gemini] Generating from scratch: "${prompt}"`);
			response = await ai.models.generateContent({
				model: "gemini-2.5-flash-image",
				contents: { parts: [{ text: prompt }] },
				config: { imageConfig: { aspectRatio: "1:1" } }
			});
		}

		if (response.candidates?.[0]?.content?.parts) {
			for (const part of response.candidates[0].content.parts) {
				if (part.inlineData) {
					return { base64Image: `data:image/png;base64,${part.inlineData.data}`, provider: "Gemini" };
				}
			}
		}
		return null;
	} catch (err) {
		addLog("queue", `[Provider:Gemini] Failed: ${(err as Error).message}`);
		return null;
	}
}

async function generateWithCloudflareAI(
	prompt: string,
	settings: AppSettings
): Promise<GeneratedImage | null> {
	if (!settings.cfAccountId || !settings.cfApiToken) {
		addLog("queue", `[Provider:Cloudflare] Skipped — cfAccountId/cfApiToken not configured.`);
		return null;
	}

	// CF Workers AI model order: lightning (fast) → xl-base (quality)
	const models = [
		"@cf/bytedance/stable-diffusion-xl-lightning",
		"@cf/stabilityai/stable-diffusion-xl-base-1.0"
	];

	for (const model of models) {
		try {
			addLog("queue", `[Provider:Cloudflare] Trying model ${model}...`);
			const res = await fetch(
				`https://api.cloudflare.com/client/v4/accounts/${settings.cfAccountId}/ai/run/${model}`,
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${settings.cfApiToken}`,
						"Content-Type": "application/json"
					},
					body: JSON.stringify({ prompt })
				}
			);

			if (!res.ok) {
				const err = await res.text();
				addLog("queue", `[Provider:Cloudflare] ${model} HTTP ${res.status}: ${err.slice(0, 200)}`);
				continue;
			}

			const contentType = res.headers.get("Content-Type") || "";
			if (contentType.includes("image/")) {
				const buffer = Buffer.from(await res.arrayBuffer());
				const base64Image = `data:${contentType.split(";")[0]};base64,${buffer.toString("base64")}`;
				addLog("queue", `[Provider:Cloudflare] Success with ${model} (${buffer.length} bytes)`);
				return { base64Image, provider: `Cloudflare AI (${model})` };
			}

			// CF may return JSON with image data
			const json = await res.json() as any;
			if (json?.result?.image) {
				return { base64Image: `data:image/png;base64,${json.result.image}`, provider: `Cloudflare AI (${model})` };
			}

			addLog("queue", `[Provider:Cloudflare] ${model} returned unexpected format`);
		} catch (err) {
			addLog("queue", `[Provider:Cloudflare] ${model} error: ${(err as Error).message}`);
		}
	}

	return null;
}

async function generateWithPollinations(prompt: string): Promise<GeneratedImage | null> {
	// Free, no API key required — rate limited but reliable
	try {
		const encodedPrompt = encodeURIComponent(prompt);
		const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&nologo=true&enhance=true`;
		addLog("queue", `[Provider:Pollinations] Fetching: ${url}`);
		const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
		if (!res.ok) {
			addLog("queue", `[Provider:Pollinations] HTTP ${res.status}: ${res.statusText}`);
			return null;
		}
		const contentType = res.headers.get("Content-Type") || "image/jpeg";
		const buffer = Buffer.from(await res.arrayBuffer());
		addLog("queue", `[Provider:Pollinations] Success (${buffer.length} bytes)`);
		return { base64Image: `data:${contentType.split(";")[0]};base64,${buffer.toString("base64")}`, provider: "Pollinations.ai" };
	} catch (err) {
		addLog("queue", `[Provider:Pollinations] Failed: ${(err as Error).message}`);
		return null;
	}
}

async function generateWithHuggingFace(
	prompt: string,
	settings: AppSettings
): Promise<GeneratedImage | null> {
	// HF Inference API — free tier available, optional token for higher limits
	const hfToken = (settings as any).hfApiToken || process.env.HF_API_TOKEN;
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	if (hfToken) headers["Authorization"] = `Bearer ${hfToken}`;

	// Model order: flux-schnell (fast/free) → sdxl (quality)
	const models = [
		"black-forest-labs/FLUX.1-schnell",
		"stabilityai/stable-diffusion-xl-base-1.0"
	];

	for (const model of models) {
		try {
			addLog("queue", `[Provider:HuggingFace] Trying ${model}...`);
			const res = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
				method: "POST",
				headers,
				body: JSON.stringify({ inputs: prompt }),
				signal: AbortSignal.timeout(60000)
			});

			if (res.status === 503) {
				addLog("queue", `[Provider:HuggingFace] ${model} loading, skipping...`);
				continue;
			}
			if (!res.ok) {
				addLog("queue", `[Provider:HuggingFace] ${model} HTTP ${res.status}`);
				continue;
			}

			const contentType = res.headers.get("Content-Type") || "";
			if (contentType.includes("image/")) {
				const buffer = Buffer.from(await res.arrayBuffer());
				addLog("queue", `[Provider:HuggingFace] Success with ${model} (${buffer.length} bytes)`);
				return { base64Image: `data:${contentType.split(";")[0]};base64,${buffer.toString("base64")}`, provider: `HuggingFace (${model})` };
			}
		} catch (err) {
			addLog("queue", `[Provider:HuggingFace] ${model} error: ${(err as Error).message}`);
		}
	}

	return null;
}

// placeholder: async function generateWithReplicate(...) { ... }
// placeholder: async function generateWithStabilityAI(...) { ... }
// placeholder: async function generateWithOpenAI(...) { ... }

async function generateImageWithFallback(
	prompt: string,
	baseImg: { buffer: Buffer; mimeType: string; provider: string } | null,
	settings: AppSettings
): Promise<GeneratedImage> {
	// Adjust prompt by matched genre's template before generating
	const { adjustedPrompt, genre, staticSlug } = applyGenreTemplate(prompt);
	if (adjustedPrompt !== prompt) {
		addLog("queue", `[Provider Chain] Genre "${genre}" (${staticSlug}) adjusted prompt: "${adjustedPrompt.slice(0, 100)}"`);
	} else {
		addLog("queue", `[Provider Chain] Genre "${genre}" (${staticSlug}) — no template, using original prompt`);
	}

	// Provider chain — add new providers here
	let genResult = null;
	let generators: ((p: string, s: AppSettings) => Promise<GeneratedImage | null>)[] = [
		generateWithCloudflareAI,
		generateWithPollinations,
		generateWithHuggingFace,
	];

	const geminiKey = settings.geminiApiKey || process.env.GEMINI_API_KEY;
	if (geminiKey) {
		settings.baseImg = baseImg;
		generators.push(generateWithGemini);
	}
	// placeholder: Replicate
	// placeholder: Stability AI
	// placeholder: OpenAI DALL-E

	while (!genResult && generators?.length) {
		let chosen = generators[Math.floor(Math.random() * generators.length)];
		genResult = await chosen(adjustedPrompt, settings);
		if (!genResult) generators = generators.filter(x => x != chosen);
	}

	if (genResult) return genResult;

	// Last resort: use base image as-is
	if (baseImg) {
		addLog("queue", `[Provider Chain] All providers exhausted. Using semantic best-fit source image from ${baseImg.provider}.`);
		return { base64Image: `data:${baseImg.mimeType};base64,${baseImg.buffer.toString("base64")}`, provider: `fallback:${baseImg.provider}` };
	}

	throw new Error("All image generation providers failed and no base image available.");
}

async function generateImageAndSave(prompt: string, category: string, seed: number): Promise<ImageDocument> {
	addLog("queue", `[On-Demand] Generating image synchronously for prompt: "${prompt}" (seed: ${seed})`);

	// 1. Get embedding vector first (so we can find best-fit semantically aligned base/fallback image)
	addLog("queue", `[On-Demand] ArangoDB Vectors: Extracting dense vector embeddings of prompt...`);
	const embedding = await getEmbeddingVector(prompt);

	// 2. Fetch base image from Free Source API using semantic best fit comparison
	const baseImg = await fetchBaseImage(prompt, embedding);

	// 3. Generate image via provider fallback chain
	const settings = await getSettings();
	const genResult = await generateImageWithFallback(prompt, baseImg, settings);
	const { base64Image, provider: generatedBy } = genResult;

	// 4. Multi-Variant Resizing via sharp
	addLog("queue", `[On-Demand] sharp: Reading generated image buffer...`);
	const srcBuffer = Buffer.from(base64Image.replace(/^data:image\/\w+;base64,/, ""), "base64");
	const meta = await sharp(srcBuffer).metadata();

	const key = `gen-${Math.random().toString(36).substring(2, 9)}`;
	const variants: Record<string, string> = {};

	addLog("queue", `[On-Demand] sharp: Source size ${meta.width}x${meta.height}. Resizing ${Object.keys(RESOLUTIONS).length} presets...`);

	for (const [resName, dim] of Object.entries(RESOLUTIONS)) {
		addLog("queue", `[On-Demand] sharp: Resizing variant '${resName}' to ${dim.w}x${dim.h}...`);
		const rawBuffer = await sharp(srcBuffer)
			.resize(dim.w, dim.h, { fit: "cover" })
			.jpeg({ quality: 85 })
			.toBuffer();
		const base64Str = `data:image/jpeg;base64,${rawBuffer.toString("base64")}`;

		// Compress jpg before upload
		const jpgBuffer = await compressImage(rawBuffer, "image/jpeg");

		// Pre-generate webp + png variants (eliminates on-demand fetch+convert overhead)
		const [webpBuffer, pngBuffer] = await Promise.all([
			convertBuffer(jpgBuffer, "webp"),
			convertBuffer(jpgBuffer, "png")
		]);

		// Upload all three formats in parallel
		const [jpgUrl, webpUrl, pngUrl] = await Promise.all([
			uploadToS3(settings, resName, key, jpgBuffer, "image/jpeg"),
			uploadToS3(settings, `${resName}_webp`, key, webpBuffer, "image/webp"),
			uploadToS3(settings, `${resName}_png`, key, pngBuffer, "image/png")
		]);

		if (jpgUrl) {
			addLog("queue", `S3/R2: Uploaded ${resName} jpg/webp/png -> ${jpgUrl}`);
			variants[resName] = jpgUrl;
			// Fire-and-forget async resmush re-optimization
			reoptimizeViaResmush(jpgUrl, settings, resName, key).catch(() => {});
		} else {
			variants[resName] = base64Str;
		}
		if (webpUrl) variants[`${resName}_webp`] = webpUrl;
		if (pngUrl) variants[`${resName}_png`] = pngUrl;
	}

	// 5. Save to Database
	addLog("queue", `[On-Demand] Saving multi-variant images and embedding vector in ArangoDB collection 'Images'...`);

	const { genre, staticSlug: resolvedSlug } = matchGenre(prompt);
	const newDoc: ImageDocument = {
		_key: key,
		sourceUrl: variants.medium || base64Image,
		category: category || resolvedSlug,
		genre,
		text: prompt,
		seed: seed,
		embedding: embedding,
		generatedBy,
		createdAt: new Date().toISOString(),
		variants: variants
	};

	await addImage(newDoc);
	addLog("queue", `[On-Demand] Synchronous generation completed successfully for prompt: "${prompt}".`);
	return newDoc;
}

let isQueueProcessing = false;

async function processQueue() {
	if (isQueueProcessing) return;
	isQueueProcessing = true;

	try {
		const jobs = await getQueue();
		const job = jobs.find(j => j.status === "pending");
		if (!job) {
			isQueueProcessing = false;
			return;
		}

		job.status = "processing";
		job.progress = 5;
		await updateQueueJob(job);
		addLog("queue", `ArangoDB Queue: Worker picked up job ${job.id} for prompt: "${job.prompt}"`);

		// Step 1: Initializing
		job.progress = 25;
		await updateQueueJob(job);
		addLog("queue", `ArangoDB Queue: Generating image for prompt "${job.prompt}"...`);

		const newDoc = await generateImageAndSave(job.prompt, job.category || matchGenre(job.prompt).staticSlug, job.seed);

		job.progress = 100;
		job.status = "completed";
		await updateQueueJob(job);
		const settings = await getSettings();
		addLog("queue", `ArangoDB Queue: Successfully completed job ${job.id}! All variants cached in ArangoDB collection 'Images'${settings.r2BucketName ? " and Cloudflare R2 S3 bucket" : ""}.`);

	} catch (error) {
		addLog("queue", `Error processing queue job: ${(error as Error).message}`);
		try {
			const jobs = await getQueue();
			const job = jobs.find(j => j.status === "processing");
			if (job) {
				job.status = "failed";
				await updateQueueJob(job);
			}
		} catch (e) {
			// ignore
		}
	} finally {
		isQueueProcessing = false;
		setTimeout(processQueue, 1000);
	}
}

async function enqueueJob(prompt: string, category: string, seed: number) {
	const jobs = await getQueue();
	const exists = jobs.some(j => j.prompt === prompt && (j.status === "pending" || j.status === "processing"));
	if (exists) return;

	const job: QueueJob & { createdAtRaw: number } = {
		id: `job-${Math.random().toString(36).substring(2, 9)}`,
		prompt,
		category,
		seed,
		status: "pending",
		progress: 0,
		createdAt: new Date().toLocaleTimeString(),
		createdAtRaw: Date.now()
	};

	await updateQueueJob(job);
	addLog("queue", `ArangoDB Queue: Enqueued background generator job (${job.id})`);

	const currentJobs = await getQueue();
	if (!currentJobs.some(j => j.status === "processing")) {
		processQueue();
	}
}

// ==========================================
// 4. API ROUTING (EXPRESS API SIMULATOR)
// ==========================================

// Settings endpoints
app.get("/api/settings", requireAdmin, async (req, res) => {
	const settings = await getSettings();
	res.json(settings);
});

app.post("/api/settings", requireAdmin, async (req, res) => {
	const newSettings: AppSettings = req.body;
	await updateSettings(newSettings);
	res.json({ success: true, settings: newSettings });
});

// Reset DB
app.post("/api/reset", requireAdmin, async (req, res) => {
	await resetDB();
	res.json({ success: true, message: "Database reseeded!" });
});

// Get Database Items
app.get("/api/genres", (_req, res) => {
	res.json(GENRES.map(g => ({ slug: g.slug, staticSlug: g.staticSlug, keywords: g.keywords.slice(0, 5) })));
});

app.get("/api/categories", (_req, res) => {
	const slugs = [...new Set(GENRES.map(g => g.staticSlug))].sort();
	res.json(slugs);
});

app.get("/api/images/random-text", async (_req, res) => {
	try {
		if (!arangoDb) return res.status(503).json({ error: "DB not connected" });
		const cursor = await arangoDb.query(`FOR img IN Images SORT RAND() LIMIT 1 RETURN img.text`);
		const results = await cursor.all();
		const text = results[0] || null;
		res.json({ text });
	} catch (e) {
		res.status(500).json({ error: (e as Error).message });
	}
});

app.get("/api/images", requireAdmin, async (req, res) => {
	const images = await getImages();
	res.json(images);
});

// Migrate existing variant URLs from raw R2 endpoint to cdnDomain
app.post("/api/images/migrate-cdn-urls", requireAdmin, async (_req, res) => {
	if (!arangoDb) return res.status(503).json({ error: "DB not connected" });
	const settings = await getSettings();
	if (!settings.cdnDomain) return res.status(400).json({ error: "cdnDomain not set in settings" });
	const cdnBase = settings.cdnDomain.replace(/\/$/, "");
	const r2Base = (settings.r2Endpoint || "").replace(/\/$/, "");
	if (!r2Base) return res.status(400).json({ error: "r2Endpoint not set in settings" });

	const images = await getImages();
	const coll = arangoDb.collection("Images");
	let updated = 0;

	for (const img of images) {
		if (!img.variants) continue;
		let changed = false;
		const newVariants: Record<string, string> = {};
		for (const [k, url] of Object.entries(img.variants as Record<string, string>)) {
			if (url.startsWith(r2Base)) {
				newVariants[k] = cdnBase + url.slice(r2Base.length);
				changed = true;
			} else {
				newVariants[k] = url;
			}
		}
		if (changed) {
			await coll.update(img._key, { variants: newVariants });
			updated++;
		}
	}

	invalidateImagesCache();
	res.json({ updated, total: images.length, r2Base, cdnBase });
});

// Get Queue Jobs
app.get("/api/queue", requireAdmin, async (req, res) => {
	const queue = await getQueue();
	res.json(queue);
});

// Get Live Logs
app.get("/api/logs", requireAdmin, async (req, res) => {
	const logs = await getLogs();
	res.json(logs);
});

// Poll endpoint for async CDN generation jobs
app.get("/api/cdn/:width/:height/status/:jobId", async (req, res) => {
	const textQuery = req.query.text as string;
	const outputFormat = parseOutputFormat(req.query.output as string);
	const width = parseInt(req.params.width) || 800;
	const height = parseInt(req.params.height) || 600;
	if (!textQuery) return res.status(400).json({ error: "text param required" });

	const currentImages = await getImages();
	const vector = await getEmbeddingVector(textQuery);
	const closest = await findClosestImage(vector, currentImages);

	if (closest && closest.similarity >= 0.85) {
		// Generation done — redirect to final image
		res.setHeader("X-Similarity-Score", closest.similarity.toString());
		return res.redirect(303, `/api/cdn/${width}/${height}?text=${encodeURIComponent(textQuery)}&output=${outputFormat}`);
	}

	res.setHeader("Retry-After", "3");
	return res.status(202).json({
		status: "pending",
		similarity: closest?.similarity || 0,
		message: "Still generating. Retry after Retry-After seconds."
	});
});

// THE PHOTOS CDN API ENDPOINT
app.get(["/api/cdn/:width/:height", "/cdn/:width/:height"], async (req, res) => {
	const width = parseInt(req.params.width) || 800;
	const height = parseInt(req.params.height) || 600;
	const seed = parseInt(req.query.seed as string) || 42;
	const textQuery = req.query.text as string;
	const category = (req.query.category as string) || (textQuery ? matchGenre(textQuery).staticSlug : "nature");
	const format = (req.query.format as string) || "image";
	const outputFormat = parseOutputFormat(req.query.output as string);
	const prefer = (req.headers["prefer"] as string) || "";

	addLog("api", `[Request Received] GET /${width}/${height}?category=${category}&seed=${seed}&text=${textQuery || "none"}&format=${format}&output=${outputFormat}`);

	const serveImage = async (timedOut = false) => {
		const currentImages = await getImages();
		let matchedImage: ImageDocument | null = null;
		let similarityScore = 0;
		let isFallback = timedOut;

		if (!timedOut && textQuery) {
			addLog("api", `[Phase 2] Computing query embedding vector...`);
			try {
				const vector = await getEmbeddingVector(textQuery);
				addLog("api", `[Phase 2] Query vector: [${vector.slice(0, 3).join(", ")}... 128 dimensions]`);
				addLog("api", `[Phase 2] ArangoDB Vector Index: APPROX_NEAR_COSINE search across ${currentImages.length} documents...`);
				const closest = await findClosestImage(vector, currentImages);
				matchedImage = closest?.image || null;
				similarityScore = closest?.similarity || 0;
				addLog("api", `[Phase 2] Closest Match: "${matchedImage?.text}" | Cosine Similarity Score: ${similarityScore.toFixed(4)}`);
			} catch (embErr) {
				addLog("api", `[Phase 2] Embedding failed (${(embErr as Error).message}) — falling back to category match`);
				isFallback = true;
				const filtered = currentImages.filter(img => img.category.toLowerCase() === category.toLowerCase());
				if (filtered.length > 0) {
					filtered.sort((a, b) => Math.abs(a.seed - seed) - Math.abs(b.seed - seed));
					matchedImage = filtered[0];
					similarityScore = 0.5;
				}
			}
		} else if (!timedOut) {
			addLog("api", `[Phase 2] Searching by category: "${category}" and seed: ${seed}`);
			const filtered = currentImages.filter(img => img.category.toLowerCase() === category.toLowerCase());
			if (filtered.length > 0) {
				filtered.sort((a, b) => Math.abs(a.seed - seed) - Math.abs(b.seed - seed));
				matchedImage = filtered[0];
				similarityScore = 1.0;
			}
		}

		let finalImage = matchedImage || currentImages[0];
		if (!finalImage) {
			addLog("api", `[Phase 2] No images in DB — redirecting to Picsum fallback`);
			setFallbackHeaders(res, "Picsum-Empty", 0, timedOut);
			return res.redirect(302, `https://picsum.photos/seed/${encodeURIComponent((textQuery || category).substring(0, 30))}/${width}/${height}`);
		}
		let cacheControl = "public, max-age=31536000";
		let triggerGeneration = false;
		const provider = finalImage._key ? "DB" : "Seed";

		if (!timedOut && textQuery && similarityScore < 0.85) {
			triggerGeneration = true;
			isFallback = true;

			if (prefer.includes("respond-async")) {
				const jobId = `cdn-${Math.random().toString(36).substring(2, 9)}`;
				addLog("api", `[Phase 3] Prefer: respond-async — returning 202, job ${jobId}`);
				generateImageAndSave(textQuery, category, seed)
					.then(() => addLog("api", `[Phase 3] Async job ${jobId} complete for: "${textQuery}"`))
					.catch(err => addLog("api", `[Phase 3 ERROR] Async job ${jobId} failed: ${(err as Error).message}`));
				res.setHeader("Location", `/api/cdn/${width}/${height}/status/${jobId}?text=${encodeURIComponent(textQuery)}&format=${format}&output=${outputFormat}`);
				res.setHeader("Retry-After", "5");
				setFallbackHeaders(res, provider, similarityScore, false, finalImage?.sourceUrl);
				return res.status(202).json({
					status: "accepted",
					jobId,
					message: "Image generation started. Poll Location for readiness.",
					fallback: finalImage ? `${req.protocol}://${req.get("host")}/api/cdn/${width}/${height}?text=${encodeURIComponent(textQuery)}&output=${outputFormat}` : null
				});
			}

			addLog("api", `[Phase 3] Similarity ${similarityScore.toFixed(4)} < 0.85 — SWR: serving best match, generating in background.`);
			cacheControl = "public, max-age=300, stale-while-revalidate=86400";
			generateImageAndSave(textQuery, category, seed)
				.then(() => addLog("api", `[Phase 3] Background generation complete for: "${textQuery}"`))
				.catch(err => addLog("api", `[Phase 3 ERROR] Background generation failed: ${(err as Error).message}`));
		} else if (!timedOut && textQuery) {
			addLog("api", `[Phase 4] Quality Match verified (Similarity: ${similarityScore.toFixed(4)} >= 0.85). Serving directly with long-lived Cache-Control.`);
		}

		res.setHeader("Cache-Control", timedOut ? "public, max-age=30" : cacheControl);
		res.setHeader("Vary", "Accept");
		res.setHeader("ETag", `"${finalImage._key}-${outputFormat}"`);
		res.setHeader("X-Similarity-Score", similarityScore.toString());
		res.setHeader("X-Async-Generated", triggerGeneration ? "true" : "false");
		res.setHeader("X-Image-Key", finalImage._key);
		if (textQuery) {
			const { genre, staticSlug: gSlug } = matchGenre(textQuery);
			res.setHeader("X-Genre", genre);
			res.setHeader("X-Genre-Slug", gSlug);
		}
		if (isFallback) setFallbackHeaders(res, provider, similarityScore, timedOut, finalImage?.sourceUrl);

		if (format === "blurhash") {
			addLog("api", `[Phase 4] Format requested: blurhash.`);
			res.setHeader("Content-Type", "application/json");
			return res.status(200).json({
				blurhash: null,
				sourceUrl: finalImage.sourceUrl,
				similarity: similarityScore,
				metadata: { key: finalImage._key, prompt: finalImage.text, seed: finalImage.seed }
			});
		}

		if (format === "lqip") {
			addLog("api", `[Phase 4] Format requested: lqip. Performing 302 Redirect to low-quality placeholder CDN resized asset.`);
			if (finalImage.variants && finalImage.variants.thumbnail) {
				const matches = finalImage.variants.thumbnail.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.*)$/);
				if (matches && matches.length === 3) {
					res.setHeader("Content-Type", matches[1]);
					return res.status(200).send(Buffer.from(matches[2], "base64"));
				}
			}
			return res.redirect(302, `${finalImage.sourceUrl}&w=40&auto=format&fit=crop&q=20&blur=10`);
		}

		if (finalImage.variants) {
			let bestVariantName = "medium";
			let minDiff = Infinity;
			for (const [resName, dim] of Object.entries(RESOLUTIONS)) {
				const diff = Math.abs(dim.w - width) + Math.abs(dim.h - height);
				if (diff < minDiff) { minDiff = diff; bestVariantName = resName; }
			}

			const fmtKey = outputFormat === "jpg" ? bestVariantName : `${bestVariantName}_${outputFormat}`;
			const preGenUrl = finalImage.variants[fmtKey];
			if (preGenUrl && (preGenUrl.startsWith("http") || preGenUrl.startsWith("s3://"))) {
				addLog("api", `[Phase 4] Delivery: 302 → pre-generated ${outputFormat} '${fmtKey}' -> ${preGenUrl}`);
				res.setHeader("Content-Type", OUTPUT_MIME[outputFormat]);
				return res.redirect(302, preGenUrl);
			}

			const servedData = finalImage.variants[bestVariantName] || finalImage.variants.medium || finalImage.variants.original;
			if (servedData) {
				let rawBuffer: Buffer | null = null;
				if (servedData.startsWith("data:")) {
					const matches = servedData.match(/^data:[^;]+;base64,(.*)$/);
					if (matches) rawBuffer = Buffer.from(matches[1], "base64");
				} else if (servedData.startsWith("http") || servedData.startsWith("s3://")) {
					if (outputFormat !== "jpg") {
						rawBuffer = await fetchAndConvert(servedData, outputFormat);
					} else {
						addLog("api", `[Phase 4] Delivery: 302 → S3/R2 '${bestVariantName}' (jpg) -> ${servedData}`);
						res.setHeader("Content-Type", "image/jpeg");
						return res.redirect(302, servedData);
					}
				}
				if (rawBuffer) {
					const converted = await convertBuffer(rawBuffer, outputFormat);
					res.setHeader("Content-Type", OUTPUT_MIME[outputFormat]);
					addLog("api", `[Phase 4] Delivery: Serving '${bestVariantName}' (${width}x${height}) as ${outputFormat} (${converted.length} bytes).`);
					return res.status(200).send(converted);
				}
			}
		}

		addLog("api", `[Phase 4] Delivery: HTTP 302 Redirecting to Cloudflare Resizing Edge CDN.`);
		return res.redirect(302, `${finalImage.sourceUrl}&w=${width}&h=${height}&fit=crop&auto=format&q=80`);
	};

	try {
		await Promise.race([
			serveImage(false),
			serveTimeout(SERVE_TIMEOUT_MS).catch(async () => {
				if (!res.headersSent) {
					addLog("api", `[TIMEOUT] Request exceeded ${SERVE_TIMEOUT_MS}ms — serving cached fallback`);
					await serveImage(true);
				}
			})
		]);
	} catch (error) {
		addLog("system", `[API ERROR] Failure serving request: ${(error as Error).message}`);
		if (!res.headersSent) {
			// Last-resort: redirect to Picsum so the response is always an image
			const picsumUrl = `https://picsum.photos/seed/${encodeURIComponent((textQuery || category).substring(0, 30))}/${width}/${height}`;
			res.setHeader("X-CDN-Fallback", "true");
			res.setHeader("X-CDN-Provider", "Picsum-ErrorRecovery");
			res.setHeader("X-CDN-Error", (error as Error).message.slice(0, 200));
			return res.redirect(302, picsumUrl);
		}
	}
});

// ==========================================
// RESPONSE TIMEOUT HELPER
// ==========================================

const SERVE_TIMEOUT_MS = 3000;

// Rejects after ms — used in Promise.race to enforce hard response deadline.
function serveTimeout(ms: number): Promise<never> {
	return new Promise((_, reject) =>
		setTimeout(() => reject(new Error(`SERVE_TIMEOUT:${ms}ms`)), ms)
	);
}

function setFallbackHeaders(res: any, provider: string, similarity: number, timedOut = false, sourceUrl?: string) {
	res.setHeader("X-CDN-Fallback", "true");
	res.setHeader("X-CDN-Provider", provider);
	res.setHeader("X-CDN-Similarity", similarity.toFixed(4));
	if (timedOut) res.setHeader("X-CDN-Timeout", "true");
	if (sourceUrl) {
		res.setHeader("X-CDN-Source-URL", sourceUrl);
		res.setHeader("X-CDN-Credits", `Image from ${provider}; source: ${sourceUrl}`);
	}
}

// ==========================================
// 5. SRCSET ENDPOINT
// ==========================================

const SRCSET_WIDTHS: { resName: string; w: number }[] = [
	{ resName: "thumbnail",      w: 150  },
	{ resName: "medium",         w: 400  },
	{ resName: "mobile_standard",w: 360  },
	{ resName: "mobile_medium",  w: 390  },
	{ resName: "mobile_large",   w: 412  },
	{ resName: "tablet_standard",w: 768  },
	{ resName: "desktop_budget", w: 1366 },
	{ resName: "desktop_1080p",  w: 1920 },
	{ resName: "desktop_1440p",  w: 2560 },
	{ resName: "desktop_4k",     w: 3840 }
];

app.get("/api/cdn/srcset", async (req, res) => {
	const seed = parseInt(req.query.seed as string) || 42;
	const textQuery = req.query.text as string;
	const category = (req.query.category as string) || (textQuery ? matchGenre(textQuery).staticSlug : "nature");
	const outputFormat = parseOutputFormat(req.query.output as string);
	const prefer = req.headers["prefer"] || "";

	addLog("api", `[srcset] GET /api/cdn/srcset?text=${textQuery || "none"}&output=${outputFormat}`);

	const serveSrcset = async (timedOut = false) => {
		const currentImages = await getImages();
		let finalImage: ImageDocument | null = null;
		let similarityScore = 0;
		let asyncJobId: string | null = null;
		let isFallback = timedOut;

		if (!timedOut && textQuery) {
			const vector = await getEmbeddingVector(textQuery);
			const closest = await findClosestImage(vector, currentImages);
			finalImage = closest?.image || null;
			similarityScore = closest?.similarity || 0;

			if (similarityScore < 0.85) {
				isFallback = true;
				if (prefer.includes("respond-async")) {
					const jobId = `srcset-${Math.random().toString(36).substring(2, 9)}`;
					asyncJobId = jobId;
					generateImageAndSave(textQuery, category, seed)
						.then(() => addLog("api", `[srcset async] Generation complete for job ${jobId}: "${textQuery}"`))
						.catch(err => addLog("api", `[srcset async] Generation failed for job ${jobId}: ${(err as Error).message}`));
					res.setHeader("Location", `/api/cdn/srcset/status/${jobId}?text=${encodeURIComponent(textQuery)}&output=${outputFormat}`);
					setFallbackHeaders(res, "DB", similarityScore, false, finalImage?.sourceUrl);
					return res.status(202).json({
						status: "accepted",
						jobId,
						message: "Image generation started. Poll Location header for readiness.",
						fallback: buildSrcsetPayload(finalImage || currentImages[0], outputFormat, similarityScore, true)
					});
				}
				generateImageAndSave(textQuery, category, seed)
					.then(() => addLog("api", `[srcset] Background generation complete for: "${textQuery}"`))
					.catch(err => addLog("api", `[srcset] Background generation failed: ${(err as Error).message}`));
				res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=86400");
			} else {
				res.setHeader("Cache-Control", "public, max-age=31536000");
			}
		} else if (!timedOut) {
			const filtered = currentImages.filter(img => img.category.toLowerCase() === category.toLowerCase());
			if (filtered.length > 0) {
				filtered.sort((a, b) => Math.abs(a.seed - seed) - Math.abs(b.seed - seed));
				finalImage = filtered[0];
				similarityScore = 1.0;
			}
			res.setHeader("Cache-Control", "public, max-age=31536000");
		}

		const image = finalImage || currentImages[0];
		if (!image) return res.status(404).json({ error: "No images available" });

		res.setHeader("Vary", "Accept");
		res.setHeader("X-Similarity-Score", similarityScore.toString());
		res.setHeader("X-Async-Generated", asyncJobId ? "pending" : "false");
		if (isFallback) {
			setFallbackHeaders(res, "DB", similarityScore, timedOut, image?.sourceUrl);
			res.setHeader("Cache-Control", timedOut ? "public, max-age=30" : "public, max-age=60, stale-while-revalidate=86400");
		}
		return res.status(200).json(buildSrcsetPayload(image, outputFormat, similarityScore, isFallback));
	};

	try {
		await Promise.race([
			serveSrcset(false),
			serveTimeout(SERVE_TIMEOUT_MS).catch(async () => {
				if (!res.headersSent) {
					addLog("api", `[TIMEOUT] srcset exceeded ${SERVE_TIMEOUT_MS}ms — serving cached fallback`);
					await serveSrcset(true);
				}
			})
		]);
	} catch (error) {
		if (!res.headersSent) {
			addLog("system", `[srcset ERROR] ${(error as Error).message}`);
			res.status(500).json({ error: "Internal Server Error", message: (error as Error).message });
		}
	}
});

// Poll endpoint — returns 200 once image exists, 202 while still generating
app.get("/api/cdn/srcset/status/:jobId", async (req, res) => {
	const textQuery = req.query.text as string;
	const outputFormat = parseOutputFormat(req.query.output as string);
	if (!textQuery) return res.status(400).json({ error: "text param required" });

	const currentImages = await getImages();
	if (textQuery) {
		const vector = await getEmbeddingVector(textQuery);
		const closest = await findClosestImage(vector, currentImages);
		if (closest && closest.similarity >= 0.85) {
			return res.status(200).json({
				status: "ready",
				...buildSrcsetPayload(closest.image, outputFormat, closest.similarity, false)
			});
		}
	}
	// Still generating
	const fallback = currentImages[0];
	res.setHeader("Retry-After", "3");
	return res.status(202).json({
		status: "pending",
		message: "Still generating, retry after Retry-After seconds.",
		fallback: fallback ? buildSrcsetPayload(fallback, outputFormat, 0, true) : null
	});
});

function buildSrcsetPayload(image: ImageDocument, fmt: OutputFormat, similarity: number, isFallback: boolean) {
	const fmtSuffix = fmt === "jpg" ? "" : `_${fmt}`;
	const variants = image.variants || {};

	const srcsetParts: string[] = [];
	for (const { resName, w } of SRCSET_WIDTHS) {
		const key = `${resName}${fmtSuffix}`;
		const url = variants[key] || variants[resName];
		if (url && url.startsWith("http")) {
			srcsetParts.push(`${url} ${w}w`);
		}
	}

	// Default src: medium or original
	const src = (fmt === "jpg" ? variants.medium : variants[`medium_${fmt}`]) ||
							 variants.medium ||
							 image.sourceUrl;

	const sizes = [
		"(max-width: 360px) 360px",
		"(max-width: 768px) 768px",
		"(max-width: 1366px) 1366px",
		"(max-width: 1920px) 1920px",
		"3840px"
	].join(", ");

	return {
		key: image._key,
		src,
		srcset: srcsetParts.join(", "),
		sizes,
		alt: image.text,
		format: fmt,
		similarity,
		isFallback,
		metadata: {
			key: image._key,
			category: image.category,
			seed: image.seed,
			prompt: image.text
		}
	};
}

// ==========================================
// 6. DAILY INDEXER WORKER
// ==========================================

export let indexerStatus: IndexerStatus | null = null;

export function getIndexerDeps() {
	return {
		getSettings,
		getImages,
		addImage,
		addPendingPhoto,
		getPendingPhotoUrls,
		popOnePendingPhoto,
		countPendingPhotos,
		getEmbeddingVector,
		uploadToS3,
		compressImage,
		convertBuffer,
		addLog,
		RESOLUTIONS,
	};
}

app.get("/api/indexer/status", requireAdmin, (_req, res) => {
	res.json(indexerStatus || { running: false, lastRun: null, lastResult: null, nextRun: null });
});

app.post("/api/indexer/trigger", requireAdmin, async (_req, res) => {
	if (indexerStatus?.running) {
		return res.status(409).json({ error: "Indexer already running" });
	}
	res.json({ status: "started", message: "Daily indexer triggered manually" });
	// Run in background — don't await
	if (indexerStatus) indexerStatus.running = true;
	runDailyIndexer(getIndexerDeps())
		.then(result => {
			if (indexerStatus) {
				indexerStatus.running = false;
				indexerStatus.lastRun = new Date().toISOString();
				indexerStatus.lastResult = result;
			}
		})
		.catch(err => {
			if (indexerStatus) indexerStatus.running = false;
			addLog("system", `[Indexer] Manual trigger error: ${(err as Error).message}`);
		});
});

// Delete a single PendingPhoto
app.delete("/api/pending-photos/:key", requireAdmin, async (req, res) => {
	if (!arangoDb) return res.status(503).json({ error: "DB not connected" });
	try {
		await arangoDb.collection("PendingPhotos").remove(req.params.key);
		res.json({ deleted: true });
	} catch (e) {
		res.status(404).json({ error: "Not found" });
	}
});

// Get PendingPhotos (crawled, not yet indexed)
app.get("/api/pending-photos", requireAdmin, async (req, res) => {
	if (!arangoDb) return res.status(503).json({ error: "DB not connected" });
	const page = Math.max(1, parseInt(req.query.page as string) || 1);
	const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
	const offset = (page - 1) * limit;
	const [cursor, countCursor] = await Promise.all([
		arangoDb.query(`FOR p IN PendingPhotos SORT p.createdAt DESC LIMIT ${offset}, ${limit} RETURN p`),
		arangoDb.query(`RETURN LENGTH(PendingPhotos)`)
	]);
	const [items, total] = await Promise.all([cursor.all(), countCursor.next() as Promise<number>]);
	res.json({ items, total, page, limit, pages: Math.ceil(total / limit) });
});

// Retry a generated image (re-enqueue by key)
app.post("/api/images/:key/retry", requireAdmin, async (req, res) => {
	const images = await getImages();
	const img = images.find(i => i._key === req.params.key);
	if (!img) return res.status(404).json({ error: "Image not found" });
	await enqueueJob(img.text, img.category, img.seed);
	res.json({ queued: true, prompt: img.text, category: img.category, seed: img.seed });
});

// ==========================================
// 7. STATIC FILES & SERVING
// ==========================================

async function startServer() {
	// Connect/Verify ArangoDB connection on startup
	await connectToArango();

	// Start daily indexer (fires 30s after startup, then every 24h)
	indexerStatus = startDailyIndexer(getIndexerDeps());
	addLog("system", `[Indexer] Scheduled — first run in 30s, then every 24h. Next: ${indexerStatus.nextRun}`);

	addLog("system", "Starting development server, serving static files directly...");
	// Serve files from the current working directory
	app.use(express.static(process.cwd()));

	// Serve index.html on root request
	app.get("/", (req, res) => {
		res.sendFile(`${process.cwd()}/index.html`);
	});

	app.listen(PORT, "0.0.0.0", () => {
		addLog("system", `Photos CDN Development playground running at http://localhost:${PORT}`);
	});
}

process.on("unhandledRejection", (reason) => {
	console.error("[FATAL] Unhandled promise rejection:", reason);
});

startServer();
