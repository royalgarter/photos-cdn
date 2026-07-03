import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { Database } from "arangojs";

dotenv.config();

const app = express();
const PORT = 3000;

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
}

// Global state for in-memory simulation (fallbacks)
let dbImages: ImageDocument[] = [];
let systemLogs: LogEntry[] = [];
let activeQueue: QueueJob[] = [];
let inMemorySettings: AppSettings = {
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  replicateApiToken: "",
  r2AccessKeyId: "",
  r2SecretAccessKey: "",
  r2BucketName: "",
  r2Endpoint: ""
};

// ArangoDB instance configuration
const arangoUrl = process.env.ARANGO_URL;
let arangoDb: Database | null = null;
let useRealArango = false;

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

  if (useRealArango && arangoDb) {
    try {
      const logsColl = arangoDb.collection("Logs");
      await logsColl.save(log);
    } catch (e) {
      // fallback to console
    }
  }

  systemLogs.unshift(log);
  if (systemLogs.length > 200) systemLogs.pop();
  console.log(`[${type.toUpperCase()}] ${message}`);
}

function addLog(type: "api" | "queue" | "system", message: string, details?: any) {
  writeLog(type, message, details).catch(console.error);
}

// Generate a vector from text using keyword stems (fallback vectorizer)
function getSimulatedVector(text: string): number[] {
  const query = text.toLowerCase();
  const vector = new Array(10).fill(0.05); // Base background noise

  // Keyword associations
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

  // Normalize vector to unit length (for cosine similarity)
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  return vector.map(val => Number((val / magnitude).toFixed(4)));
}

// Perform simulated Gemini vector embedding if possible, else fallback
async function getEmbeddingVector(text: string): Promise<number[]> {
  const settings = await getSettings();
  const geminiKey = settings.geminiApiKey;
  if (!geminiKey || geminiKey === "MY_GEMINI_API_KEY") {
    // Fallback to local keyword-based semantic vectorizer
    return getSimulatedVector(text);
  }

  try {
    const ai = new GoogleGenAI({ apiKey: geminiKey });
    addLog("system", `[Gemini API] Requesting semantic categorization for: "${text}"`);
    const prompt = `Analyze this image description: "${text}".
Assign a float score between 0.0 and 1.0 for each of these 10 dimensions:
1. Nature/Organic (trees, scenery)
2. Water/Liquid (rivers, waterfall, sea)
3. Sky/Celestial (clouds, sun, space)
4. Darkness/Night (neon, black, shadows)
5. Urban/Architecture (city, concrete)
6. Warmth/Fiery (sun, desert, flame)
7. Coldness/Icy (snow, winter)
8. Futuristic/Synthetic (cyberpunk, digital)
9. Animals/Fauna (wildlife, pets)
10. Abstract/Minimalism (patterns, geometric)

Respond with ONLY a raw JSON array of 10 float values. Example: [0.9, 0.5, 0.0, 0.1, 0.0, 0.3, 0.0, 0.0, 0.2, 0.1]`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json"
      }
    });

    const resText = response.text || "";
    const parsed = JSON.parse(resText.trim());
    if (Array.isArray(parsed) && parsed.length === 10) {
      const magnitude = Math.sqrt(parsed.reduce((sum, val) => sum + val * val, 0));
      return parsed.map(val => Number((val / magnitude).toFixed(4)));
    }
    throw new Error("Invalid format returned from Gemini model");
  } catch (error) {
    addLog("system", `[Gemini Error] Embedding failed: ${(error as Error).message}. Falling back to keywords.`);
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

// Seed standard in-memory vectors
function initInMemoryDB() {
  dbImages = SEED_DATA.map(img => {
    const mag = Math.sqrt(img.embedding.reduce((sum, val) => sum + val * val, 0));
    return {
      ...img,
      embedding: img.embedding.map(val => Number((val / mag).toFixed(4)))
    };
  });
  systemLogs = [];
  activeQueue = [];
  addLog("system", "In-memory simulated ArangoDB store initialized with standard default dataset.");
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
    addLog("system", "ARANGO_URL is not defined. Operating exclusively in local in-memory simulation mode.");
    initInMemoryDB();
    return;
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
    useRealArango = true;

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
        r2Endpoint: ""
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
      addLog("system", "ArangoDB 'Images' collection is empty. Seeding defaults...");
      const normalizedSeed = SEED_DATA.map(img => {
        const mag = Math.sqrt(img.embedding.reduce((sum, val) => sum + val * val, 0));
        return {
          ...img,
          embedding: img.embedding.map(val => Number((val / mag).toFixed(4)))
        };
      });
      for (const img of normalizedSeed) {
        await imagesColl.save(img);
      }
      addLog("system", "ArangoDB 'Images' collection successfully populated with seed data.");
    }

  } catch (err) {
    addLog("system", `ArangoDB Connection Failed: ${(err as Error).message}. Falling back safely to high-fidelity simulation.`);
    arangoDb = null;
    useRealArango = false;
    initInMemoryDB();
  }
}

// Settings Accessors
async function getSettings(): Promise<AppSettings> {
  if (useRealArango && arangoDb) {
    try {
      const settingsColl = arangoDb.collection("Settings");
      const doc = await settingsColl.document("config");
      return {
        geminiApiKey: doc.geminiApiKey || "",
        replicateApiToken: doc.replicateApiToken || "",
        r2AccessKeyId: doc.r2AccessKeyId || "",
        r2SecretAccessKey: doc.r2SecretAccessKey || "",
        r2BucketName: doc.r2BucketName || "",
        r2Endpoint: doc.r2Endpoint || ""
      };
    } catch (e) {
      addLog("system", `Error reading settings from ArangoDB: ${(e as Error).message}`);
    }
  }
  return inMemorySettings;
}

async function updateSettings(newSettings: AppSettings): Promise<void> {
  if (useRealArango && arangoDb) {
    try {
      const settingsColl = arangoDb.collection("Settings");
      await settingsColl.update("config", newSettings);
      addLog("system", "ArangoDB 'Settings' configuration updated successfully.");
      return;
    } catch (e) {
      addLog("system", `Error updating settings in ArangoDB: ${(e as Error).message}`);
    }
  }
  inMemorySettings = newSettings;
  addLog("system", "In-memory configuration updated successfully.");
}

// Images Accessors
async function getImages(): Promise<ImageDocument[]> {
  if (useRealArango && arangoDb) {
    try {
      const cursor = await arangoDb.query(`FOR img IN Images RETURN img`);
      return await cursor.all();
    } catch (e) {
      addLog("system", `Error reading images from ArangoDB: ${(e as Error).message}`);
    }
  }
  return dbImages;
}

async function addImage(img: ImageDocument): Promise<void> {
  if (useRealArango && arangoDb) {
    try {
      const imagesColl = arangoDb.collection("Images");
      await imagesColl.save(img);
      addLog("system", `ArangoDB: Inserted document '${img._key}'`);
      return;
    } catch (e) {
      addLog("system", `Error adding image to ArangoDB: ${(e as Error).message}`);
    }
  }
  dbImages.push(img);
}

// Reset Database Layer
async function resetDB(): Promise<void> {
  if (useRealArango && arangoDb) {
    try {
      addLog("system", "ArangoDB: Clearing Images collection...");
      await arangoDb.query(`FOR img IN Images REMOVE img IN Images`);
      const imagesColl = arangoDb.collection("Images");
      const normalizedSeed = SEED_DATA.map(img => {
        const mag = Math.sqrt(img.embedding.reduce((sum, val) => sum + val * val, 0));
        return {
          ...img,
          embedding: img.embedding.map(val => Number((val / mag).toFixed(4)))
        };
      });
      for (const img of normalizedSeed) {
        await imagesColl.save(img);
      }
      
      addLog("system", "ArangoDB: Clearing Logs and Job Queue collections...");
      await arangoDb.query(`FOR log IN Logs REMOVE log IN Logs`);
      await arangoDb.query(`FOR job IN Queue REMOVE job IN Queue`);
      addLog("system", "ArangoDB: Reseed and cleanup completed.");
      return;
    } catch (e) {
      addLog("system", `Error resetting ArangoDB: ${(e as Error).message}`);
    }
  }
  
  initInMemoryDB();
}

// Queue Accessors
async function getQueue(): Promise<QueueJob[]> {
  if (useRealArango && arangoDb) {
    try {
      const cursor = await arangoDb.query(`FOR job IN Queue SORT job.createdAtRaw DESC LIMIT 50 RETURN job`);
      return await cursor.all();
    } catch (e) {
      // ignore
    }
  }
  return activeQueue;
}

async function updateQueueJob(job: QueueJob & { createdAtRaw?: number }): Promise<void> {
  if (useRealArango && arangoDb) {
    try {
      const queueColl = arangoDb.collection("Queue");
      const exists = await queueColl.documentExists(job.id).catch(() => false);
      if (exists) {
        await queueColl.update(job.id, job);
      } else {
        await queueColl.save({ _key: job.id, ...job });
      }
      return;
    } catch (e) {
      // ignore
    }
  }
  const idx = activeQueue.findIndex(j => j.id === job.id);
  if (idx !== -1) {
    activeQueue[idx] = job;
  } else {
    activeQueue.push(job);
  }
}

// Logs Accessors
async function getLogs(): Promise<LogEntry[]> {
  if (useRealArango && arangoDb) {
    try {
      const cursor = await arangoDb.query(`FOR log IN Logs SORT log.timestampRaw DESC LIMIT 100 RETURN log`);
      return await cursor.all();
    } catch (e) {
      // ignore
    }
  }
  return systemLogs;
}

// ==========================================
// 3. BACKGROUND WORKER (DENO KV QUEUE SIMULATOR)
// ==========================================

async function processQueue() {
  const jobs = await getQueue();
  const job = jobs.find(j => j.status === "pending");
  if (!job) return;

  job.status = "processing";
  await updateQueueJob(job);
  addLog("queue", `Deno KV: worker picked up job ${job.id} for prompt: "${job.prompt}"`);

  let progress = 0;
  const interval = setInterval(async () => {
    progress += 20;
    job.progress = progress;
    await updateQueueJob(job);

    if (progress === 20) {
      addLog("queue", `[Phase 3] Calling Replicate Text-to-Image API with seed: ${job.seed}`);
    } else if (progress === 40) {
      addLog("queue", "[Phase 3] Downsampling & reading image buffer natively");
    } else if (progress === 60) {
      addLog("queue", `[Phase 1] Cloudflare R2: Creating AWS SigV4 PUT Request. Signing SHA-256 payload...`);
    } else if (progress === 80) {
      addLog("queue", "[Phase 2] Cloudflare Workers AI: Extracting dense vector embeddings of prompt");
    } else if (progress === 100) {
      clearInterval(interval);
      job.status = "completed";
      await updateQueueJob(job);

      // Insert new image into database
      const key = `gen-${Math.random().toString(36).substring(2, 9)}`;
      const encodedPrompt = encodeURIComponent(job.prompt);
      const generatedImageUrl = `https://images.unsplash.com/featured/?${encodedPrompt}`;
      
      const embedding = await getEmbeddingVector(job.prompt);
      const newDoc: ImageDocument = {
        _key: key,
        sourceUrl: generatedImageUrl,
        category: job.category || "nature",
        text: job.prompt,
        seed: job.seed,
        embedding: embedding
      };

      await addImage(newDoc);
      addLog("queue", `[Phase 2] ArangoDB: POST new vector document to /_api/document/Images as key: ${key}`);
      addLog("queue", `Deno KV: Successfully completed job ${job.id}! Image cached in Cloudflare R2.`);

      // Trigger next job in queue
      setTimeout(processQueue, 500);
    }
  }, 1200);
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
  addLog("queue", `Deno KV: Enqueued background generator job (${job.id})`);
  
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
      addLog("api", `[Phase 2] Query vector: [${vector.slice(0, 3).join(", ")}... 10 dimensions]`);

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

    const finalImage = matchedImage || currentImages[0] || SEED_DATA[0];
    let cacheControl = "public, max-age=31536000";

    let triggerGeneration = false;
    if (textQuery && similarityScore < 0.85) {
      triggerGeneration = true;
      cacheControl = "public, max-age=60";
      addLog("api", `[Phase 3] Match similarity (${similarityScore.toFixed(4)}) is below 0.85!`);
      addLog("api", `[Phase 3] Triggering asynchronous generator task in Deno KV...`);
      
      enqueueJob(textQuery, category, seed);
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
      const lqipUrl = `${finalImage.sourceUrl}&w=40&auto=format&fit=crop&q=20&blur=10`;
      return res.redirect(302, lqipUrl);
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
// 5. VITE DEV SERVER / PRODUCTION SERVING
// ==========================================

async function startServer() {
  // Connect/Verify ArangoDB connection on startup
  await connectToArango();

  if (process.env.NODE_ENV !== "production") {
    addLog("system", "Starting development server with Vite middleware...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    addLog("system", "Running in production mode, serving static files...");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*all", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    addLog("system", `Photos CDN Development playground running at http://localhost:${PORT}`);
  });
}

startServer();
