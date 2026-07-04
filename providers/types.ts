import type { Buffer } from "node:buffer";

export interface FallbackResult {
  buffer: Buffer;
  mimeType: string;
  provider: string;
  sourceUrl: string;
  genre: string;       // matched genre slug from GENRES
  staticSlug: string;  // static.photos slug used for category
}

export interface FallbackProvider {
  name: string;
  fetch(prompt: string, promptVector: number[]): Promise<FallbackResult | null>;
}

export interface Genre {
  slug: string;           // genre identifier (kebab-case)
  staticSlug: string;     // maps to a static.photos URL slug
  keywords: string[];
  promptTemplate: string; // "{prompt}" is replaced with original prompt at generation time
}

// All 106 genres from https://en.wikipedia.org/wiki/Category:Photography_by_genre
export const GENRES: Genre[] = [
  { slug: "360-product-photography",      staticSlug: "retail",       promptTemplate: "", keywords: ["360 product", "360", "product photography", "product", "turntable", "ecommerce", "packshot"] },
  { slug: "abstract-photography",         staticSlug: "abstract",     promptTemplate: "", keywords: ["abstract", "abstract photography", "non-representational", "art", "pattern", "shape", "texture", "geometric", "experimental"] },
  { slug: "action-shot",                  staticSlug: "sport",        promptTemplate: "", keywords: ["action", "actionshot", "action shot", "motion blur", "freeze", "sport", "dynamic", "fast", "movement"] },
  { slug: "aerial-photography",           staticSlug: "aerial",       promptTemplate: "", keywords: ["aerial", "aerial photography", "drone", "overhead", "top view", "bird's eye", "above", "altitude", "elevation"] },
  { slug: "air-to-air-photography",       staticSlug: "aerial",       promptTemplate: "", keywords: ["air-to-air", "aircraft", "airplane", "jet", "formation", "flight", "aviation", "airborne"] },
  { slug: "analog-photography",           staticSlug: "vintage",      promptTemplate: "", keywords: ["analog", "analogue", "film", "35mm", "darkroom", "chemical", "film roll", "negative", "silver halide"] },
  { slug: "architectural-photography",    staticSlug: "estate",       promptTemplate: "", keywords: ["architectural", "architecture", "building", "structure", "facade", "interior design", "exterior", "blueprint", "design"] },
  { slug: "astrophotography",             staticSlug: "science",      promptTemplate: "", keywords: ["astrophotography", "astro", "astronomy", "telescope", "space", "galaxy", "nebula", "stars", "deep sky", "milky way", "cosmos", "celestial"] },
  { slug: "aviation-photography",         staticSlug: "aerial",       promptTemplate: "", keywords: ["aviation", "airplane", "aircraft", "airport", "runway", "pilot", "cockpit", "jet", "helicopter", "flight"] },
  { slug: "banquet-photography",          staticSlug: "event",        promptTemplate: "", keywords: ["banquet", "gala", "dinner", "formal event", "reception", "hall", "wedding reception", "corporate dinner", "catering"] },
  { slug: "blind-photography",            staticSlug: "abstract",     promptTemplate: "", keywords: ["blind", "unseen", "surprise", "random", "instinctive", "intuitive photography", "spontaneous"] },
  { slug: "candid-photography",           staticSlug: "people",       promptTemplate: "", keywords: ["candid", "candid photography", "unposed", "natural", "spontaneous", "street", "real moment", "unstaged", "paparazzi"] },
  { slug: "close-up",                     staticSlug: "science",      promptTemplate: "", keywords: ["close-up", "closeup", "close up", "detail", "magnify", "macro", "zoom", "tight shot", "focus"] },
  { slug: "cloudscape-photography",       staticSlug: "nature",       promptTemplate: "", keywords: ["cloudscape", "cloud", "sky", "overcast", "storm cloud", "cumulus", "nimbus", "weather", "atmospheric"] },
  { slug: "conceptual-photography",       staticSlug: "abstract",     promptTemplate: "", keywords: ["conceptual", "concept", "idea", "symbolic", "metaphor", "surreal", "fine art", "artistic statement", "creative concept"] },
  { slug: "concert-photography",          staticSlug: "event",        promptTemplate: "", keywords: ["concert", "live music", "band", "stage", "performer", "musician", "crowd", "festival", "gig", "show", "spotlight"] },
  { slug: "conservation-photography",     staticSlug: "nature",       promptTemplate: "", keywords: ["conservation", "wildlife conservation", "environmental", "ecosystem", "endangered", "habitat", "protect", "nature conservation"] },
  { slug: "cursed-image",                 staticSlug: "abstract",     promptTemplate: "", keywords: ["cursed", "unsettling", "weird", "eerie", "disturbing", "odd", "bizarre", "uncanny", "strange photo"] },
  { slug: "die-shot",                     staticSlug: "technology",   promptTemplate: "", keywords: ["die shot", "die", "chip", "semiconductor", "integrated circuit", "cpu", "processor", "silicon wafer", "micro chip"] },
  { slug: "dog-shaming",                  staticSlug: "people",       promptTemplate: "", keywords: ["dog shaming", "pet", "dog", "animal misbehave", "sign", "funny pet", "meme"] },
  { slug: "eclipse-photography",          staticSlug: "science",      promptTemplate: "", keywords: ["eclipse", "solar eclipse", "lunar eclipse", "totality", "corona", "sun", "moon", "shadow", "astronomical event"] },
  { slug: "event-photography",            staticSlug: "event",        promptTemplate: "", keywords: ["event", "event photography", "ceremony", "gathering", "conference", "meeting", "awards", "launch", "occasion"] },
  { slug: "fancy-portrait",               staticSlug: "studio",       promptTemplate: "", keywords: ["fancy portrait", "formal portrait", "dressed up", "costume", "period portrait", "elaborate", "fine portrait"] },
  { slug: "fashion-photography",          staticSlug: "cosmetic",     promptTemplate: "", keywords: ["fashion", "fashion photography", "model", "runway", "editorial", "clothing", "style", "wardrobe", "designer", "couture", "vogue"] },
  { slug: "femto-photography",            staticSlug: "science",      promptTemplate: "", keywords: ["femto", "femtosecond", "ultra-fast", "light propagation", "trillion fps", "slow light", "scientific imaging"] },
  { slug: "film-still",                   staticSlug: "studio",       promptTemplate: "", keywords: ["film still", "movie still", "cinema", "behind the scenes", "set photo", "screenshot", "frame", "director", "scene"] },
  { slug: "fine-art-photography",         staticSlug: "abstract",     promptTemplate: "", keywords: ["fine art", "fine-art photography", "gallery", "museum", "artistic", "expressive", "creative", "aesthetic", "art print"] },
  { slug: "fire-photography",             staticSlug: "red",          promptTemplate: "", keywords: ["fire", "flame", "blaze", "burning", "inferno", "campfire", "wildfire", "heat", "combustion", "spark"] },
  { slug: "fireworks-photography",        staticSlug: "red",          promptTemplate: "", keywords: ["fireworks", "firework", "pyrotechnic", "explosion", "celebration", "new year", "4th of july", "sparkle", "night fireworks"] },
  { slug: "food-photography",             staticSlug: "food",         promptTemplate: "", keywords: ["food", "food photography", "dish", "meal", "cuisine", "plating", "ingredient", "culinary", "gourmet", "recipe"] },
  { slug: "food-photography-social-media",staticSlug: "food",         promptTemplate: "", keywords: ["food social media", "instagram food", "flatlay", "food blog", "foodie", "overhead food", "aesthetic food", "trending food"] },
  { slug: "forensic-photography",         staticSlug: "legal",        promptTemplate: "", keywords: ["forensic", "forensic photography", "crime scene", "evidence", "investigation", "police", "court", "criminal", "detective"] },
  { slug: "found-photography",            staticSlug: "vintage",      promptTemplate: "", keywords: ["found photography", "found photo", "discovered photo", "vernacular", "anonymous", "old photo", "flea market photo"] },
  { slug: "genre-art",                    staticSlug: "abstract",     promptTemplate: "", keywords: ["genre art", "genre scene", "everyday life", "genre painting", "narrative art", "storytelling", "scene"] },
  { slug: "geophotography",               staticSlug: "nature",       promptTemplate: "", keywords: ["geophotography", "geology", "earth", "rock formation", "landscape", "geographic", "terrain", "topography", "land"] },
  { slug: "glamour-photography",          staticSlug: "cosmetic",     promptTemplate: "", keywords: ["glamour", "glamour photography", "sensual", "alluring", "beauty", "pin-up", "boudoir", "elegant", "seductive"] },
  { slug: "high-key",                     staticSlug: "white",        promptTemplate: "", keywords: ["high key", "highkey", "bright", "overexposed", "white tones", "soft light", "airy", "light background", "luminous"] },
  { slug: "high-speed-photography",       staticSlug: "technology",   promptTemplate: "", keywords: ["high-speed", "high speed photography", "freeze motion", "water drop", "bullet", "splash", "strobe", "fast shutter", "microsecond"] },
  { slug: "imagery-intelligence",         staticSlug: "aerial",       promptTemplate: "", keywords: ["imagery intelligence", "reconnaissance", "surveillance", "satellite imagery", "geospatial", "spy", "intelligence", "overhead surveillance"] },
  { slug: "impressionist-photography",    staticSlug: "blurred",      promptTemplate: "", keywords: ["impressionist photography", "impressionist", "painterly", "soft", "dreamy", "pictorialist", "blended", "motion blur art"] },
  { slug: "kirlian-photography",          staticSlug: "wellness",     promptTemplate: "", keywords: ["kirlian", "aura", "electromagnetic", "corona discharge", "energy field", "bioelectrography", "spirit photography"] },
  { slug: "lifestyle-photography",        staticSlug: "people",       promptTemplate: "", keywords: ["lifestyle", "lifestyle photography", "daily life", "candid living", "authentic", "real life", "family", "couple", "everyday"] },
  { slug: "lo-fi-photography",            staticSlug: "vintage",      promptTemplate: "", keywords: ["lo-fi", "lofi", "low fidelity", "grainy", "cheap camera", "toy camera", "low quality aesthetic", "imperfect"] },
  { slug: "lolcat",                       staticSlug: "people",       promptTemplate: "", keywords: ["lolcat", "meme", "cat meme", "funny cat", "internet meme", "humorous", "viral photo"] },
  { slug: "lomography",                   staticSlug: "vintage",      promptTemplate: "", keywords: ["lomography", "lomo", "lomographic", "holga", "diana", "vignette", "light leak", "cross process", "plastic lens"] },
  { slug: "long-exposure-photography",    staticSlug: "science",      promptTemplate: "", keywords: ["long exposure", "long-exposure", "light trail", "car trail", "silk water", "star trail", "slow shutter", "nightscape", "light painting"] },
  { slug: "low-key",                      staticSlug: "black",        promptTemplate: "", keywords: ["low key", "lowkey", "dark", "shadow", "moody", "dramatic", "chiaroscuro", "underexposed", "noir", "deep shadow"] },
  { slug: "low-key-photography",          staticSlug: "black",        promptTemplate: "", keywords: ["low-key photography", "dark portrait", "rembrandt lighting", "split lighting", "dramatic light", "dark background"] },
  { slug: "macro-photography",            staticSlug: "science",      promptTemplate: "", keywords: ["macro", "macro photography", "extreme close-up", "magnification", "insect", "flower detail", "1:1", "extension tube", "ring flash"] },
  { slug: "medical-photography",          staticSlug: "medical",      promptTemplate: "", keywords: ["medical photography", "clinical photography", "surgical", "pathology", "dermatology", "anatomy", "patient", "healthcare imaging"] },
  { slug: "minimalist-photography",       staticSlug: "minimal",      promptTemplate: "", keywords: ["minimalist photography", "minimalism", "negative space", "clean", "simple", "sparse", "less is more", "uncluttered"] },
  { slug: "monochrome-photography",       staticSlug: "monochrome",   promptTemplate: "", keywords: ["monochrome", "black and white", "grayscale", "bnw", "bw", "mono", "desaturated", "silver", "tonal"] },
  { slug: "mug-shot",                     staticSlug: "legal",        promptTemplate: "", keywords: ["mug shot", "mugshot", "booking photo", "arrest", "criminal record", "police photo", "id photo", "wanted"] },
  { slug: "narrative-photography",        staticSlug: "people",       promptTemplate: "", keywords: ["narrative", "storytelling photography", "photo story", "series", "photographic narrative", "documentary story", "visual narrative"] },
  { slug: "new-topographics",             staticSlug: "outdoor",      promptTemplate: "", keywords: ["new topographics", "topographic", "man-altered landscape", "industrial landscape", "suburban", "mundane", "banal landscape"] },
  { slug: "night-photography",            staticSlug: "black",        promptTemplate: "", keywords: ["night photography", "night", "nocturnal", "low light", "city lights", "nightscape", "dark sky", "astrophotography night"] },
  { slug: "old-time-photography",         staticSlug: "vintage",      promptTemplate: "", keywords: ["old-time photography", "old time photo", "historical costume", "period dress", "vintage portrait", "sepia", "daguerreotype"] },
  { slug: "panorama",                     staticSlug: "aerial",       promptTemplate: "", keywords: ["panorama", "panoramic", "wide angle", "360 view", "landscape panorama", "stitched", "wide scene"] },
  { slug: "panoramic-photography",        staticSlug: "aerial",       promptTemplate: "", keywords: ["panoramic photography", "wide panorama", "360 panorama", "vr panorama", "cylindrical", "spherical panorama"] },
  { slug: "photobiography",               staticSlug: "people",       promptTemplate: "", keywords: ["photobiography", "photo biography", "life story", "memoir", "biographical", "documentary life", "personal archive"] },
  { slug: "photobombing",                 staticSlug: "people",       promptTemplate: "", keywords: ["photobombing", "photobomb", "unexpected", "background surprise", "ruined photo", "uninvited", "funny background"] },
  { slug: "photography-indigenous-peoples",staticSlug: "people",      promptTemplate: "", keywords: ["indigenous", "native", "tribal", "ethnic", "cultural", "traditional community", "anthropology", "heritage"] },
  { slug: "photojournalism",              staticSlug: "people",       promptTemplate: "", keywords: ["photojournalism", "news photography", "press photo", "journalist", "breaking news", "documentary", "current events", "war photography"] },
  { slug: "photovoice",                   staticSlug: "people",       promptTemplate: "", keywords: ["photovoice", "community photography", "empowerment", "social change", "participatory", "advocacy", "grassroots"] },
  { slug: "photowalking",                 staticSlug: "travel",       promptTemplate: "", keywords: ["photowalking", "photowalk", "photo walk", "walking photography", "urban exploration", "street walk", "city walk"] },
  { slug: "pictorialism",                 staticSlug: "vintage",      promptTemplate: "", keywords: ["pictorialism", "pictorialist", "soft focus artistic", "painterly photography", "gum print", "platinum print", "art photography movement"] },
  { slug: "polaroid-art",                 staticSlug: "vintage",      promptTemplate: "", keywords: ["polaroid", "instant photo", "polaroid art", "impossible project", "instax", "instant film", "analog instant"] },
  { slug: "portrait-photography",         staticSlug: "people",       promptTemplate: "", keywords: ["portrait", "portrait photography", "headshot", "face", "expression", "character", "subject", "likeness", "pose"] },
  { slug: "post-mortem-photography",      staticSlug: "vintage",      promptTemplate: "", keywords: ["post-mortem", "postmortem photography", "memorial photography", "victorian death photo", "memorial portrait"] },
  { slug: "red-shirt-photography",        staticSlug: "people",       promptTemplate: "", keywords: ["red shirt", "red shirt photography", "posed group", "staged crowd", "uniform group", "corporate group photo"] },
  { slug: "rogues-gallery",               staticSlug: "legal",        promptTemplate: "", keywords: ["rogues gallery", "rogue", "criminal collection", "mug shot collection", "police archive", "wanted photos"] },
  { slug: "ruins-photography",            staticSlug: "outdoor",      promptTemplate: "", keywords: ["ruins", "ruin", "abandoned", "decay", "urban exploration", "urbex", "derelict", "ghost town", "lost place", "crumbling"] },
  { slug: "satellite-imagery",            staticSlug: "aerial",       promptTemplate: "", keywords: ["satellite imagery", "satellite", "remote sensing", "geospatial", "earth observation", "aerial map", "google earth", "landsat"] },
  { slug: "secret-photography",           staticSlug: "people",       promptTemplate: "", keywords: ["secret photography", "covert", "hidden camera", "surveillance", "spy photography", "candid secret", "paparazzi"] },
  { slug: "self-portrait",                staticSlug: "people",       promptTemplate: "", keywords: ["self portrait", "selfie", "self-portrait", "self photo", "autobiographical", "mirror shot", "self documentation"] },
  { slug: "skate-photography",            staticSlug: "sport",        promptTemplate: "", keywords: ["skate", "skateboarding", "skater", "trick", "halfpipe", "grind", "kickflip", "ollie", "skate park", "urban skate"] },
  { slug: "slow-photography",             staticSlug: "blurred",      promptTemplate: "", keywords: ["slow photography", "slow shutter", "motion blur", "panning", "intentional camera movement", "icm", "blurred motion"] },
  { slug: "snapshot-photography",         staticSlug: "people",       promptTemplate: "", keywords: ["snapshot", "snapshot photography", "casual photo", "family snapshot", "amateur", "point and shoot", "memory"] },
  { slug: "social-photography",           staticSlug: "people",       promptTemplate: "", keywords: ["social photography", "social media", "instagram", "facebook", "shared photo", "community photo", "social network"] },
  { slug: "soft-focus",                   staticSlug: "blurred",      promptTemplate: "", keywords: ["soft focus", "soft lens", "diffused", "gentle blur", "dreamy", "romantic soft", "fog filter", "haze"] },
  { slug: "spirit-photography",           staticSlug: "wellness",     promptTemplate: "", keywords: ["spirit photography", "ghost", "double exposure", "séance", "paranormal", "apparition", "spirit", "ectoplasm"] },
  { slug: "staged-photography",           staticSlug: "studio",       promptTemplate: "", keywords: ["staged photography", "directed", "constructed", "tableaux", "setup", "arranged", "theatrical photography", "cinematic"] },
  { slug: "star-trail",                   staticSlug: "science",      promptTemplate: "", keywords: ["star trail", "startrail", "star trails", "long exposure stars", "earth rotation", "polar star", "night sky rotation", "celestial motion"] },
  { slug: "still-life-photography",       staticSlug: "minimal",      promptTemplate: "", keywords: ["still life", "still-life photography", "object", "arrangement", "tabletop", "product still", "flat lay", "composed objects"] },
  { slug: "straight-photography",         staticSlug: "abstract",     promptTemplate: "", keywords: ["straight photography", "purist", "unmanipulated", "documentary style", "realist", "no darkroom", "f/64", "zone system"] },
  { slug: "street-photography",           staticSlug: "cityscape",    promptTemplate: "", keywords: ["street photography", "street", "urban", "candid street", "public space", "city life", "pedestrian", "sidewalk", "urban candid"] },
  { slug: "subminiature-photography",     staticSlug: "vintage",      promptTemplate: "", keywords: ["subminiature", "subminiature camera", "minox", "spy camera", "miniature film", "tiny camera", "micro format"] },
  { slug: "theatre-photography",          staticSlug: "event",        promptTemplate: "", keywords: ["theatre", "theater photography", "stage", "performance", "actor", "play", "opera", "dance performance", "spotlight stage"] },
  { slug: "thoughtography",               staticSlug: "wellness",     promptTemplate: "", keywords: ["thoughtography", "psychic photography", "projected thought", "nensha", "paranormal image", "psychokinesis photo"] },
  { slug: "time-lapse-photography",       staticSlug: "season",       promptTemplate: "", keywords: ["time-lapse", "timelapse", "time lapse photography", "hyperlapse", "flower blooming", "cloud movement", "day to night"] },
  { slug: "travel-photography",           staticSlug: "travel",       promptTemplate: "", keywords: ["travel", "travel photography", "trip", "destination", "explore", "adventure", "landmark", "culture", "tourism", "wanderlust", "globe"] },
  { slug: "ultraviolet-photography",      staticSlug: "science",      promptTemplate: "", keywords: ["ultraviolet photography", "uv photography", "uv light", "fluorescence", "black light", "invisible spectrum", "uv fluorescent"] },
  { slug: "underwater-photography",       staticSlug: "blue",         promptTemplate: "", keywords: ["underwater photography", "underwater", "scuba", "dive", "ocean floor", "coral reef", "marine life", "aquatic", "sub-aqua"] },
  { slug: "underwater-videography",       staticSlug: "blue",         promptTemplate: "", keywords: ["underwater videography", "underwater video", "underwater film", "dive video", "ocean documentary", "marine video"] },
  { slug: "vernacular-photography",       staticSlug: "people",       promptTemplate: "", keywords: ["vernacular photography", "everyday photo", "amateur snapshot", "found vernacular", "ordinary", "mundane photo", "home photo"] },
  { slug: "vintage-print",               staticSlug: "vintage",      promptTemplate: "", keywords: ["vintage print", "antique photo", "old print", "historical photograph", "archival", "faded", "sepia tone", "albumen print"] },
  { slug: "virtual-photography",          staticSlug: "gaming",       promptTemplate: "", keywords: ["virtual photography", "video game photography", "in-game photo", "screenshot art", "game world", "photomode", "digital photography"] },
  { slug: "visual-anthropology",          staticSlug: "people",       promptTemplate: "", keywords: ["visual anthropology", "ethnographic photography", "cultural documentation", "anthropology", "tribe", "indigenous culture", "fieldwork"] },
  { slug: "vr-photography",               staticSlug: "gaming",       promptTemplate: "", keywords: ["vr photography", "virtual reality photography", "360 vr", "immersive photo", "vr tour", "360 image", "360 degree"] },
  { slug: "wedding-photography",          staticSlug: "event",        promptTemplate: "", keywords: ["wedding photography", "wedding", "bride", "groom", "ceremony", "nuptials", "reception", "marriage", "bridal", "engagement"] },
  { slug: "tele-snaps",                   staticSlug: "vintage",      promptTemplate: "", keywords: ["tele-snaps", "telesnaps", "tv screenshot", "television capture", "off-screen photo", "broadcast still", "tv still"] },
  { slug: "photo-op",                     staticSlug: "people",       promptTemplate: "", keywords: ["photo op", "photo opportunity", "posed photo", "publicity photo", "press photo opportunity", "meet and greet photo"] },
  { slug: "paris-in-motion",              staticSlug: "travel",       promptTemplate: "", keywords: ["paris", "paris photography", "city of light", "eiffel", "seine", "montmartre", "french street photography"] },
  { slug: "isap",                         staticSlug: "aerial",       promptTemplate: "", keywords: ["international society aviation photography", "isap", "aviation society", "airshow photography", "aviation club"] },
  { slug: "erotic-photography",           staticSlug: "studio",       promptTemplate: "", keywords: ["erotic", "nude", "boudoir", "intimate", "sensual portrait", "body photography", "figure study"] },
  { slug: "humanist-photography",         staticSlug: "people",       promptTemplate: "", keywords: ["humanist photography", "humanism", "humanist", "human condition", "social documentary", "people centered", "dignity"] },
];
