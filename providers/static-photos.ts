import { Buffer } from "node:buffer";
import type { FallbackProvider, FallbackResult } from "./types.ts";
import { GENRES } from "./types.ts";

export function matchGenre(prompt: string): { genre: string; staticSlug: string } {
  const lower = prompt.toLowerCase();
  const words = new Set(lower.split(/\W+/));
  let best = { genre: "nature", staticSlug: "nature", score: 0 };
  for (const g of GENRES) {
    let score = 0;
    for (const kw of g.keywords) {
      if (kw.includes(" ")) { if (lower.includes(kw)) score += 2; }
      else if (words.has(kw)) score += 1;
    }
    if (score > best.score) best = { genre: g.slug, staticSlug: g.staticSlug, score };
  }
  return best;
}

export function matchCategory(prompt: string): string {
  return matchGenre(prompt).staticSlug;
}

// Applies genre's promptTemplate if set; falls back to original prompt.
// Template uses "{prompt}" as placeholder for the original prompt.
export function applyGenreTemplate(prompt: string): { adjustedPrompt: string; genre: string; staticSlug: string } {
  const { genre, staticSlug } = matchGenre(prompt);
  const genreEntry = GENRES.find(g => g.slug === genre);
  const template = genreEntry?.promptTemplate;
  const adjustedPrompt = template ? template.replace("__PROMPT__", prompt) : prompt;
  return { adjustedPrompt, genre, staticSlug };
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
      const { genre, staticSlug } = matchGenre(prompt);
      return { buffer, mimeType, provider: `StaticPhotos(${category})`, sourceUrl: url, genre, staticSlug };
    } catch (err) {
      return null;
    }
  }
}
