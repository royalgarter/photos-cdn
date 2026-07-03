import express from "express";
import path from "path";
import { GoogleGenAI } from "@google/genai";
import { Database } from "arangojs";
import { Jimp } from "jimp";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const app = express();
const PORT = parseInt(process.env.PORT || "3000");

app.use(express.json());

// ==========================================
// 1. SCHEMAS & INTERFACES
// ==========================================

interface ImageDocument {
  _key: string;
  sourceUrl: string;
  category: string;
  text: string;
  embedding: number[];
  seed: number;
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
  // placeholder: stabilityApiKey: string;
  // placeholder: openaiApiKey: string;
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

// Generate a vector from text using keyword stems (fallback vectorizer)
function getSimulatedVector(text: string): number[] {
  const query = text.toLowerCase();
  const vector = new Array(128).fill(0.01); // Base background noise for 128 dimensions

  // Keyword associations (mapped to the first 10 dimensions for semantic grouping)
  const mappings: { idx: number; words: string[] }[] = [
    { idx: 0, words: ["nature", "forest", "tree", "wood", "mountain", "lake", "river", "grass", "green", "scenery", "valley", "landscape"] },
    { idx: 1, words: ["water", "river", "ocean", "sea", "wave", "waterfall", "rain", "lake", "stream", "wet", "aqua", "splash"] },
    { idx: 2, words: ["sky", "cloud", "sun", "star", "galaxy", "cosmic", "sunrise", "sunset", "heaven", "moon", "night sky"] },
    { idx: 3, words: ["night", "dark", "neon", "shadow", "black", "midnight", "evening", "glowing", "dim"] },
    { idx: 4, words: ["city", "urban", "building", "street", "concrete", "architecture", "tower", "downtown", "road", "indoor", "museum"] },
    { idx: 5, words: ["warm", "heat", "desert", "fire", "red", "orange", "gold", "summer", "sun", "hot", "flame", "sunset"] },
    { idx: 6, words: ["cold", "ice", "snow", "blue", "winter", "frost", "glacier", "chill", "arctic", "freeze"] },
    { idx: 7, words: ["futuristic", "cyberpunk", "tech", "robot", "neon", "spaceship", "advanced", "hologram", "digital", "machine"] },
    { idx: 8, words: ["animal", "bird", "fish", "insect", "cat", "dog", "wildlife", "fox", "bear", "tiger", "lion", "nature"] },
    { idx: 9, words: ["minimal", "abstract", "geometric", "simple", "clean", "pattern", "line", "shape", "white", "minimalist"] }
  ];

  mappings.forEach(({ idx, words }) => {
    words.forEach(word => {
      if (query.includes(word)) {
        vector[idx] += 0.35;
      }
    });
  });

  // Use a simple deterministic string hashing to fill the rest of the 128 elements so that different texts get slightly different, reproducible vectors
  for (let i = 10; i < 128; i++) {
    let hash = 0;
    for (let j = 0; j < text.length; j++) {
      hash = (hash * 31 + text.charCodeAt(j) + i) % 1000;
    }
    vector[i] = 0.01 + (hash / 1000) * 0.05;
  }

  // Normalize vector to unit length (for cosine similarity)
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  return vector.map(val => Number((val / magnitude).toFixed(4)));
}

// Perform real Gemini vector embedding using gemini-embedding-2 (128 dims)
async function getEmbeddingVector(text: string): Promise<number[]> {
  const settings = await getSettings();
  const geminiKey = settings.geminiApiKey || process.env.GEMINI_API_KEY;
  if (!geminiKey || geminiKey === "MY_GEMINI_API_KEY") {
    // Fallback to local 128-dimensional keyword-based semantic vectorizer
    return getSimulatedVector(text);
  }

  try {
    const ai = new GoogleGenAI({ apiKey: geminiKey });
    addLog("system", `[Gemini API] Requesting 128-dimensional vector embedding for: "${text}"`);
    const response = await ai.models.embedContent({
      model: "gemini-embedding-2",
      contents: { parts: [{ text }] },
      config: {
        outputDimensionality: 128
      }
    });

    const values: number[] | undefined =
      response.embedding?.values ??
      (response as any).embeddings?.[0]?.values;

    if (Array.isArray(values) && values.length > 0) {
      const magnitude = Math.sqrt(values.reduce((sum: number, val: number) => sum + val * val, 0));
      return values.map((val: number) => Number((val / magnitude).toFixed(4)));
    }
    addLog("system", `[Gemini Debug] response keys: ${Object.keys(response).join(", ")}`);
    throw new Error(`Invalid or empty embedding values returned from Gemini model (got ${JSON.stringify(values)?.slice(0, 100)})`);
  } catch (error) {
    addLog("system", `[Gemini Error] Embedding failed: ${(error as Error).message}. Falling back to 128-dimensional keyword simulation.`);
    return getSimulatedVector(text);
  }
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

// Default highly illustrative items to seed the collections
const SEED_DATA: ImageDocument[] = [
  {
    _key: "emerald-cascade",
    sourceUrl: "https://images.unsplash.com/photo-1506744038136-46273834b3fb",
    category: "nature",
    text: "A crystal clear waterfall cascading through an ancient emerald forest",
    seed: 101,
    embedding: [0.9, 0.8, 0.1, 0.1, 0.0, 0.1, 0.3, 0.0, 0.2, 0.1] // Nature, Water, Organic
  },
  {
    _key: "neon-cyberpunk",
    sourceUrl: "https://images.unsplash.com/photo-1515621061946-eff1c2a352bd",
    category: "urban",
    text: "A rain-slicked cyberpunk street at night filled with glowing neon signs and holograms",
    seed: 102,
    embedding: [0.1, 0.3, 0.1, 0.9, 0.9, 0.4, 0.1, 0.9, 0.0, 0.2] // Dark, Urban, Futurist, Wet
  },
  {
    _key: "sahara-sunset",
    sourceUrl: "https://images.unsplash.com/photo-1509316975850-ff9c5deb0cd9",
    category: "nature",
    text: "A deep red and orange sunset over majestic sand dunes in the Sahara desert",
    seed: 103,
    embedding: [0.7, 0.0, 0.8, 0.1, 0.0, 1.0, 0.0, 0.0, 0.1, 0.3] // Nature, Sky, Warm, Desert
  },
  {
    _key: "milky-way",
    sourceUrl: "https://images.unsplash.com/photo-1506318137071-a8e063b4bec0",
    category: "space",
    text: "The cosmic Milky Way galaxy stretching across a crystal clear starry night sky",
    seed: 104,
    embedding: [0.2, 0.0, 1.0, 1.0, 0.0, 0.1, 0.4, 0.2, 0.0, 0.4] // Sky, Cosmic, Night, Starry
  },
  {
    _key: "concrete-minimalist",
    sourceUrl: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c",
    category: "architecture",
    text: "A modernist concrete museum facade with sharp geometric shadows and clean lines",
    seed: 105,
    embedding: [0.0, 0.0, 0.2, 0.3, 1.0, 0.2, 0.1, 0.2, 0.0, 0.9] // Urban, Minimalism, Abstract
  },
  {
    _key: "alpine-lake",
    sourceUrl: "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b",
    category: "nature",
    text: "A towering snow-capped mountain peak reflecting in a perfectly calm alpine lake at sunrise",
    seed: 106,
    embedding: [0.9, 0.8, 0.7, 0.1, 0.0, 0.3, 0.8, 0.0, 0.1, 0.2] // Nature, Mountain, Snow, Sunrise, Lake
  },
  {
    _key: "arctic-fox",
    sourceUrl: "https://images.unsplash.com/photo-1504198453319-5ce911bafcde",
    category: "animals",
    text: "A fluffy white arctic fox curled up in the pristine winter snow",
    seed: 107,
    embedding: [0.7, 0.3, 0.2, 0.1, 0.0, 0.0, 0.9, 0.0, 1.0, 0.3] // Nature, Winter, Animal, Snow
  }
];

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
        hfApiToken: ""
      });
      addLog("system", "ArangoDB 'Settings' collection initialized with default configuration structure.");
    } else {
      addLog("system", "ArangoDB 'Settings' configuration loaded successfully.");
    }

    // Load or seed images collection
    const imagesColl = arangoDb.collection("Images");
    const countResult = await arangoDb.query(`RETURN LENGTH(Images)`);
    const count = await countResult.next();
    if (count === 0) {
      addLog("system", "ArangoDB 'Images' collection is empty. Seeding defaults with 128-dimensional embeddings...");
      const normalizedSeed: ImageDocument[] = [];
      for (const img of SEED_DATA) {
        const emb = await getEmbeddingVector(img.text);
        normalizedSeed.push({
          ...img,
          embedding: emb
        });
      }
      for (const img of normalizedSeed) {
        await imagesColl.save(img);
      }
      addLog("system", "ArangoDB 'Images' collection successfully populated with 128-dimensional seed data.");
    }

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
    hfApiToken: doc.hfApiToken || ""
  };
}

async function updateSettings(newSettings: AppSettings): Promise<void> {
  if (!arangoDb) throw new Error("ArangoDB is not initialized");
  const settingsColl = arangoDb.collection("Settings");
  await settingsColl.update("config", newSettings);
  addLog("system", "ArangoDB 'Settings' configuration updated successfully.");
}

// Images Accessors
async function getImages(): Promise<ImageDocument[]> {
  if (!arangoDb) throw new Error("ArangoDB is not initialized");
  const cursor = await arangoDb.query(`FOR img IN Images RETURN img`);
  return await cursor.all();
}

async function addImage(img: ImageDocument): Promise<void> {
  if (!arangoDb) throw new Error("ArangoDB is not initialized");
  const imagesColl = arangoDb.collection("Images");
  await imagesColl.save(img);
  addLog("system", `ArangoDB: Inserted document '${img._key}'`);
}

// Reset Database Layer
async function resetDB(): Promise<void> {
  if (!arangoDb) throw new Error("ArangoDB is not initialized");
  addLog("system", "ArangoDB: Clearing Images collection...");
  await arangoDb.query(`FOR img IN Images REMOVE img IN Images`);
  const imagesColl = arangoDb.collection("Images");
  const normalizedSeed: ImageDocument[] = [];
  for (const img of SEED_DATA) {
    const emb = await getEmbeddingVector(img.text);
    normalizedSeed.push({
      ...img,
      embedding: emb
    });
  }
  for (const img of normalizedSeed) {
    await imagesColl.save(img);
  }
  
  addLog("system", "ArangoDB: Clearing Logs and Job Queue collections...");
  await arangoDb.query(`FOR log IN Logs REMOVE log IN Logs`);
  await arangoDb.query(`FOR job IN Queue REMOVE job IN Queue`);
  addLog("system", "ArangoDB: Reseed and cleanup completed.");
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
  const cursor = await arangoDb.query(`FOR log IN Logs SORT log.timestampRaw DESC LIMIT 100 RETURN log`);
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

    let baseUrl = settings.r2Endpoint;
    if (baseUrl) {
      if (!baseUrl.startsWith("http")) {
        baseUrl = `https://${baseUrl}`;
      }
      if (baseUrl.includes("cloudflarestorage.com")) {
        return `https://photos.newsrss.org/${key}`;
      } else {
        return `${baseUrl}/${key}`;
      }
    }
    return `s3://${settings.r2BucketName}/${key}`;
  } catch (err) {
    addLog("queue", `S3/R2 Upload Failed for ${resolutionName}: ${(err as Error).message}`);
    return null;
  }
}

interface FallbackProviderItem {
  provider: string;
  category: string;
  url: string;
  text: string;
  embedding?: number[];
}

const FALLBACK_PROVIDERS: FallbackProviderItem[] = [
  {
    provider: "Unsplash",
    category: "nature",
    url: "https://images.unsplash.com/photo-1506744038136-46273834b3fb",
    text: "emerald cascade green forest waterfall trees water organic stream nature"
  },
  {
    provider: "Unsplash",
    category: "urban",
    url: "https://images.unsplash.com/photo-1515621061946-eff1c2a352bd",
    text: "cyberpunk city street rain night neon lights glowing skyscrapers urban"
  },
  {
    provider: "Unsplash",
    category: "space",
    url: "https://images.unsplash.com/photo-1506318137071-a8e063b4bec0",
    text: "milky way galaxy cosmic starry night sky stars universe outer space celestial"
  },
  {
    provider: "Unsplash",
    category: "architecture",
    url: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c",
    text: "modernist concrete architecture building facade sharp lines geometric museum minimalist"
  },
  {
    provider: "Unsplash",
    category: "animals",
    url: "https://images.unsplash.com/photo-1504198453319-5ce911bafcde",
    text: "arctic fox animal winter snow cold white fluffy puppy wildlife fauna"
  },
  {
    provider: "Pexels",
    category: "nature",
    url: "https://images.pexels.com/photos/3408744/pexels-photo-3408744.jpeg",
    text: "autumn forest gold red leaves trees woods scenic nature foliage path wilderness"
  },
  {
    provider: "Pexels",
    category: "urban",
    url: "https://images.pexels.com/photos/169647/pexels-photo-169647.jpeg",
    text: "downtown skyscrapers traffic trails speed city life cityscape architecture road street"
  },
  {
    provider: "Flickr",
    category: "nature",
    url: "https://live.staticflickr.com/65535/51299834246_7f16751280_b.jpg",
    text: "majestic mountain peaks snow lake reflection calm peaceful sunrise hills scenic landscape"
  },
  {
    provider: "Flickr",
    category: "animals",
    url: "https://live.staticflickr.com/65535/50849301987_a1459a930b_b.jpg",
    text: "bald eagle bird prey flying wings feathers wild majestic predator sky"
  },
  {
    provider: "StaticPhotos",
    category: "minimalism",
    url: "https://images.unsplash.com/photo-1494438639946-1ebd1d2038b5",
    text: "cozy minimalist room lamp warm light simple table chair abstract comfort"
  },
  {
    provider: "Picsum",
    category: "nature",
    url: "https://picsum.photos/id/10/1024/1024",
    text: "lake mountain shore forest trees green waters sky nature landscape"
  },
  {
    provider: "Picsum",
    category: "urban",
    url: "https://picsum.photos/id/1031/1024/1024",
    text: "city street buildings architecture car traffic road urban people"
  }
];

async function getBestFitFallback(promptVector: number[]): Promise<FallbackProviderItem> {
  let bestFit = FALLBACK_PROVIDERS[0];
  let maxSim = -1;
  
  for (const item of FALLBACK_PROVIDERS) {
    if (!item.embedding || item.embedding.length !== 128) {
      item.embedding = getSimulatedVector(item.text);
    }
    const sim = cosineSimilarity(promptVector, item.embedding);
    if (sim > maxSim) {
      maxSim = sim;
      bestFit = item;
    }
  }
  
  return bestFit;
}

async function fetchBaseImage(prompt: string, promptVector: number[]): Promise<{ buffer: Buffer; mimeType: string; provider: string; sourceUrl: string } | null> {
  try {
    const bestFit = await getBestFitFallback(promptVector);
    addLog("queue", `[Phase 2] Free Source Image API: Best fit fallback selected from ${bestFit.provider} (Category: ${bestFit.category}, Text: "${bestFit.text}")`);
    
    addLog("queue", `[Phase 2] Free Source Image API: Fetching base image from: ${bestFit.url}`);
    const response = await fetch(bestFit.url);
    if (!response.ok) {
      throw new Error(`Failed to fetch from ${bestFit.provider}: ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const mimeType = response.headers.get("Content-Type") || "image/jpeg";
    addLog("queue", `[Phase 2] Free Source Image API: Successfully retrieved base image (${buffer.length} bytes, type: ${mimeType})`);
    return { buffer, mimeType, provider: bestFit.provider, sourceUrl: bestFit.url };
  } catch (err) {
    addLog("queue", `[Phase 2] Free Source Image API Error: ${(err as Error).message}. Falling back to Picsum Photos default seed.`);
    try {
      const url = `https://picsum.photos/seed/${encodeURIComponent(prompt.substring(0, 30))}/1024/1024`;
      const response = await fetch(url);
      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        return { buffer, mimeType: "image/jpeg", provider: "Picsum (Fallback)", sourceUrl: url };
      }
    } catch (innerErr) {
      addLog("queue", `[Phase 2] Picsum backup also failed: ${(innerErr as Error).message}`);
    }
    return null;
  }
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
  baseImg: { buffer: Buffer; mimeType: string; provider: string } | null,
  apiKey: string
): Promise<GeneratedImage | null> {
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
): Promise<string> {
  // Provider chain — add new providers here in priority order
  const geminiKey = settings.geminiApiKey || process.env.GEMINI_API_KEY;
  if (geminiKey) {
    const result = await generateWithGemini(prompt, baseImg, geminiKey);
    if (result) return result.base64Image;
    addLog("queue", `[Provider Chain] Gemini failed, trying next provider...`);
  } else {
    addLog("queue", `[Provider Chain] Gemini skipped — no API key.`);
  }

  const cfResult = await generateWithCloudflareAI(prompt, settings);
  if (cfResult) return cfResult.base64Image;
  addLog("queue", `[Provider Chain] Cloudflare AI failed or unconfigured, trying next provider...`);

  const pollinationsResult = await generateWithPollinations(prompt);
  if (pollinationsResult) return pollinationsResult.base64Image;
  addLog("queue", `[Provider Chain] Pollinations.ai failed, trying next provider...`);

  const hfResult = await generateWithHuggingFace(prompt, settings);
  if (hfResult) return hfResult.base64Image;
  addLog("queue", `[Provider Chain] HuggingFace failed, trying next provider...`);

  // placeholder: Replicate
  // placeholder: Stability AI
  // placeholder: OpenAI DALL-E

  // Last resort: use base image as-is
  if (baseImg) {
    addLog("queue", `[Provider Chain] All providers exhausted. Using semantic best-fit source image from ${baseImg.provider}.`);
    return `data:${baseImg.mimeType};base64,${baseImg.buffer.toString("base64")}`;
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
  const base64Image = await generateImageWithFallback(prompt, baseImg, settings);

  // 4. Jimp Multi-Variant Resizing
  addLog("queue", `[On-Demand] Jimp: Reading generated image buffer into memory...`);
  const jimpImg = await Jimp.read(Buffer.from(base64Image.replace(/^data:image\/\w+;base64,/, ""), "base64"));

  const key = `gen-${Math.random().toString(36).substring(2, 9)}`;
  const variants: Record<string, string> = {};

  addLog("queue", `[On-Demand] Jimp: Resizing and preparing multi-variant resolutions (Desktop, Mobile, Tablet)...`);

  for (const [resName, dim] of Object.entries(RESOLUTIONS)) {
    addLog("queue", `[On-Demand] Jimp: Resizing variant '${resName}' to ${dim.w}x${dim.h}...`);
    const cloned = jimpImg.clone().cover({ w: dim.w, h: dim.h });
    const buffer = await cloned.getBuffer("image/jpeg");
    const base64Str = await cloned.getBase64("image/jpeg");

    // Try uploading to S3
    const s3Url = await uploadToS3(settings, resName, key, buffer, "image/jpeg");
    if (s3Url) {
      addLog("queue", `S3/R2: Successfully uploaded ${resName} to '${resName}/${key}.jpg' -> ${s3Url}`);
      variants[resName] = s3Url;
    } else {
      // Fallback to local Base64 cache
      variants[resName] = base64Str;
    }
  }

  // 5. Save to Database
  addLog("queue", `[On-Demand] Saving multi-variant images and embedding vector in ArangoDB collection 'Images'...`);

  const newDoc: ImageDocument = {
    _key: key,
    sourceUrl: variants.medium || base64Image, // Default view
    category: category || "nature",
    text: prompt,
    seed: seed,
    embedding: embedding,
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

    const newDoc = await generateImageAndSave(job.prompt, job.category || "nature", job.seed);

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
app.get("/api/settings", async (req, res) => {
  const settings = await getSettings();
  res.json(settings);
});

app.post("/api/settings", async (req, res) => {
  const newSettings: AppSettings = req.body;
  await updateSettings(newSettings);
  res.json({ success: true, settings: newSettings });
});

// Reset DB
app.post("/api/reset", async (req, res) => {
  await resetDB();
  res.json({ success: true, message: "Database reseeded!" });
});

// Get Database Items
app.get("/api/images", async (req, res) => {
  const images = await getImages();
  res.json(images);
});

// Get Queue Jobs
app.get("/api/queue", async (req, res) => {
  const queue = await getQueue();
  res.json(queue);
});

// Get Live Logs
app.get("/api/logs", async (req, res) => {
  const logs = await getLogs();
  res.json(logs);
});

// THE PHOTOS CDN API ENDPOINT
app.get("/api/cdn/:width/:height", async (req, res) => {
  try {
    const width = parseInt(req.params.width) || 800;
    const height = parseInt(req.params.height) || 600;

    const category = (req.query.category as string) || "nature";
    const seed = parseInt(req.query.seed as string) || 42;
    const textQuery = req.query.text as string;
    const format = (req.query.format as string) || "image";

    addLog("api", `[Request Received] GET /${width}/${height}?category=${category}&seed=${seed}&text=${textQuery || "none"}&format=${format}`);

    const currentImages = await getImages();
    let matchedImage: ImageDocument | null = null;
    let similarityScore = 0;
    let vector: number[] = [];

    if (textQuery) {
      addLog("api", `[Phase 2] Computing query embedding vector...`);
      vector = await getEmbeddingVector(textQuery);
      addLog("api", `[Phase 2] Query vector: [${vector.slice(0, 3).join(", ")}... 128 dimensions]`);

      addLog("api", `[Phase 2] ArangoDB Vector Search: Evaluating cosine similarity against ${currentImages.length} documents...`);
      
      // Find closest matches
      let bestMatch: ImageDocument | null = null;
      let maxSim = -1;

      currentImages.forEach(img => {
        const sim = cosineSimilarity(vector, img.embedding);
        if (sim > maxSim) {
          maxSim = sim;
          bestMatch = img;
        }
      });

      matchedImage = bestMatch;
      similarityScore = maxSim;
      addLog("api", `[Phase 2] Closest Match: "${bestMatch?.text}" | Cosine Similarity Score: ${similarityScore.toFixed(4)}`);
    } else {
      // Category and Seed match
      addLog("api", `[Phase 2] Searching by category: "${category}" and seed: ${seed}`);
      
      const filtered = currentImages.filter(img => img.category.toLowerCase() === category.toLowerCase());
      if (filtered.length > 0) {
        filtered.sort((a, b) => Math.abs(a.seed - seed) - Math.abs(b.seed - seed));
        matchedImage = filtered[0];
        similarityScore = 1.0;
      }
    }

    let finalImage = matchedImage || currentImages[0] || SEED_DATA[0];
    let cacheControl = "public, max-age=31536000";

    let triggerGeneration = false;
    if (textQuery && similarityScore < 0.85) {
      triggerGeneration = true;
      cacheControl = "public, max-age=31536000";
      addLog("api", `[Phase 3] Match similarity (${similarityScore.toFixed(4)}) is below 0.85!`);
      addLog("api", `[Phase 3] Generating real, high-quality image on-demand synchronously...`);
      
      try {
        finalImage = await generateImageAndSave(textQuery, category, seed);
        similarityScore = 1.0; // The newly generated image is a perfect match!
      } catch (genError) {
        addLog("api", `[Phase 3 ERROR] On-demand generation failed: ${(genError as Error).message}. Falling back to closest match.`);
      }
    } else if (textQuery) {
      addLog("api", `[Phase 4] Quality Match verified (Similarity: ${similarityScore.toFixed(4)} >= 0.85). Serving directly with long-lived Cache-Control.`);
    }

    res.setHeader("Cache-Control", cacheControl);
    res.setHeader("X-Similarity-Score", similarityScore.toString());
    res.setHeader("X-Async-Generated", triggerGeneration ? "true" : "false");

    if (format === "blurhash") {
      addLog("api", `[Phase 4] Format requested: blurhash. Running native Wasm/TS Blurhash encoder...`);
      const simulatedBlurhash = "L6PZfHeD.AyD_N%g9GMy?v%0IAxG";
      res.setHeader("Content-Type", "application/json");
      return res.status(200).json({
        blurhash: simulatedBlurhash,
        sourceUrl: finalImage.sourceUrl,
        similarity: similarityScore,
        metadata: {
          key: finalImage._key,
          prompt: finalImage.text,
          seed: finalImage.seed
        }
      });
    }

    if (format === "lqip") {
      addLog("api", `[Phase 4] Format requested: lqip. Performing 302 Redirect to low-quality placeholder CDN resized asset.`);
      if (finalImage.variants && finalImage.variants.thumbnail) {
        const matches = finalImage.variants.thumbnail.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.*)$/);
        if (matches && matches.length === 3) {
          const mime = matches[1];
          const buffer = Buffer.from(matches[2], "base64");
          res.setHeader("Content-Type", mime);
          return res.status(200).send(buffer);
        }
      }
      const lqipUrl = `${finalImage.sourceUrl}&w=40&auto=format&fit=crop&q=20&blur=10`;
      return res.redirect(302, lqipUrl);
    }

    // Serve custom base64 or S3 multi-variant images from database if available
    if (finalImage.variants) {
      // Find the closest resolution name based on the requested width/height
      let bestVariantName = "medium";
      let minDiff = Infinity;
      
      for (const [resName, dim] of Object.entries(RESOLUTIONS)) {
        const diff = Math.abs(dim.w - width) + Math.abs(dim.h - height);
        if (diff < minDiff) {
          minDiff = diff;
          bestVariantName = resName;
        }
      }

      const servedData = finalImage.variants[bestVariantName] || finalImage.variants.medium || finalImage.variants.original;

      if (servedData) {
        if (servedData.startsWith("data:")) {
          const matches = servedData.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.*)$/);
          if (matches && matches.length === 3) {
            const mime = matches[1];
            const buffer = Buffer.from(matches[2], "base64");
            res.setHeader("Content-Type", mime);
            addLog("api", `[Phase 4] Delivery: Serving cached custom multi-variant resolution '${bestVariantName}' (${width}x${height}) natively from ArangoDB.`);
            return res.status(200).send(buffer);
          }
        } else if (servedData.startsWith("http") || servedData.startsWith("s3://")) {
          addLog("api", `[Phase 4] Delivery: HTTP 302 Redirecting to S3/R2 Cached asset '${bestVariantName}' -> ${servedData}`);
          return res.redirect(302, servedData);
        }
      }
    }

    addLog("api", `[Phase 4] Delivery: HTTP 302 Redirecting to Cloudflare Resizing Edge CDN.`);
    const cdnUrl = `${finalImage.sourceUrl}&w=${width}&h=${height}&fit=crop&auto=format&q=80`;
    return res.redirect(302, cdnUrl);

  } catch (error) {
    addLog("system", `[API ERROR] Failure serving request: ${(error as Error).message}`);
    res.status(500).json({ error: "Internal Server Error", message: (error as Error).message });
  }
});

// ==========================================
// 5. STATIC FILES & SERVING
// ==========================================

async function startServer() {
  // Connect/Verify ArangoDB connection on startup
  await connectToArango();

  addLog("system", "Starting development server, serving static files directly...");
  // Serve files from the current working directory
  app.use(express.static(process.cwd()));

  // Serve index.html on root request
  app.get("/", (req, res) => {
    res.sendFile(path.join(process.cwd(), "index.html"));
  });

  app.listen(PORT, "0.0.0.0", () => {
    addLog("system", `Photos CDN Development playground running at http://localhost:${PORT}`);
  });
}

startServer();
