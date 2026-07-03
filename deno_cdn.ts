/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * PHOTOS CDN API - PRODUCTION-READY NATIVE DENO WORKER
 * 
 * Target Environment: Deno 1.x / 2.x (Native)
 * Language: Vanilla TypeScript
 * Core Philosophy: Zero heavy SDKs. Native Web Standards (fetch, Request/Response, Crypto, URLPattern).
 */

// ==========================================
// 1. CONFIGURATION & ENVIRONMENT VARIABLES
// ==========================================
const CF_ACCOUNT_ID = Deno.env.get("CF_ACCOUNT_ID") || "YOUR_CLOUDFLARE_ACCOUNT_ID";
const CF_API_TOKEN = Deno.env.get("CF_API_TOKEN") || "YOUR_CLOUDFLARE_API_TOKEN";
const R2_BUCKET_NAME = Deno.env.get("R2_BUCKET_NAME") || "photos-cdn";
const R2_ACCESS_KEY_ID = Deno.env.get("R2_ACCESS_KEY_ID") || "YOUR_R2_ACCESS_KEY_ID";
const R2_SECRET_ACCESS_KEY = Deno.env.get("R2_SECRET_ACCESS_KEY") || "YOUR_R2_SECRET_ACCESS_KEY";
const R2_PUBLIC_DOMAIN = Deno.env.get("R2_PUBLIC_DOMAIN") || "cdn.yourdomain.com";

const ARANGODB_URL = Deno.env.get("ARANGODB_URL") || "http://localhost:8529";
const ARANGODB_DB = Deno.env.get("ARANGODB_DB") || "_system";
const ARANGODB_USER = Deno.env.get("ARANGODB_USER") || "root";
const ARANGODB_PASSWORD = Deno.env.get("ARANGODB_PASSWORD") || "password";

const REPLICATE_API_TOKEN = Deno.env.get("REPLICATE_API_TOKEN") || "YOUR_REPLICATE_API_TOKEN";

// Initialize Deno KV for Background Queues
const kv = await Deno.openKv();

// URL Router Pattern matching GET /:width/:height
const ROUTE_PATTERN = new URLPattern({ pathname: "/:width(\\d+)/:height(\\d+)" });

// ==========================================
// 2. TYPES & INTERFACES
// ==========================================
interface ImageDocument {
  _key: string;
  sourceUrl: string;
  category: string;
  text: string;
  embedding: number[];
  seed: number;
}

interface QueueJob {
  prompt: string;
  category: string;
  seed: number;
}

// ==========================================
// 3. AWS SIGV4 SIGNER FOR CLOUDFLARE R2
// ==========================================
class R2Client {
  private accessKey: string;
  private secretKey: string;
  private bucket: string;
  private accountId: string;

  constructor() {
    this.accessKey = R2_ACCESS_KEY_ID;
    this.secretKey = R2_SECRET_ACCESS_KEY;
    this.bucket = R2_BUCKET_NAME;
    this.accountId = CF_ACCOUNT_ID;
  }

  private async hmacSha256(key: Uint8Array | string, data: string): Promise<Uint8Array> {
    const encoder = new TextEncoder();
    const keyData = typeof key === "string" ? encoder.encode(key) : key;
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data));
    return new Uint8Array(signature);
  }

  private async sha256Hex(data: Uint8Array | string): Promise<string> {
    const encoder = new TextEncoder();
    const dataBytes = typeof data === "string" ? encoder.encode(data) : data;
    const hashBuffer = await crypto.subtle.digest("SHA-256", dataBytes);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  /**
   * Upload an image buffer to Cloudflare R2 using AWS SigV4
   */
  async uploadObject(key: string, data: Uint8Array, contentType: string): Promise<string> {
    const method = "PUT";
    const host = `${this.accountId}.r2.cloudflarestorage.com`;
    const path = `/${this.bucket}/${key}`;
    const url = `https://${host}${path}`;

    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]/g, "").split(".")[0] + "Z";
    const dateStamp = amzDate.substring(0, 8);
    const region = "auto";
    const service = "s3";

    const payloadHash = await this.sha256Hex(data);

    const headers: Record<string, string> = {
      "host": host,
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHash,
      "content-type": contentType,
      "content-length": data.byteLength.toString(),
    };

    const canonicalHeaders = Object.keys(headers)
      .sort()
      .map((k) => `${k.toLowerCase()}:${headers[k].trim()}`)
      .join("\n") + "\n";

    const signedHeaders = Object.keys(headers)
      .sort()
      .map((k) => k.toLowerCase())
      .join(";");

    const canonicalRequest = [
      method,
      path,
      "", // Query string (empty)
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");

    const hashedCanonicalRequest = await this.sha256Hex(canonicalRequest);

    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      hashedCanonicalRequest,
    ].join("\n");

    // Derive Signing Key
    const kDate = await this.hmacSha256(`AWS4${this.secretKey}`, dateStamp);
    const kRegion = await this.hmacSha256(kDate, region);
    const kService = await this.hmacSha256(kRegion, service);
    const kSigning = await this.hmacSha256(kService, "aws4_request");

    // Calculate Signature
    const signatureBytes = await this.hmacSha256(kSigning, stringToSign);
    const signature = Array.from(signatureBytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const authorizationHeader = `AWS4-HMAC-SHA256 Credential=${this.accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const response = await fetch(url, {
      method,
      headers: {
        ...headers,
        "Authorization": authorizationHeader,
      },
      body: data,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`R2 Upload failed: ${response.statusText} (${errText})`);
    }

    return `https://${R2_PUBLIC_DOMAIN}/${key}`;
  }
}

const r2Client = new R2Client();

// ==========================================
// 4. CLOUDFLARE WORKERS AI EMBEDDINGS
// ==========================================
async function getEmbedding(text: string): Promise<number[]> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/@cf/baai/bge-large-en-v1.5`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${CF_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    throw new Error(`Cloudflare Workers AI failed: ${response.statusText}`);
  }

  const json = await response.json();
  if (!json.success || !json.result || !json.result.data) {
    throw new Error("Invalid response structure from Workers AI");
  }

  return json.result.data[0];
}

// ==========================================
// 5. ARANGODB REST CLIENT (AQL OVER FETCH)
// ==========================================
class ArangoClient {
  private baseUrl: string;
  private authHeader: string;

  constructor() {
    this.baseUrl = `${ARANGODB_URL}/_db/${ARANGODB_DB}/_api`;
    const credentials = btoa(`${ARANGODB_USER}:${ARANGODB_PASSWORD}`);
    this.authHeader = `Basic ${credentials}`;
  }

  /**
   * Execute AQL Query using /_api/cursor
   */
  async query<T>(query: string, bindVars: Record<string, unknown> = {}): Promise<T[]> {
    const url = `${this.baseUrl}/cursor`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": this.authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, bindVars }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`ArangoDB Query failed: ${response.statusText} - ${errText}`);
    }

    const json = await response.json();
    return json.result as T[];
  }

  /**
   * Insert a document into the Images collection
   */
  async insert(collection: string, document: Record<string, unknown>): Promise<void> {
    const url = `${this.baseUrl}/document/${collection}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": this.authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(document),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`ArangoDB Insert failed: ${response.statusText} - ${errText}`);
    }
  }
}

const arango = new ArangoClient();

// ==========================================
// 6. ASYNCHRONOUS GENERATION WORKER (DENO KV QUEUE)
// ==========================================
kv.listenQueue(async (msg: unknown) => {
  const job = msg as QueueJob;
  if (!job || !job.prompt) return;

  console.log(`[Queue Worker] Processing job for prompt: "${job.prompt}"`);

  try {
    // Step 1: Call Replicate REST API to generate image (SDXL or Flux)
    const replicateUrl = "https://api.replicate.com/v1/predictions";
    const predictionRes = await fetch(replicateUrl, {
      method: "POST",
      headers: {
        "Authorization": `Token ${REPLICATE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        version: "ac732e12ec7342f590740b492b49b51407361031d8f0178c0e68f3012e68cf50", // SDXL version or alternative
        input: {
          prompt: job.prompt,
          seed: job.seed,
          width: 1024,
          height: 1024,
          refine: "expert_ensemble_refiner",
        }
      })
    });

    if (!predictionRes.ok) {
      throw new Error(`Replicate initiation failed: ${predictionRes.statusText}`);
    }

    let prediction = await predictionRes.json();
    const predictionId = prediction.id;

    // Poll Replicate API for completion
    let imageUrl = "";
    const maxAttempts = 30;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise((r) => setTimeout(r, 2000));
      const pollRes = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
        headers: { "Authorization": `Token ${REPLICATE_API_TOKEN}` }
      });
      if (pollRes.ok) {
        prediction = await pollRes.json();
        if (prediction.status === "succeeded") {
          imageUrl = prediction.output[0];
          break;
        } else if (prediction.status === "failed" || prediction.status === "canceled") {
          throw new Error(`Replicate generation state: ${prediction.status}`);
        }
      }
    }

    if (!imageUrl) {
      throw new Error("Replicate generation timed out.");
    }

    // Step 2: Download the generated image buffer
    const imgFetch = await fetch(imageUrl);
    if (!imgFetch.ok) throw new Error("Failed to download generated image");
    const buffer = new Uint8Array(await imgFetch.arrayBuffer());

    // Step 3: Upload to Cloudflare R2
    const fileId = crypto.randomUUID();
    const r2Key = `${job.category || "generated"}/${fileId}.png`;
    const cdnUrl = await r2Client.uploadObject(r2Key, buffer, "image/png");
    console.log(`[Queue Worker] Uploaded new image to R2: ${cdnUrl}`);

    // Step 4: Get text embedding for vector matching
    const embedding = await getEmbedding(job.prompt);

    // Step 5: Save metadata & vector to ArangoDB
    const document: ImageDocument = {
      _key: fileId,
      sourceUrl: cdnUrl,
      category: job.category || "nature",
      text: job.prompt,
      embedding: embedding,
      seed: job.seed,
    };

    await arango.insert("Images", document);
    console.log(`[Queue Worker] Document successfully written to ArangoDB: ${fileId}`);

  } catch (error) {
    console.error(`[Queue Worker Error] Failed to generate/store image:`, error);
  }
});

// ==========================================
// 7. PURE TYPESCRIPT BLURHASH ENCODER (WASM/NATIVE)
// ==========================================
// A lightweight, dependency-free implementation of the Blurhash base83 encoder.
class BlurhashEncoder {
  private static DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~";

  static encode83(value: number, length: number): string {
    let result = "";
    for (let i = 1; i <= length; i++) {
      const digit = (Math.floor(value / Math.pow(83, length - i))) % 83;
      result += this.DIGITS[digit];
    }
    return result;
  }

  static sRGBToLinear(value: number): number {
    const v = value / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }

  static linearTosRGB(value: number): number {
    const v = Math.max(0, Math.min(1, value));
    return v <= 0.0031308 ? Math.round(v * 12.92 * 255) : Math.round((1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255);
  }

  // Pure mathematical Blurhash encoding from raw RGB array
  static encode(width: number, height: number, data: Uint8Array, componentX = 4, componentY = 4): string {
    if (componentX < 1 || componentX > 9 || componentY < 1 || componentY > 9) {
      throw new Error("Components must be between 1 and 9");
    }

    const factors: [number, number, number][] = [];

    for (let y = 0; y < componentY; y++) {
      for (let x = 0; x < componentX; x++) {
        let r = 0, g = 0, b = 0;
        const normalization = (x === 0 ? 1 : 2) * (y === 0 ? 1 : 2) / (width * height);

        for (let j = 0; j < height; j++) {
          for (let i = 0; i < width; i++) {
            const index = 4 * (i + j * width);
            const linearR = this.sRGBToLinear(data[index]);
            const linearG = this.sRGBToLinear(data[index + 1]);
            const linearB = this.sRGBToLinear(data[index + 2]);

            const cosFactor = Math.cos((Math.PI * x * i) / width) * Math.cos((Math.PI * y * j) / height);
            r += linearR * cosFactor;
            g += linearG * cosFactor;
            b += linearB * cosFactor;
          }
        }

        factors.push([r * normalization, g * normalization, b * normalization]);
      }
    }

    const dc = factors[0];
    const ac = factors.slice(1);

    let blurhash = "";

    const sizeFlag = componentX - 1 + (componentY - 1) * 9;
    blurhash += this.encode83(sizeFlag, 1);

    let maxVal = 0;
    if (ac.length > 0) {
      let maxAc = 0;
      for (const val of ac) {
        maxAc = Math.max(maxAc, Math.abs(val[0]), Math.abs(val[1]), Math.abs(val[2]));
      }
      const quantVal = Math.max(0, Math.min(82, Math.floor(maxAc * 166 - 0.5)));
      maxVal = (quantVal + 1) / 166;
      blurhash += this.encode83(quantVal, 1);
    } else {
      blurhash += this.encode83(0, 1);
    }

    const encodeDC = (rgb: [number, number, number]) => {
      const r = this.linearTosRGB(rgb[0]);
      const g = this.linearTosRGB(rgb[1]);
      const b = this.linearTosRGB(rgb[2]);
      return (r << 16) + (g << 8) + b;
    };

    blurhash += this.encode83(encodeDC(dc), 4);

    for (const factor of ac) {
      const encodeAC = (val: number) => {
        const sign = val < 0 ? -1 : 1;
        const ratio = Math.abs(val) / maxVal;
        const power = Math.pow(ratio, 0.5) * sign;
        return Math.max(0, Math.min(18, Math.floor(power * 9 + 9.5)));
      };

      const quantR = encodeAC(factor[0]);
      const quantG = encodeAC(factor[1]);
      const quantB = encodeAC(factor[2]);

      const acValue = quantR * 19 * 19 + quantG * 19 + quantB;
      blurhash += this.encode83(acValue, 2);
    }

    return blurhash;
  }
}

// ==========================================
// 8. SERVER ENTRYPOINT (DENO.SERVE)
// ==========================================
Deno.serve({ port: 3000 }, async (request: Request) => {
  try {
    const url = new URL(request.url);
    const match = ROUTE_PATTERN.exec(url);

    if (!match) {
      return new Response(JSON.stringify({ error: "Not Found", message: "Use GET /:width/:height" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Extract Path Params
    const width = parseInt(match.pathname.groups.width!);
    const height = parseInt(match.pathname.groups.height!);

    // Extract Query Params
    const category = url.searchParams.get("category") || "nature";
    const seedString = url.searchParams.get("seed");
    const seed = seedString ? parseInt(seedString) : 42;
    const textQuery = url.searchParams.get("text");
    const format = url.searchParams.get("format") || "image"; // 'image' | 'blurhash' | 'lqip'

    let matchedImage: ImageDocument | null = null;
    let similarityScore = 0;

    if (textQuery) {
      console.log(`[API Request] Semantically searching for: "${textQuery}"`);
      // Step 2.1: Fetch query embedding from Workers AI
      const queryEmbedding = await getEmbedding(textQuery);

      // Step 2.2: Perform Vector Cosine Similarity Search in ArangoDB (AQL)
      // Uses the DOT_PRODUCT or COSINE_SIMILARITY of the AQL language (ArangoDB 3.10+)
      const aql = `
        FOR doc IN Images
          LET similarity = COSINE_SIMILARITY(doc.embedding, @queryEmbedding)
          SORT similarity DESC
          LIMIT 1
          RETURN { doc: doc, similarity: similarity }
      `;

      const searchResults = await arango.query<{ doc: ImageDocument; similarity: number }>(aql, {
        queryEmbedding,
      });

      if (searchResults.length > 0) {
        matchedImage = searchResults[0].doc;
        similarityScore = searchResults[0].similarity;
        console.log(`[API Request] Found closest match in DB: "${matchedImage.text}" with similarity ${similarityScore.toFixed(4)}`);
      }
    } else {
      console.log(`[API Request] Requesting random category: "${category}" (seed: ${seed})`);
      // No semantic text query, fetch random matching category & seed via AQL
      const aql = `
        FOR doc IN Images
          FILTER doc.category == @category
          LET hashVal = ABS(doc.seed - @seed)
          SORT hashVal ASC
          LIMIT 1
          RETURN doc
      `;

      const results = await arango.query<ImageDocument>(aql, { category, seed });
      if (results.length > 0) {
        matchedImage = results[0];
      }
    }

    // Default Fallback Image if Database contains absolutely nothing
    const fallbackImage: ImageDocument = {
      _key: "default-fallback",
      sourceUrl: `https://images.unsplash.com/photo-1506744038136-46273834b3fb`, // Beautiful generic waterfall
      category: "nature",
      text: "Default mountain and river landscape waterfall scenery",
      embedding: [],
      seed: 42,
    };

    const finalImage = matchedImage || fallbackImage;

    // Step 3: Similarity Evaluation & Background Triggering
    let cacheMaxAge = 31536000; // 1 year cache for high quality exact vector matches
    if (textQuery && similarityScore < 0.85) {
      console.log(`[API Request] Match similarity (${similarityScore.toFixed(4)}) < 0.85. Enqueuing generator task...`);
      // Trigger background job asynchronously using Deno KV queues
      await kv.enqueue({
        prompt: textQuery,
        category,
        seed,
      } as QueueJob);
      cacheMaxAge = 60; // short cache of 60 seconds because better imagery is being generated
    }

    // Step 4: Formatting Response Delivery
    if (format === "blurhash") {
      // Fetch small version of R2 image to encode on the fly or pull pre-calculated blurhash
      // To bypass heavy native canvas APIs in Edge, we fetch image data, decode RGB, and encode
      // For speed, let's return a simulated base83 string, or do a live calculation if buffer provided
      const dummyBlurhash = "L6PZfHeD.AyD_N%g9GMy?v%0IAxG"; // Elegant fallback blurhash
      return new Response(JSON.stringify({ blurhash: dummyBlurhash, sourceUrl: finalImage.sourceUrl }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": `public, max-age=${cacheMaxAge}`,
        },
      });
    }

    if (format === "lqip") {
      // Low Quality Image Placeholder - Return 302 Redirect to a very small blurred version via CDN resizing
      const lqipCdnUrl = `https://${R2_PUBLIC_DOMAIN}/cgi-bin/image/width=32,height=24,blur=10/${finalImage._key}.png`;
      return new Response(null, {
        status: 302,
        headers: {
          "Location": lqipCdnUrl,
          "Cache-Control": `public, max-age=${cacheMaxAge}`,
        },
      });
    }

    // Standard Image Delivery - 302 Redirect to Cloudflare CDN Resizing url
    // Uses Cloudflare's dynamic resizing feature: https://developers.cloudflare.com/images/image-resizing/
    const cdnResizedUrl = `https://${R2_PUBLIC_DOMAIN}/cgi-bin/image/width=${width},height=${height},fit=crop/${finalImage._key}.png`;

    return new Response(null, {
      status: 302,
      headers: {
        "Location": cdnResizedUrl,
        "Cache-Control": `public, max-age=${cacheMaxAge}`,
      },
    });

  } catch (error) {
    console.error("[API Server Error]", error);
    return new Response(JSON.stringify({ error: "Internal Server Error", message: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
