import { Buffer } from "node:buffer";
import type { FallbackProvider, FallbackResult } from "./types.ts";

// 46 static.photos slugs enriched with keywords from all 106 Wikipedia Photography_by_genre entries
const CATEGORIES: { slug: string; keywords: string[] }[] = [
  // ── Nature / Landscape / Outdoor ─────────────────────────────────────────
  { slug: "nature",       keywords: ["nature", "forest", "tree", "leaf", "plant", "flower", "river", "lake", "mountain", "waterfall", "wildlife", "green", "garden", "park", "landscape", "cloudscape", "cloud", "conservation", "geophotography", "geo", "ecosystem", "environment", "habitat", "terrain", "wilderness", "botanical"] },
  { slug: "aerial",       keywords: ["aerial", "drone", "bird", "top", "above", "overhead", "flying", "satellite", "satellite imagery", "air-to-air", "aviation", "airplane", "aircraft", "pilot", "altitude", "panorama", "panoramic", "overhead view", "map"] },
  { slug: "outdoor",      keywords: ["outdoor", "outside", "exterior", "field", "open", "fresh air", "ruins", "ruin", "abandoned", "decay", "urban exploration", "urbex", "trail", "expedition", "new topographics", "topographic"] },
  { slug: "season",       keywords: ["season", "spring", "summer", "autumn", "fall", "winter", "weather", "harvest", "snow", "rain", "storm", "fog", "mist", "frost", "ice", "sunset", "sunrise", "golden hour", "long exposure", "long-exposure", "time-lapse", "timelapse"] },

  // ── People / Portrait / Social ────────────────────────────────────────────
  { slug: "people",       keywords: ["people", "person", "human", "crowd", "portrait", "face", "man", "woman", "child", "team", "group", "social", "candid", "street photography", "snapshot", "vernacular", "humanist", "documentary", "photojournalism", "photojournalist", "narrative", "photovoice", "lifestyle", "self-portrait", "selfie", "fancy portrait", "old-time", "post-mortem"] },
  { slug: "studio",       keywords: ["studio", "shoot", "backdrop", "lighting", "model", "professional", "fashion", "glamour", "staged", "conceptual", "fine-art", "fine art", "pictorialism", "soft focus", "impressionist photography", "high key", "low key"] },
  { slug: "cosmetic",     keywords: ["cosmetic", "beauty", "makeup", "skincare", "perfume", "lipstick", "cream", "salon", "fashion", "glamour", "model", "style", "wardrobe"] },

  // ── Urban / Architecture / Travel ─────────────────────────────────────────
  { slug: "cityscape",    keywords: ["cityscape", "city", "skyline", "downtown", "urban", "skyscraper", "metropolis", "buildings", "street", "street photography", "architecture", "architectural", "estate", "real estate", "bridge", "infrastructure", "public space"] },
  { slug: "travel",       keywords: ["travel", "trip", "tourism", "vacation", "holiday", "explore", "adventure", "destination", "passport", "culture", "landmark", "monument", "heritage", "historic", "photowalk", "photowalking", "virtual photography", "vr photography", "360", "panoramic travel"] },
  { slug: "indoor",       keywords: ["indoor", "interior", "inside", "room", "home", "house", "apartment", "living", "ceiling", "decor", "furniture", "architecture interior", "workspace interior"] },

  // ── Technology / Science / Space ──────────────────────────────────────────
  { slug: "technology",   keywords: ["technology", "tech", "digital", "circuit", "code", "software", "hardware", "robot", "ai", "computer", "device", "gadget", "electronic", "high-speed", "high speed", "femto", "kirlian", "ultraviolet", "uv", "infrared", "macro electronics", "die shot", "chip", "semiconductor"] },
  { slug: "science",      keywords: ["science", "lab", "research", "experiment", "biology", "chemistry", "physics", "microscope", "data", "astrophotography", "astro", "telescope", "space photography", "galaxy", "cosmos", "cosmic", "lunar", "nasa", "solar eclipse", "lunar eclipse", "macro photography", "macro", "close-up", "micro", "forensic photography", "forensic", "medical photography", "clinical", "milky way", "star trail", "night photography", "deep sky"] },
  // ── Abstract / Art / Creative ─────────────────────────────────────────────
  { slug: "abstract",     keywords: ["abstract", "art", "pattern", "shape", "color", "texture", "geometric", "modern", "design", "creative", "conceptual photography", "conceptual", "fine-art photography", "fine art", "polaroid art", "polaroid", "spirit photography", "impressionist", "pictorialism", "straight photography", "lomography", "lomo", "lo-fi", "analog photography", "film photography", "experimental"] },
  { slug: "gradient",     keywords: ["gradient", "colorful", "rainbow", "spectrum", "vibrant", "vivid", "color", "multicolor", "chromatic", "hue"] },
  { slug: "monochrome",   keywords: ["monochrome", "black white", "grayscale", "grey", "gray", "mono", "desaturated", "monochrome photography", "black and white", "bnw", "bw"] },
  { slug: "vintage",      keywords: ["vintage", "retro", "old", "antique", "classic", "aged", "nostalgia", "film", "grain", "analog", "old-time photography", "vintage print", "found photography", "found photo", "vernacular photography", "pictorialism"] },

  // ── Minimal / Clean ───────────────────────────────────────────────────────
  { slug: "minimal",      keywords: ["minimal", "minimalist", "minimalism", "simple", "clean", "plain", "sparse", "empty", "minimalist photography", "still life", "still-life", "product photography", "360 product", "white background", "isolated"] },
  { slug: "white",        keywords: ["white", "bright", "light", "pale", "ivory", "snow", "high key", "overexposed", "bright tones"] },
  { slug: "black",        keywords: ["black", "dark", "night", "shadow", "darkness", "coal", "low key", "low-key", "underexposed", "silhouette", "noir"] },

  // ── Color themes ─────────────────────────────────────────────────────────
  { slug: "blue",         keywords: ["blue", "ocean", "sea", "water", "azure", "navy", "cobalt", "cyan", "underwater photography", "underwater", "marine", "ocean life", "dive", "scuba", "aquatic", "subminiature"] },
  { slug: "red",          keywords: ["red", "fire photography", "fire", "warm", "passion", "scarlet", "crimson", "rose", "fireworks", "fireworks photography", "explosion", "flame"] },
  { slug: "green",        keywords: ["green", "eco", "grass", "emerald", "lime", "jungle"] },
  { slug: "yellow",       keywords: ["yellow", "gold", "sun", "sunshine", "amber", "honey"] },

  // ── Bokeh / Blur / Optics ────────────────────────────────────────────────
  { slug: "blurred",      keywords: ["blurred", "blur", "soft", "defocus", "out of focus", "dreamy", "soft focus", "impressionist photography", "slow photography", "slow shutter"] },
  { slug: "bokeh",        keywords: ["bokeh", "depth", "sparkle", "glitter", "lens", "depth of field", "shallow focus", "background blur"] },

  // ── Food / Restaurant ────────────────────────────────────────────────────
  { slug: "food",         keywords: ["food", "meal", "dish", "eat", "cuisine", "cook", "recipe", "ingredient", "fruit", "vegetable", "food photography", "food styling", "culinary"] },
  { slug: "restaurant",   keywords: ["restaurant", "cafe", "dining", "bar", "kitchen", "menu", "chef", "waiter", "table", "food social media", "instagram food", "gastronomy"] },

  // ── Sport / Event / Action ───────────────────────────────────────────────
  { slug: "sport",        keywords: ["sport", "fitness", "exercise", "gym", "run", "athlete", "game", "soccer", "basketball", "swimming", "yoga", "skate", "skateboarding", "skate photography", "action", "actionshot", "action shot", "motion", "speed", "race", "competition", "match", "tournament", "olympics", "cycling", "formula", "motorsport"] },
  { slug: "event",        keywords: ["event", "concert", "concert photography", "festival", "gathering", "ceremony", "show", "performance", "crowd", "theatre", "theater", "theatre photography", "wedding", "wedding photography", "banquet", "gala", "awards", "conference"] },

  // ── Office / Business / Finance ──────────────────────────────────────────
  { slug: "office",       keywords: ["office", "desk", "work", "meeting", "corporate", "business", "chair", "laptop", "conference", "coworking", "white-collar", "professional"] },
  { slug: "finance",      keywords: ["finance", "money", "bank", "economy", "investment", "stock", "chart", "currency", "coin", "wealth", "crypto", "bitcoin", "market", "trading", "forex"] },
  { slug: "workspace",    keywords: ["workspace", "home office", "creative", "setup", "keyboard", "monitor", "studio workspace", "maker"] },

  // ── Medical / Legal / Science ────────────────────────────────────────────
  { slug: "medical",      keywords: ["medical", "health", "doctor", "hospital", "medicine", "healthcare", "nurse", "patient", "surgery", "medical photography", "clinical", "gene therapy", "vaccine", "pharmaceutical", "anatomy", "x-ray"] },
  { slug: "legal",        keywords: ["legal", "law", "court", "justice", "lawyer", "contract", "judge", "gavel", "book", "forensic", "mug shot", "rogues gallery", "crime"] },

  // ── Real Estate / Construction ───────────────────────────────────────────
  { slug: "estate",       keywords: ["estate", "real estate", "house", "property", "home", "apartment", "building", "architecture", "mortgage", "residential", "commercial property"] },
  { slug: "construction", keywords: ["construction", "crane", "scaffold", "worker", "blueprint", "cement", "site", "engineer", "infrastructure", "demolition"] },

  // ── Retail / Commerce ────────────────────────────────────────────────────
  { slug: "retail",       keywords: ["retail", "shop", "store", "shopping", "mall", "market", "product", "shelf", "ecommerce", "stock photography", "stock photo", "commercial photography"] },

  // ── Education / Craft / Hobby ────────────────────────────────────────────
  { slug: "education",    keywords: ["education", "school", "learn", "study", "book", "classroom", "student", "teacher", "university", "college", "photobiography", "biography", "documentary"] },
  { slug: "craft",        keywords: ["craft", "handmade", "diy", "art", "wood", "pottery", "sewing", "hobby", "workshop", "maker", "artisan"] },

  // ── Wellness / Spirituality ──────────────────────────────────────────────
  { slug: "wellness",     keywords: ["wellness", "spa", "meditation", "yoga", "relax", "calm", "mindfulness", "healing", "beauty", "spirit", "spirit photography", "thoughtography", "aura", "kirlian"] },

  // ── Agriculture / Industry ───────────────────────────────────────────────
  { slug: "agriculture",  keywords: ["agriculture", "farm", "crop", "harvest", "field", "tractor", "soil", "rural", "grain", "livestock", "conservation photography", "environmental", "nature conservation"] },
  { slug: "industry",     keywords: ["industry", "factory", "manufacturing", "machine", "production", "warehouse", "worker", "steel", "metal", "fire photography", "industrial"] },

  // ── Automotive / Transport ───────────────────────────────────────────────
  { slug: "automotive",   keywords: ["automotive", "car", "vehicle", "auto", "drive", "engine", "road", "motorcycle", "transport", "aviation photography", "aircraft photography", "race car", "formula 1", "motorsport"] },

  // ── Gaming / Digital ─────────────────────────────────────────────────────
  { slug: "gaming",       keywords: ["gaming", "game", "console", "controller", "esport", "video game", "play", "keyboard", "screen", "virtual photography", "vr", "360 photography", "digital art"] },

  // ── Textures ─────────────────────────────────────────────────────────────
  { slug: "textures",     keywords: ["texture", "surface", "material", "fabric", "wall", "stone", "wood", "grain", "rough", "smooth", "macro texture", "pattern", "close-up texture"] },

  // ── Holiday / Celebration ────────────────────────────────────────────────
  { slug: "holiday",      keywords: ["holiday", "christmas", "celebration", "festive", "new year", "decoration", "party", "gift", "halloween", "thanksgiving", "fireworks holiday"] },
];

export function matchCategory(prompt: string): string {
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
