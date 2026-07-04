import { Buffer } from "node:buffer";
import type { FallbackProvider, FallbackResult } from "./types.ts";
import { GENRES } from "./types.ts";

// matchCategory scores prompt against all 106 GENRES and returns the best staticSlug
export function matchCategory(prompt: string): string {
  const lower = prompt.toLowerCase();
  const words = new Set(lower.split(/\W+/));

  let best = { staticSlug: "nature", score: 0 };
  for (const genre of GENRES) {
    let score = 0;
    for (const kw of genre.keywords) {
      if (kw.includes(" ")) {
        if (lower.includes(kw)) score += 2;
      } else if (words.has(kw)) {
        score += 1;
      }
    }
    if (score > best.score) best = { staticSlug: genre.staticSlug, score };
  }
  return best.staticSlug;
}

export class StaticPhotosProvider implements FallbackProvider {
  readonly name = "StaticPhotos";

  async fetch(prompt: string, _promptVector: number[]): Promise<FallbackResult | null> {
    const category = matchCategory(prompt);
    // Use a stable seed derived from the prompt so same prompt → same image
    const seed = Math.abs(prompt.split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) % 200 + 1;
    const url = `https://static.photos/${category}/1024x1024/${seed}`;

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const mimeType = response.headers.get("Content-Type") || "image/jpeg";
      return { buffer, mimeType, provider: `StaticPhotos(${category})`, sourceUrl: url };
    } catch (err) {
      return null;
    }
  }
}
