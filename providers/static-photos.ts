import { Buffer } from "node:buffer";
import type { FallbackProvider, FallbackResult } from "./types.ts";

// All 46 categories from static.photos, with keyword aliases for matching
const CATEGORIES: { slug: string; keywords: string[] }[] = [
  { slug: "nature",       keywords: ["nature", "forest", "tree", "leaf", "plant", "flower", "river", "lake", "mountain", "waterfall", "wildlife", "green", "garden", "park"] },
  { slug: "office",       keywords: ["office", "desk", "work", "meeting", "corporate", "business", "chair", "computer", "laptop", "conference", "coworking"] },
  { slug: "people",       keywords: ["people", "person", "human", "crowd", "portrait", "face", "man", "woman", "child", "team", "group", "social"] },
  { slug: "technology",   keywords: ["technology", "tech", "digital", "circuit", "code", "software", "hardware", "robot", "ai", "computer", "device", "gadget", "electronic"] },
  { slug: "minimal",      keywords: ["minimal", "minimalist", "minimalism", "simple", "clean", "white", "plain", "sparse", "empty"] },
  { slug: "abstract",     keywords: ["abstract", "art", "pattern", "shape", "color", "texture", "geometric", "modern", "design", "creative"] },
  { slug: "aerial",       keywords: ["aerial", "drone", "bird", "top", "above", "overhead", "sky", "view", "flying", "map", "satellite"] },
  { slug: "blurred",      keywords: ["blurred", "blur", "bokeh", "soft", "defocus", "out of focus", "dreamy"] },
  { slug: "bokeh",        keywords: ["bokeh", "depth", "light", "sparkle", "glitter", "blur", "lens"] },
  { slug: "gradient",     keywords: ["gradient", "colorful", "rainbow", "spectrum", "vibrant", "vivid", "color"] },
  { slug: "monochrome",   keywords: ["monochrome", "black white", "grayscale", "grey", "gray", "mono", "desaturated"] },
  { slug: "vintage",      keywords: ["vintage", "retro", "old", "antique", "classic", "aged", "nostalgia", "film", "grain"] },
  { slug: "white",        keywords: ["white", "bright", "light", "pale", "ivory", "snow"] },
  { slug: "black",        keywords: ["black", "dark", "night", "shadow", "darkness", "coal"] },
  { slug: "blue",         keywords: ["blue", "ocean", "sea", "sky", "water", "azure", "navy", "cobalt", "cyan"] },
  { slug: "red",          keywords: ["red", "fire", "warm", "passion", "scarlet", "crimson", "rose"] },
  { slug: "green",        keywords: ["green", "eco", "grass", "leaf", "emerald", "lime", "jungle", "forest"] },
  { slug: "yellow",       keywords: ["yellow", "gold", "sun", "sunshine", "bright", "warm", "amber", "honey"] },
  { slug: "cityscape",    keywords: ["cityscape", "city", "skyline", "downtown", "urban", "skyscraper", "metropolis", "buildings", "street"] },
  { slug: "workspace",    keywords: ["workspace", "desk", "studio", "home office", "creative", "setup", "keyboard", "monitor"] },
  { slug: "food",         keywords: ["food", "meal", "dish", "eat", "restaurant", "cuisine", "cook", "recipe", "ingredient", "fruit", "vegetable"] },
  { slug: "travel",       keywords: ["travel", "trip", "tourism", "vacation", "holiday", "explore", "adventure", "destination", "map", "passport"] },
  { slug: "textures",     keywords: ["texture", "surface", "material", "fabric", "wall", "stone", "wood", "grain", "rough", "smooth"] },
  { slug: "industry",     keywords: ["industry", "factory", "manufacturing", "machine", "production", "warehouse", "worker", "steel", "metal"] },
  { slug: "indoor",       keywords: ["indoor", "interior", "inside", "room", "home", "house", "apartment", "living", "ceiling"] },
  { slug: "outdoor",      keywords: ["outdoor", "outside", "exterior", "field", "open", "fresh air", "environment"] },
  { slug: "studio",       keywords: ["studio", "photo", "shoot", "backdrop", "lighting", "model", "professional"] },
  { slug: "finance",      keywords: ["finance", "money", "bank", "economy", "investment", "stock", "chart", "currency", "coin", "wealth"] },
  { slug: "medical",      keywords: ["medical", "health", "doctor", "hospital", "medicine", "healthcare", "nurse", "patient", "surgery"] },
  { slug: "season",       keywords: ["season", "spring", "summer", "autumn", "fall", "winter", "weather", "harvest"] },
  { slug: "holiday",      keywords: ["holiday", "christmas", "celebration", "festive", "new year", "decoration", "party", "gift"] },
  { slug: "event",        keywords: ["event", "conference", "concert", "festival", "gathering", "ceremony", "show", "performance", "crowd"] },
  { slug: "sport",        keywords: ["sport", "fitness", "exercise", "gym", "run", "athlete", "game", "soccer", "basketball", "swimming", "yoga"] },
  { slug: "science",      keywords: ["science", "lab", "research", "experiment", "biology", "chemistry", "physics", "microscope", "data"] },
  { slug: "legal",        keywords: ["legal", "law", "court", "justice", "lawyer", "contract", "judge", "gavel", "book"] },
  { slug: "estate",       keywords: ["estate", "real estate", "house", "property", "home", "apartment", "building", "architecture", "mortgage"] },
  { slug: "restaurant",   keywords: ["restaurant", "cafe", "dining", "bar", "kitchen", "menu", "chef", "waiter", "table"] },
  { slug: "retail",       keywords: ["retail", "shop", "store", "shopping", "mall", "market", "product", "shelf", "ecommerce"] },
  { slug: "wellness",     keywords: ["wellness", "spa", "meditation", "yoga", "relax", "calm", "mindfulness", "healing", "beauty"] },
  { slug: "agriculture",  keywords: ["agriculture", "farm", "crop", "harvest", "field", "tractor", "soil", "rural", "grain", "livestock"] },
  { slug: "construction", keywords: ["construction", "building", "crane", "scaffold", "worker", "blueprint", "cement", "site", "engineer"] },
  { slug: "craft",        keywords: ["craft", "handmade", "diy", "art", "wood", "pottery", "sewing", "hobby", "workshop"] },
  { slug: "cosmetic",     keywords: ["cosmetic", "beauty", "makeup", "skincare", "perfume", "lipstick", "cream", "salon", "fashion"] },
  { slug: "automotive",   keywords: ["automotive", "car", "vehicle", "auto", "drive", "engine", "road", "motorcycle", "transport"] },
  { slug: "gaming",       keywords: ["gaming", "game", "console", "controller", "esport", "video game", "play", "keyboard", "screen"] },
  { slug: "education",    keywords: ["education", "school", "learn", "study", "book", "classroom", "student", "teacher", "university", "college"] },
];

function matchCategory(prompt: string): string {
  const lower = prompt.toLowerCase();
  const words = new Set(lower.split(/\W+/));

  let best = { slug: "nature", score: 0 };
  for (const cat of CATEGORIES) {
    let score = 0;
    for (const kw of cat.keywords) {
      if (kw.includes(" ")) {
        if (lower.includes(kw)) score += 2;
      } else if (words.has(kw)) {
        score += 1;
      }
    }
    if (score > best.score) best = { slug: cat.slug, score };
  }
  return best.slug;
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
