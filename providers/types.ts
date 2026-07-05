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
  {
    slug: "360-product-photography",
    staticSlug: "retail",
    promptTemplate: "Create a highly detailed 360-degree product photography shot of __PROMPT__. The subject must be perfectly centered on a seamless white turntable background. Use soft, diffused studio lighting with a multi-point setup to eliminate harsh shadows and highlight all textures and materials. Shot on an 85mm macro lens, f/8 aperture for a deep depth of field, 8k resolution, ultra-photorealistic commercial e-commerce style.",
    keywords: ["360 product", "360", "product photography", "product", "turntable", "ecommerce", "packshot"]
  },
  {
    slug: "abstract-photography",
    staticSlug: "abstract",
    promptTemplate: "Create a striking abstract photography composition featuring __PROMPT__. Focus entirely on non-representational forms, geometric patterns, and intricate textures. Use experimental lighting, macro details, and unconventional framing to obscure the literal subject, transforming it into a mesmerizing study of color, shape, and light. High dynamic range, fine art gallery aesthetic.",
    keywords: ["abstract", "abstract photography", "non-representational", "art", "pattern", "shape", "texture", "geometric", "experimental"]
  },
  {
    slug: "action-shot",
    staticSlug: "sport",
    promptTemplate: "A dynamic, high-energy action shot of __PROMPT__. Captured with an ultra-fast shutter speed to perfectly freeze the subject in mid-motion. The background should feature a directional motion blur (panning effect) to emphasize extreme speed and kinetic energy. Dramatic sports lighting, crisp details on the subject, vivid colors, shot on a telephoto lens (200mm).",
    keywords: ["action", "actionshot", "action shot", "motion blur", "freeze", "sport", "sports", "dynamic", "fast", "movement", "athlete", "athletes", "running", "race", "racing", "soccer", "football", "basketball", "tennis", "swimming", "cycling", "marathon", "sprint", "jump", "kick", "throw", "pitch", "tackle", "dribble", "volleyball", "baseball", "rugby", "gymnastics", "boxing", "martial arts", "skateboard", "snowboard", "skiing", "surfing", "climbing", "triathlon", "game", "match", "tournament", "competition", "championship"]
  },
  {
    slug: "aerial-photography",
    staticSlug: "aerial",
    promptTemplate: "A breathtaking aerial photography shot of __PROMPT__. Captured from a high-altitude drone perspective, utilizing a top-down bird's-eye view. Emphasize the vast scale, geometric patterns, and topographical textures of the scene below. Cinematic golden hour lighting casting long shadows, 8k resolution, hyper-realistic, wide-angle lens.",
    keywords: ["aerial", "aerial photography", "drone", "overhead", "top view", "bird's eye", "above", "altitude", "elevation"]
  },
  {
    slug: "air-to-air-photography",
    staticSlug: "aerial",
    promptTemplate: "A thrilling air-to-air photography shot featuring __PROMPT__. Captured from a chase aircraft, showing the subject flying through the sky. High-altitude atmospheric lighting, crisp metallic reflections on the aircraft, visible condensation trails or rotor blur, dramatic cloud backdrops, extreme realism, aviation magazine cover style.",
    keywords: ["air-to-air", "aircraft", "airplane", "jet", "formation", "flight", "aviation", "airborne"]
  },
  {
    slug: "analog-photography",
    staticSlug: "vintage",
    promptTemplate: "A nostalgic analog photography shot of __PROMPT__. Emulate the look of 35mm film (Kodak Portra 400). The image should feature authentic film grain, subtle halation around highlights, slightly muted vintage colors, and a soft, organic focus. Captured with a classic SLR camera, natural lighting, evocative and timeless darkroom aesthetic.",
    keywords: ["analog", "analogue", "film", "35mm", "darkroom", "chemical", "film roll", "negative", "silver halide"]
  },
  {
    slug: "architectural-photography",
    staticSlug: "estate",
    promptTemplate: "A pristine architectural photography shot of __PROMPT__. Focus on the structural geometry, facade details, and design elegance. Use a tilt-shift lens to ensure perfectly straight vertical lines. High dynamic range, balanced interior and exterior lighting, sharp focus, clean composition, professional real estate and design magazine quality.",
    keywords: ["architectural", "architecture", "building", "structure", "facade", "interior design", "exterior", "blueprint", "design"]
  },
  {
    slug: "astrophotography",
    staticSlug: "science",
    promptTemplate: "A mesmerizing astrophotography shot of __PROMPT__. Captured with a long exposure to reveal the glowing dust, vibrant nebulas, and countless stars of the deep sky. High ISO, wide-aperture telescope lens, rich cosmic colors (deep purples, blues, and magentas), minimal terrestrial light pollution, awe-inspiring celestial atmosphere.",
    keywords: ["astrophotography", "astro", "astronomy", "telescope", "space", "galaxy", "nebula", "stars", "deep sky", "milky way", "cosmos", "celestial"]
  },
  {
    slug: "aviation-photography",
    staticSlug: "aerial",
    promptTemplate: "A professional aviation photography shot of __PROMPT__. Focus on the sleek aerodynamic details, engine textures, and the sheer scale of the aircraft. Tarmac or runway setting with dramatic sunset lighting reflecting off the fuselage. Shot with a telephoto lens, sharp focus, heat haze from the exhaust, high-octane atmosphere.",
    keywords: ["aviation", "airplane", "aircraft", "airport", "runway", "pilot", "cockpit", "jet", "helicopter", "flight"]
  },
  {
    slug: "banquet-photography",
    staticSlug: "event",
    promptTemplate: "A luxurious banquet photography shot of __PROMPT__. Captured during a high-end formal event or gala. Warm, ambient chandelier lighting, elegant table settings, crystal glassware reflecting light. Shallow depth of field to focus on the subject while the festive, crowded background softly blurs into beautiful bokeh.",
    keywords: ["banquet", "gala", "dinner", "formal event", "reception", "hall", "wedding reception", "corporate dinner", "catering"]
  },
  {
    slug: "blind-photography",
    staticSlug: "abstract",
    promptTemplate: "An instinctive, spontaneous blind photography shot of __PROMPT__. Captured without looking through the viewfinder, resulting in an unconventional, slightly tilted Dutch angle. Raw, candid, unpolished aesthetic with unexpected framing, capturing a fleeting, authentic moment in time. High contrast, street photography vibe.",
    keywords: ["blind", "unseen", "surprise", "random", "instinctive", "intuitive photography", "spontaneous"]
  },
  {
    slug: "candid-photography",
    staticSlug: "people",
    promptTemplate: "A genuine candid photography shot of __PROMPT__. The subject is completely unposed and unaware of the camera, captured in a natural, spontaneous moment. Natural ambient lighting, documentary style, authentic expression, shot with an 85mm lens to create a comfortable distance, soft background blur.",
    keywords: ["candid", "candid photography", "unposed", "natural", "spontaneous", "street", "real moment", "unstaged", "paparazzi"]
  },
  {
    slug: "close-up",
    staticSlug: "science",
    promptTemplate: "An ultra-detailed close-up shot of __PROMPT__. The framing is tight, filling the entire image with the subject to reveal micro-textures, fine lines, and intricate details that are usually invisible to the naked eye. Shot with a dedicated macro lens, ring flash lighting, incredibly sharp focus on the central element.",
    keywords: ["close-up", "closeup", "close up", "detail", "magnify", "macro", "zoom", "tight shot", "focus"]
  },
  {
    slug: "cloudscape-photography",
    staticSlug: "nature",
    promptTemplate: "A dramatic cloudscape photography shot featuring __PROMPT__. The sky dominates the composition, filled with towering, volumetric cumulus or storm clouds. Rich atmospheric lighting, sunbeams breaking through the overcast sky, deep contrast between the dark storm fronts and the bright silver linings. Epic, moody, and meteorological.",
    keywords: ["cloudscape", "cloud", "sky", "overcast", "storm cloud", "cumulus", "nimbus", "weather", "atmospheric"]
  },
  {
    slug: "conceptual-photography",
    staticSlug: "abstract",
    promptTemplate: "A thought-provoking conceptual photography shot of __PROMPT__. The image should serve as a visual metaphor, heavily relying on symbolism and surrealism. Dreamlike atmosphere, meticulous studio staging, moody and dramatic lighting, fine-art aesthetic with a deep narrative undertone. High-end editorial style.",
    keywords: ["conceptual", "concept", "idea", "symbolic", "metaphor", "surreal", "fine art", "artistic statement", "creative concept"]
  },
  {
    slug: "concert-photography",
    staticSlug: "event",
    promptTemplate: "An electrifying concert photography shot of __PROMPT__. Captured live on stage with harsh, dramatic stage lighting, laser beams, and thick atmospheric fog. High ISO film grain, intense emotional energy, silhouette of the cheering crowd in the foreground, dynamic angle, capturing the raw essence of live music.",
    keywords: ["concert", "live music", "band", "stage", "performer", "musician", "crowd", "festival", "gig", "show", "spotlight"]
  },
  {
    slug: "conservation-photography",
    staticSlug: "nature",
    promptTemplate: "A powerful conservation photography shot of __PROMPT__. Designed to evoke environmental awareness, showcasing the fragile beauty of the ecosystem or wildlife. Natural, untouched lighting, documentary realism, highly detailed textures of nature, emotionally resonant, National Geographic editorial style.",
    keywords: ["conservation", "wildlife conservation", "environmental", "ecosystem", "endangered", "habitat", "protect", "nature conservation"]
  },
  {
    slug: "cursed-image",
    staticSlug: "abstract",
    promptTemplate: "A deeply unsettling 'cursed image' featuring __PROMPT__. Captured with a cheap early-2000s digital camera, harsh direct flash, bizarre and inexplicable context. Grainy texture, red-eye effect, weird liminal space background, evoking a sense of eerie discomfort and internet-lore mystery. Low fidelity, uncanny valley vibes.",
    keywords: ["cursed", "unsettling", "weird", "eerie", "disturbing", "odd", "bizarre", "uncanny", "strange photo"]
  },
  {
    slug: "die-shot",
    staticSlug: "technology",
    promptTemplate: "A microscopic die shot of __PROMPT__. Captured with an electron microscope or extreme macro setup, revealing the intricate, glowing neon architecture of a semiconductor silicon wafer. Geometric circuit patterns, rainbow iridescence, metallic reflections, ultra-high resolution, technological and futuristic aesthetic.",
    keywords: ["die shot", "die", "chip", "semiconductor", "integrated circuit", "cpu", "processor", "silicon wafer", "micro chip"]
  },
  {
    slug: "dog-shaming",
    staticSlug: "people",
    promptTemplate: "A humorous 'dog shaming' style photo of __PROMPT__. A guilty-looking pet sitting next to the mess they made, with a handwritten cardboard sign draped over them explaining their 'crime'. Casual smartphone photography style, bright indoor lighting, funny and relatable internet meme aesthetic.",
    keywords: ["dog shaming", "pet", "dog", "animal misbehave", "sign", "funny pet", "meme"]
  },
  {
    slug: "eclipse-photography",
    staticSlug: "science",
    promptTemplate: "A stunning eclipse photography shot of __PROMPT__. Featuring the exact moment of totality, with the glowing solar corona bursting around the pitch-black silhouette of the moon. Deep space background, high dynamic range, captured with a solar filter and telephoto lens, awe-inspiring astronomical event.",
    keywords: ["eclipse", "solar eclipse", "lunar eclipse", "totality", "corona", "sun", "moon", "shadow", "astronomical event"]
  },
  {
    slug: "event-photography",
    staticSlug: "event",
    promptTemplate: "A professional event photography shot of __PROMPT__. Captured during a corporate conference or formal gathering. Well-lit with bounced flash, showing people engaging naturally. Sharp focus on the main subject, vibrant but accurate skin tones, polished and ready for a press release or company newsletter.",
    keywords: ["event", "event photography", "ceremony", "gathering", "conference", "meeting", "awards", "launch", "occasion"]
  },
  {
    slug: "fancy-portrait",
    staticSlug: "studio",
    promptTemplate: "An elaborate fancy portrait of __PROMPT__. The subject is dressed in highly detailed, luxurious formal wear or historical costume. Shot in a high-end photography studio with Rembrandt lighting, rich velvet backdrops, painted canvas textures, and a classical, painterly aesthetic reminiscent of old masters.",
    keywords: ["fancy portrait", "formal portrait", "dressed up", "costume", "period portrait", "elaborate", "fine portrait"]
  },
  {
    slug: "fashion-photography",
    staticSlug: "cosmetic",
    promptTemplate: "A high-end fashion photography editorial featuring __PROMPT__. The subject is striking a dynamic, avant-garde pose. Focus on the exquisite textures of the designer wardrobe and flawless makeup. Shot with a medium format camera, dramatic studio lighting, glossy Vogue magazine cover aesthetic, ultra-chic and stylish.",
    keywords: ["fashion", "fashion photography", "model", "runway", "editorial", "clothing", "style", "wardrobe", "designer", "couture", "vogue"]
  },
  {
    slug: "femto-photography",
    staticSlug: "science",
    promptTemplate: "An ultra-fast femto-photography shot of __PROMPT__. Capturing light propagation at a trillion frames per second. Visualizing the actual movement of light waves or a microsecond physical event (like a bullet piercing glass). Scientific imaging aesthetic, laser illumination, stark black background, hyper-detailed freeze frame.",
    keywords: ["femto", "femtosecond", "ultra-fast", "light propagation", "trillion fps", "slow light", "scientific imaging"]
  },
  {
    slug: "film-still",
    staticSlug: "studio",
    promptTemplate: "A cinematic film still featuring __PROMPT__. Shot in a wide anamorphic aspect ratio (2.39:1). Cinematic color grading (teal and orange), dramatic motivated lighting, shallow depth of field, subtle film grain. It looks exactly like a paused frame from a high-budget Hollywood blockbuster movie.",
    keywords: ["film still", "movie still", "cinema", "behind the scenes", "set photo", "screenshot", "frame", "director", "scene"]
  },
  {
    slug: "fine-art-photography",
    staticSlug: "abstract",
    promptTemplate: "A museum-quality fine art photography piece of __PROMPT__. Highly expressive and aesthetic, focusing on composition, emotion, and lighting rather than pure documentation. Soft, moody atmosphere, rich tonal range, printed on matte archival paper texture, evocative and deeply artistic.",
    keywords: ["fine art", "fine-art photography", "gallery", "museum", "artistic", "expressive", "creative", "aesthetic", "art print"]
  },
  {
    slug: "fire-photography",
    staticSlug: "red",
    promptTemplate: "An intense fire photography shot of __PROMPT__. The frame is illuminated entirely by the roaring, vivid orange and red flames. Sparks flying through the air, heat distortion blurring the background. Fast shutter speed to freeze the intricate, chaotic shapes of the fire. Dark, moody, and dangerous atmosphere.",
    keywords: ["fire", "flame", "blaze", "burning", "inferno", "campfire", "wildfire", "heat", "combustion", "spark"]
  },
  {
    slug: "fireworks-photography",
    staticSlug: "red",
    promptTemplate: "A spectacular fireworks photography shot of __PROMPT__. Captured with a long exposure (bulb mode) to show the full, blooming trails of the pyrotechnics against a pitch-black night sky. Vibrant, saturated colors (gold, red, blue), crisp light trails, festive and celebratory atmosphere.",
    keywords: ["fireworks", "firework", "pyrotechnic", "explosion", "celebration", "new year", "4th of july", "sparkle", "night fireworks"]
  },
  {
    slug: "food-photography",
    staticSlug: "food",
    promptTemplate: "A mouth-watering food photography shot of __PROMPT__. The dish is perfectly plated and styled. Shot with a macro lens to highlight the glistening textures, steam, and freshness of the ingredients. Soft, directional window light (backlit) to create appetizing highlights, rustic wooden table background, gourmet culinary magazine style.",
    keywords: ["food", "food photography", "dish", "meal", "cuisine", "plating", "ingredient", "culinary", "gourmet", "recipe"]
  },
  {
    slug: "food-photography-social-media",
    staticSlug: "food",
    promptTemplate: "A trendy social media food photography shot of __PROMPT__. Captured from a top-down flatlay perspective. The composition includes aesthetic props, a cup of coffee, and hands reaching into the frame. Bright, airy lighting, high saturation, Instagram-ready aesthetic, casual yet perfectly curated cafe vibe.",
    keywords: ["food social media", "instagram food", "flatlay", "food blog", "foodie", "overhead food", "aesthetic food", "trending food"]
  },
  {
    slug: "forensic-photography",
    staticSlug: "legal",
    promptTemplate: "A stark forensic photography shot of __PROMPT__. Captured at a crime scene with a harsh, direct ring flash. Yellow evidence markers and a scale ruler are visible in the frame. Clinical, objective, hyper-detailed, no artistic shadows, pure documentation style, gritty and realistic police investigation aesthetic.",
    keywords: ["forensic", "forensic photography", "crime scene", "evidence", "investigation", "police", "court", "criminal", "detective"]
  },
  {
    slug: "found-photography",
    staticSlug: "vintage",
    promptTemplate: "A nostalgic 'found photography' snapshot of __PROMPT__. Looks like an anonymous, vernacular photo discovered in a flea market. Faded colors, physical wear and tear on the photo edges, slight light leaks, captured on cheap consumer film from the 1970s or 80s. Authentic, mundane, and deeply personal memory aesthetic.",
    keywords: ["found photography", "found photo", "discovered photo", "vernacular", "anonymous", "old photo", "flea market photo"]
  },
  {
    slug: "genre-art",
    staticSlug: "abstract",
    promptTemplate: "A photographic genre art scene of __PROMPT__. Capturing ordinary people engaged in everyday life. Narrative-driven, richly detailed environment, warm and inviting lighting. The composition tells a quiet, relatable story, reminiscent of classical genre paintings brought to life through modern photography.",
    keywords: ["genre art", "genre scene", "everyday life", "genre painting", "narrative art", "storytelling", "scene"]
  },
  {
    slug: "geophotography",
    staticSlug: "nature",
    promptTemplate: "A sweeping geophotography shot of __PROMPT__. Focusing on the raw geological formations, rock strata, and earth's topography. Shot during golden hour to emphasize the rugged textures and layers of the terrain. High depth of field, ultra-sharp details, National Geographic landscape documentary style.",
    keywords: ["geophotography", "geology", "earth", "rock formation", "landscape", "geographic", "terrain", "topography", "land", "mountain", "mountains", "valley", "valley", "hills", "sunset", "sunrise", "scenery", "scenic", "vista", "panorama", "forest", "river", "lake", "waterfall", "canyon", "desert", "meadow", "field", "plains", "nature", "outdoor", "outdoors", "wilderness", "countryside", "rolling hills", "golden hour", "dusk", "dawn"]
  },
  {
    slug: "glamour-photography",
    staticSlug: "cosmetic",
    promptTemplate: "A sensual glamour photography portrait of __PROMPT__. The subject is alluring and elegant, styled flawlessly. Soft, flattering beauty lighting (clamshell setup) to create glowing skin and sparkling catchlights in the eyes. Luxurious background, romantic and sophisticated boudoir aesthetic, highly polished.",
    keywords: ["glamour", "glamour photography", "sensual", "alluring", "beauty", "pin-up", "boudoir", "elegant", "seductive"]
  },
  {
    slug: "high-key",
    staticSlug: "white",
    promptTemplate: "A luminous high-key photography shot of __PROMPT__. The image is intentionally overexposed with a predominantly white and light-toned palette. Soft, airy, and dreamlike lighting with almost no dark shadows. Minimalist composition, conveying a sense of purity, lightness, and optimism.",
    keywords: ["high key", "highkey", "bright", "overexposed", "white tones", "soft light", "airy", "light background", "luminous"]
  },
  {
    slug: "high-speed-photography",
    staticSlug: "technology",
    promptTemplate: "An incredible high-speed photography shot of __PROMPT__. Captured with a microsecond strobe flash to perfectly freeze a rapid event (like a water splash or shattering glass). Crystal-clear macro details, suspended droplets in mid-air, stark contrasting background, scientific precision and dramatic impact.",
    keywords: ["high-speed", "high speed photography", "freeze motion", "water drop", "bullet", "splash", "strobe", "fast shutter", "microsecond"]
  },
  {
    slug: "imagery-intelligence",
    staticSlug: "aerial",
    promptTemplate: "A tactical imagery intelligence (IMINT) photo of __PROMPT__. Looks like a high-resolution classified satellite or reconnaissance drone image. Top-down overhead perspective, black-and-white or false-color infrared, digital crosshairs and coordinate overlays, stark, clinical, and surveillance-focused aesthetic.",
    keywords: ["imagery intelligence", "reconnaissance", "surveillance", "satellite imagery", "geospatial", "spy", "intelligence", "overhead surveillance"]
  },
  {
    slug: "impressionist-photography",
    staticSlug: "blurred",
    promptTemplate: "An artistic impressionist photography shot of __PROMPT__. Utilizing intentional camera movement (ICM) or soft focus lenses to create a dreamy, painterly effect. Colors blend smoothly into one another, resembling an oil painting by Monet. Soft, romantic lighting, abstract and emotionally evocative.",
    keywords: ["impressionist photography", "impressionist", "painterly", "soft", "dreamy", "pictorialist", "blended", "motion blur art"]
  },
  {
    slug: "kirlian-photography",
    staticSlug: "wellness",
    promptTemplate: "A mystical Kirlian photography image of __PROMPT__. The subject is placed directly on a photographic plate, surrounded by a glowing, high-voltage corona discharge. Vibrant, electric auras of blue, purple, and red energy radiating from the edges against a pitch-black background. Bioelectrography aesthetic.",
    keywords: ["kirlian", "aura", "electromagnetic", "corona discharge", "energy field", "bioelectrography", "spirit photography"]
  },
  {
    slug: "lifestyle-photography",
    staticSlug: "people",
    promptTemplate: "An authentic lifestyle photography shot of __PROMPT__. Capturing real-life, everyday moments in a highly aesthetic but candid way. Bright, natural window lighting, cozy and relatable environment, genuine smiles and interactions. Looks like a high-end commercial ad for modern, happy living.",
    keywords: ["lifestyle", "lifestyle photography", "daily life", "candid living", "authentic", "real life", "family", "couple", "everyday"]
  },
  {
    slug: "lo-fi-photography",
    staticSlug: "vintage",
    promptTemplate: "A gritty lo-fi photography shot of __PROMPT__. Captured with a cheap toy camera or early flip phone. Low fidelity, heavy digital noise, chromatic aberration, blown-out highlights, imperfect framing, and a highly nostalgic, raw, underground zine aesthetic.",
    keywords: ["lo-fi", "lofi", "low fidelity", "grainy", "cheap camera", "toy camera", "low quality aesthetic", "imperfect"]
  },
  {
    slug: "lolcat",
    staticSlug: "people",
    promptTemplate: "A classic 'lolcat' internet meme style photo of __PROMPT__. Featuring a funny, expressive pet in a humorous or awkward situation. Shot with a basic consumer digital camera, harsh flash, unpolished composition, overlaid with bold white Impact font text (optional), viral internet humor aesthetic.",
    keywords: ["lolcat", "meme", "cat meme", "funny cat", "internet meme", "humorous", "viral photo"]
  },
  {
    slug: "lomography",
    staticSlug: "vintage",
    promptTemplate: "A vibrant Lomography shot of __PROMPT__. Captured with a plastic lens camera (like a Holga or Diana). Featuring heavy vignetting, unpredictable light leaks, cross-processed neon colors (high saturation, shifted hues), blurry edges, and a carefree, experimental analog vibe.",
    keywords: ["lomography", "lomo", "lomographic", "holga", "diana", "vignette", "light leak", "cross process", "plastic lens"]
  },
  {
    slug: "long-exposure-photography",
    staticSlug: "science",
    promptTemplate: "A stunning long-exposure photography shot of __PROMPT__. The camera shutter was left open for several seconds, transforming moving elements (like water or car lights) into smooth, silky blurs or continuous light trails. Sharp, stationary background elements, twilight or night setting, magical and surreal atmosphere.",
    keywords: ["long exposure", "long-exposure", "light trail", "car trail", "silk water", "star trail", "slow shutter", "nightscape", "light painting"]
  },
  {
    slug: "low-key",
    staticSlug: "black",
    promptTemplate: "A dramatic low-key photography shot of __PROMPT__. The image is predominantly dark, utilizing deep, rich shadows and a black background. A single, directed light source (chiaroscuro lighting) highlights only the most important features of the subject. Moody, mysterious, and highly cinematic.",
    keywords: ["low key", "lowkey", "dark", "shadow", "moody", "dramatic", "chiaroscuro", "underexposed", "noir", "deep shadow"]
  },
  {
    slug: "low-key-photography",
    staticSlug: "black",
    promptTemplate: "A masterful low-key photography portrait of __PROMPT__. Utilizing classic Rembrandt or split lighting. The subject emerges from a pitch-black background, with deep shadows sculpting their features. High contrast, intense emotional depth, raw and powerful, shot in a professional studio setting.",
    keywords: ["low-key photography", "dark portrait", "rembrandt lighting", "split lighting", "dramatic light", "dark background"]
  },
  {
    slug: "macro-photography",
    staticSlug: "science",
    promptTemplate: "An extreme macro photography shot of __PROMPT__. Captured at a 1:1 magnification ratio to reveal a tiny, hidden world. Incredible microscopic details, crystalline textures, extremely shallow depth of field with creamy bokeh in the background. Ring flash lighting to illuminate the tiny subject perfectly.",
    keywords: ["macro", "macro photography", "extreme close-up", "magnification", "insect", "flower detail", "1:1", "extension tube", "ring flash"]
  },
  {
    slug: "medical-photography",
    staticSlug: "medical",
    promptTemplate: "A clinical medical photography shot of __PROMPT__. Captured for healthcare imaging purposes. Utilitarian, perfectly exposed with flat, shadowless ring lighting to document anatomical details accurately. Sterile environment, high resolution, objective and highly detailed scientific documentation.",
    keywords: ["medical photography", "clinical photography", "surgical", "pathology", "dermatology", "anatomy", "patient", "healthcare imaging"]
  },
  {
    slug: "minimalist-photography",
    staticSlug: "minimal",
    promptTemplate: "A striking minimalist photography shot of __PROMPT__. The composition relies heavily on vast, clean negative space. Only one or two elements are in the frame. Clean lines, sparse geometry, simple and harmonious color palette. 'Less is more' aesthetic, evoking a sense of calm and modern elegance.",
    keywords: ["minimalist photography", "minimalism", "negative space", "clean", "simple", "sparse", "less is more", "uncluttered"]
  },
  {
    slug: "monochrome-photography",
    staticSlug: "monochrome",
    promptTemplate: "A timeless monochrome photography shot of __PROMPT__. Rendered entirely in rich black, white, and grayscale tones. Focus on texture, contrast, and dramatic lighting rather than color. Deep blacks, crisp whites, Ansel Adams style tonal range, highly evocative and classic.",
    keywords: ["monochrome", "black and white", "grayscale", "bnw", "bw", "mono", "desaturated", "silver", "tonal"]
  },
  {
    slug: "mug-shot",
    staticSlug: "legal",
    promptTemplate: "A realistic police mug shot of __PROMPT__. Captured against a stark, height-chart background. Flat, harsh, unflattering fluorescent lighting. The subject is looking deadpan directly into the camera. Clinical, documentary style, resembling an authentic booking photo or criminal record ID.",
    keywords: ["mug shot", "mugshot", "booking photo", "arrest", "criminal record", "police photo", "id photo", "wanted"]
  },
  {
    slug: "narrative-photography",
    staticSlug: "people",
    promptTemplate: "A compelling narrative photography shot of __PROMPT__. The image tells a deep, visual story within a single frame. Rich environmental details, expressive body language, cinematic lighting and composition. It feels like a pivotal scene pulled from a larger documentary photo essay.",
    keywords: ["narrative", "storytelling photography", "photo story", "series", "photographic narrative", "documentary story", "visual narrative"]
  },
  {
    slug: "new-topographics",
    staticSlug: "outdoor",
    promptTemplate: "A 'New Topographics' style photograph of __PROMPT__. Focusing on man-altered landscapes, suburban sprawl, or industrial areas. Deadpan, objective, unromanticized composition. Flat, even lighting, highly detailed large-format aesthetic, capturing the mundane and banal reality of the modern environment.",
    keywords: ["new topographics", "topographic", "man-altered landscape", "industrial landscape", "suburban", "mundane", "banal landscape"]
  },
  {
    slug: "night-photography",
    staticSlug: "black",
    promptTemplate: "A captivating night photography shot of __PROMPT__. Captured in low-light conditions, illuminated by artificial city lights, neon signs, or moonlight. High ISO, rich shadows, glowing highlights, cinematic nocturnal atmosphere, evoking the quiet and mystery of the world after dark.",
    keywords: ["night photography", "night", "nocturnal", "low light", "city lights", "nightscape", "dark sky", "astrophotography night"]
  },
  {
    slug: "old-time-photography",
    staticSlug: "vintage",
    promptTemplate: "An authentic old-time photography portrait of __PROMPT__. Emulating a 19th-century tintype or daguerreotype. Sepia-toned or monochrome, heavy scratches, dust, and chemical stains on the plate. The subject is in period-accurate historical clothing, holding a rigid, unsmiling pose. Antique, archival aesthetic.",
    keywords: ["old-time photography", "old time photo", "historical costume", "period dress", "vintage portrait", "sepia", "daguerreotype"]
  },
  {
    slug: "panorama",
    staticSlug: "aerial",
    promptTemplate: "A sweeping panoramic photography shot of __PROMPT__. Captured in an ultra-wide aspect ratio to encompass a massive field of view. Seamlessly stitched, edge-to-edge sharpness, epic landscape scale, highly detailed, capturing the full grandeur of the scene.",
    keywords: ["panorama", "panoramic", "wide angle", "360 view", "landscape panorama", "stitched", "wide scene"]
  },
  {
    slug: "panoramic-photography",
    staticSlug: "aerial",
    promptTemplate: "An immersive 360-degree panoramic photography view of __PROMPT__. The image is stretched in a cylindrical or spherical projection, showing the entire surrounding environment. Wide-angle distortion at the edges, incredibly detailed, VR-ready architectural or landscape documentation.",
    keywords: ["panoramic photography", "wide panorama", "360 panorama", "vr panorama", "cylindrical", "spherical panorama"]
  },
  {
    slug: "photobiography",
    staticSlug: "people",
    promptTemplate: "An intimate photobiography shot of __PROMPT__. Capturing a deeply personal, documentary-style moment that tells the life story of the subject. Surrounded by meaningful personal artifacts, natural lighting, raw emotion, resembling a page from a cherished family memoir or archive.",
    keywords: ["photobiography", "photo biography", "life story", "memoir", "biographical", "documentary life", "personal archive"]
  },
  {
    slug: "photobombing",
    staticSlug: "people",
    promptTemplate: "A hilarious photobombing snapshot featuring __PROMPT__. The main subjects in the foreground are posing for a normal photo, while an unexpected, funny, or bizarre element ruins the background. Casual smartphone camera aesthetic, candid and unscripted surprise moment.",
    keywords: ["photobombing", "photobomb", "unexpected", "background surprise", "ruined photo", "uninvited", "funny background"]
  },
  {
    slug: "photography-indigenous-peoples",
    staticSlug: "people",
    promptTemplate: "A respectful, culturally rich photograph of __PROMPT__. Documenting indigenous or traditional community life. Focus on authentic traditional garments, cultural heritage, and deep human dignity. Natural lighting, anthropological documentary style, highly detailed and emotionally resonant.",
    keywords: ["indigenous", "native", "tribal", "ethnic", "cultural", "traditional community", "anthropology", "heritage"]
  },
  {
    slug: "photojournalism",
    staticSlug: "people",
    promptTemplate: "A gritty, impactful photojournalism shot of __PROMPT__. Captured in the heat of a breaking news event. Raw, unedited documentary aesthetic, dynamic and slightly chaotic framing, capturing the intense reality and human emotion of current events. Pulitzer Prize-winning press photo style.",
    keywords: ["photojournalism", "news photography", "press photo", "journalist", "breaking news", "documentary", "current events", "war photography"]
  },
  {
    slug: "photovoice",
    staticSlug: "people",
    promptTemplate: "An empowering 'photovoice' style image of __PROMPT__. A grassroots, participatory photography shot intended to highlight a community issue or advocate for social change. Authentic, taken from the perspective of a community member, raw, narrative-driven, and socially impactful.",
    keywords: ["photovoice", "community photography", "empowerment", "social change", "participatory", "advocacy", "grassroots"]
  },
  {
    slug: "photowalking",
    staticSlug: "travel",
    promptTemplate: "A casual yet observant photowalking shot of __PROMPT__. Captured while exploring an urban environment on foot. Interesting street geometry, candid pedestrian interactions, natural daylight, point-of-view perspective, capturing the hidden beauty of everyday city life.",
    keywords: ["photowalking", "photowalk", "photo walk", "walking photography", "urban exploration", "street walk", "city walk"]
  },
  {
    slug: "pictorialism",
    staticSlug: "vintage",
    promptTemplate: "A vintage pictorialism photography shot of __PROMPT__. Emulating early 20th-century art photography. Extremely soft focus, painterly textures, sepia or warm monochrome tones. Looks like a gum bichromate or platinum print. Dreamy, romantic, and heavily atmospheric.",
    keywords: ["pictorialism", "pictorialist", "soft focus artistic", "painterly photography", "gum print", "platinum print", "art photography movement"]
  },
  {
    slug: "polaroid-art",
    staticSlug: "vintage",
    promptTemplate: "A retro Polaroid art shot of __PROMPT__. Framed within the classic white instant film border. Soft, faded colors, washed-out highlights, slight chemical imperfections, and a nostalgic, instantaneous aesthetic. Flash photography, casual and intimate memory capture.",
    keywords: ["polaroid", "instant photo", "polaroid art", "impossible project", "instax", "instant film", "analog instant"]
  },
  {
    slug: "portrait-photography",
    staticSlug: "people",
    promptTemplate: "A stunning, high-resolution portrait photography shot of __PROMPT__. The subject is sharply in focus, with expressive eyes and flawless skin texture. Shot on an 85mm lens at f/1.4 to create a beautiful, creamy bokeh background. Flattering studio lighting, capturing the true character and likeness of the person.",
    keywords: ["portrait", "portrait photography", "headshot", "face", "expression", "character", "subject", "likeness", "pose"]
  },
  {
    slug: "post-mortem-photography",
    staticSlug: "vintage",
    promptTemplate: "An eerie, historical post-mortem photography portrait of __PROMPT__. Emulating Victorian-era memorial photography. Sepia-toned, solemn atmosphere, the subject is posed to look peacefully asleep, surrounded by floral tributes. Antique film texture, hauntingly beautiful and melancholic.",
    keywords: ["post-mortem", "postmortem photography", "memorial photography", "victorian death photo", "memorial portrait"]
  },
  {
    slug: "red-shirt-photography",
    staticSlug: "people",
    promptTemplate: "A staged 'red shirt' group photography shot featuring __PROMPT__. A highly organized, posed crowd where everyone is wearing matching uniforms (red shirts). Corporate or team-building aesthetic, bright even lighting, wide-angle lens, everyone smiling at the camera.",
    keywords: ["red shirt", "red shirt photography", "posed group", "staged crowd", "uniform group", "corporate group photo"]
  },
  {
    slug: "rogues-gallery",
    staticSlug: "legal",
    promptTemplate: "A vintage 'rogues gallery' style collection of mug shots featuring __PROMPT__. Arranged in a grid of gritty, black-and-white early 20th-century police booking photos. Scowling faces, period-accurate clothing, physical ID numbers held up, archival crime record aesthetic.",
    keywords: ["rogues gallery", "rogue", "criminal collection", "mug shot collection", "police archive", "wanted photos"]
  },
  {
    slug: "ruins-photography",
    staticSlug: "outdoor",
    promptTemplate: "A haunting ruins photography shot of __PROMPT__. Capturing the decay of an abandoned, derelict structure. Peeling paint, crumbling concrete, nature reclaiming the architecture. Moody, overcast lighting, high dynamic range to capture the intricate textures of decay. Urban exploration (urbex) aesthetic.",
    keywords: ["ruins", "ruin", "abandoned", "decay", "urban exploration", "urbex", "derelict", "ghost town", "lost place", "crumbling"]
  },
  {
    slug: "satellite-imagery",
    staticSlug: "aerial",
    promptTemplate: "A high-resolution satellite imagery view of __PROMPT__. Taken from Earth orbit. Top-down, flat perspective, showing geospatial data, terrain mapping, and remote sensing details. Crisp digital textures, Google Earth aesthetic, objective and vast in scale.",
    keywords: ["satellite imagery", "satellite", "remote sensing", "geospatial", "earth observation", "aerial map", "google earth", "landsat"]
  },
  {
    slug: "secret-photography",
    staticSlug: "people",
    promptTemplate: "A covert, secret photography shot of __PROMPT__. Captured from a hidden vantage point, simulating a surveillance camera, spy cam, or paparazzi telephoto lens. Slightly grainy, obstructed foreground elements (like shooting through blinds or foliage), candid and unaware subject.",
    keywords: ["secret photography", "covert", "hidden camera", "surveillance", "spy photography", "candid secret", "paparazzi"]
  },
  {
    slug: "self-portrait",
    staticSlug: "people",
    promptTemplate: "An intimate self-portrait photography shot of __PROMPT__. The composition implies the subject is holding the camera or shooting in a mirror. Personal, autobiographical aesthetic, creative angles, authentic expression, capturing the artist's self-documentation.",
    keywords: ["self portrait", "selfie", "self-portrait", "self photo", "autobiographical", "mirror shot", "self documentation"]
  },
  {
    slug: "skate-photography",
    staticSlug: "sport",
    promptTemplate: "A high-energy skate photography shot of __PROMPT__. Captured with an ultra-wide fisheye lens from a low angle. The skater is frozen mid-trick (like a kickflip) against an urban backdrop. Harsh off-camera flash to illuminate the subject against the sky, gritty, dynamic, Thrasher magazine style.",
    keywords: ["skate", "skateboarding", "skater", "trick", "halfpipe", "grind", "kickflip", "ollie", "skate park", "urban skate"]
  },
  {
    slug: "slow-photography",
    staticSlug: "blurred",
    promptTemplate: "An artistic slow photography shot of __PROMPT__. Utilizing a slow shutter speed to create beautiful, intentional motion blur. The subject is smoothly blurred, suggesting the passage of time and graceful movement. Soft, ethereal lighting, contemplative and poetic visual style.",
    keywords: ["slow photography", "slow shutter", "motion blur", "panning", "intentional camera movement", "icm", "blurred motion"]
  },
  {
    slug: "snapshot-photography",
    staticSlug: "people",
    promptTemplate: "A casual snapshot photography image of __PROMPT__. Captured with a point-and-shoot camera. Unpretentious, spontaneous, slightly imperfect framing, direct on-camera flash. Capturing a genuine, fleeting family or friend memory without professional staging.",
    keywords: ["snapshot", "snapshot photography", "casual photo", "family snapshot", "amateur", "point and shoot", "memory"]
  },
  {
    slug: "social-photography",
    staticSlug: "people",
    promptTemplate: "A highly curated social media photography shot of __PROMPT__. Vertical 9:16 aspect ratio, bright, high-contrast, trendy aesthetic. Looks perfectly styled for an Instagram or TikTok feed. Vibrant colors, engaging composition, visually popping and designed for maximum likes.",
    keywords: ["social photography", "social media", "instagram", "facebook", "shared photo", "community photo", "social network"]
  },
  {
    slug: "soft-focus",
    staticSlug: "blurred",
    promptTemplate: "A dreamy soft-focus photography shot of __PROMPT__. Captured with a diffusion filter or vintage soft lens. The edges of the subject glow gently, with a romantic, hazy, and ethereal atmosphere. Low contrast, pastel tones, eliminating harsh lines for a gentle, beautified aesthetic.",
    keywords: ["soft focus", "soft lens", "diffused", "gentle blur", "dreamy", "romantic soft", "fog filter", "haze"]
  },
  {
    slug: "spirit-photography",
    staticSlug: "wellness",
    promptTemplate: "A chilling 19th-century spirit photography hoax image of __PROMPT__. A sepia-toned or monochrome portrait where a translucent, ghostly apparition or 'ectoplasm' appears faintly in the background through a double-exposure effect. Paranormal, eerie, and historically mysterious aesthetic.",
    keywords: ["spirit photography", "ghost", "double exposure", "séance", "paranormal", "apparition", "spirit", "ectoplasm"]
  },
  {
    slug: "staged-photography",
    staticSlug: "studio",
    promptTemplate: "A meticulously staged photography tableau of __PROMPT__. Every element in the frame is deliberately constructed and arranged. Theatrical lighting, hyper-real cinematic set design, narrative-heavy composition. Looks like a high-budget Gregory Crewdson fine-art piece.",
    keywords: ["staged photography", "directed", "constructed", "tableaux", "setup", "arranged", "theatrical photography", "cinematic"]
  },
  {
    slug: "star-trail",
    staticSlug: "science",
    promptTemplate: "A breathtaking star trail photography shot of __PROMPT__. Captured over several hours, showing the rotation of the Earth as continuous, glowing concentric circles of starlight in the night sky. A dark, silhouetted landscape in the foreground, deep cosmic blues, awe-inspiring astrophotography.",
    keywords: ["star trail", "startrail", "star trails", "long exposure stars", "earth rotation", "polar star", "night sky rotation", "celestial motion"]
  },
  {
    slug: "still-life-photography",
    staticSlug: "minimal",
    promptTemplate: "A classical still-life photography shot of __PROMPT__. A beautifully composed arrangement of inanimate objects on a tabletop. Chiaroscuro lighting, rich textures, deep shadows, reminiscent of a Renaissance oil painting. Perfect balance, sharp focus, elegant and timeless.",
    keywords: ["still life", "still-life photography", "object", "arrangement", "tabletop", "product still", "flat lay", "composed objects"]
  },
  {
    slug: "straight-photography",
    staticSlug: "abstract",
    promptTemplate: "A purist 'straight photography' shot of __PROMPT__. Unmanipulated, highly detailed, and sharply focused from edge to edge (f/64 style). Maximum depth of field, high contrast black-and-white or stark color. Objective, realist depiction of the subject with absolute technical perfection.",
    keywords: ["straight photography", "purist", "unmanipulated", "documentary style", "realist", "no darkroom", "f/64", "zone system"]
  },
  {
    slug: "street-photography",
    staticSlug: "cityscape",
    promptTemplate: "A compelling street photography shot of __PROMPT__. Captured candidly in a bustling urban public space. Strong geometric composition, interplay of harsh sunlight and deep shadows, decisive moment timing. Gritty, authentic city life documentation, shot on a 35mm lens.",
    keywords: ["street photography", "street", "urban", "candid street", "public space", "city life", "pedestrian", "sidewalk", "urban candid"]
  },
  {
    slug: "subminiature-photography",
    staticSlug: "vintage",
    promptTemplate: "A grainy subminiature photography shot of __PROMPT__. Simulating a photo taken with a tiny Cold War-era spy camera (like a Minox). Low resolution, heavy grain, covert angle, black and white, espionage and intelligence gathering aesthetic.",
    keywords: ["subminiature", "subminiature camera", "minox", "spy camera", "miniature film", "tiny camera", "micro format"]
  },
  {
    slug: "theatre-photography",
    staticSlug: "event",
    promptTemplate: "A dramatic theatre photography shot of __PROMPT__. Captured during a live stage performance. Intense, highly motivated spotlighting cutting through stage haze. The actor is captured mid-performance with deep emotional expression. High contrast, dark background, capturing the magic of the stage.",
    keywords: ["theatre", "theater photography", "stage", "performance", "actor", "play", "opera", "dance performance", "spotlight stage"]
  },
  {
    slug: "thoughtography",
    staticSlug: "wellness",
    promptTemplate: "A bizarre 'thoughtography' (nensha) image of __PROMPT__. Simulating a psychic projection onto unexposed film. Blurry, distorted, high-contrast black and white, with the subject appearing to burn or warp onto the paper. Paranormal, unsettling, and abstract occult aesthetic.",
    keywords: ["thoughtography", "psychic photography", "projected thought", "nensha", "paranormal image", "psychokinesis photo"]
  },
  {
    slug: "time-lapse-photography",
    staticSlug: "season",
    promptTemplate: "A dynamic time-lapse photography composite of __PROMPT__. Blending multiple moments of time into a single frame, showing the progression from day to night or the blooming of a flower. Streaking clouds, shifting light, conveying the rapid passage of time in a hyper-real landscape.",
    keywords: ["time-lapse", "timelapse", "time lapse photography", "hyperlapse", "flower blooming", "cloud movement", "day to night"]
  },
  {
    slug: "travel-photography",
    staticSlug: "travel",
    promptTemplate: "An inspiring travel photography shot of __PROMPT__. Capturing the essence and culture of an exotic destination. Vibrant colors, iconic landmarks in the background, golden hour lighting. High-quality editorial style, evoking a deep sense of wanderlust and adventure.",
    keywords: ["travel", "travel photography", "trip", "destination", "explore", "adventure", "landmark", "culture", "tourism", "wanderlust", "globe"]
  },
  {
    slug: "ultraviolet-photography",
    staticSlug: "science",
    promptTemplate: "A surreal ultraviolet (UV) photography shot of __PROMPT__. Captured under black light, revealing glowing, neon fluorescent patterns invisible to the naked eye. Deep purple and black background, intense glowing colors (cyan, magenta, yellow), scientific and psychedelic aesthetic.",
    keywords: ["ultraviolet photography", "uv photography", "uv light", "fluorescence", "black light", "invisible spectrum", "uv fluorescent"]
  },
  {
    slug: "underwater-photography",
    staticSlug: "blue",
    promptTemplate: "A crystal-clear underwater photography shot of __PROMPT__. Captured by a scuba diver in the deep ocean or a coral reef. Beautiful blue aquatic tones, shafts of sunlight piercing through the water surface (god rays), floating particles, vibrant marine life textures.",
    keywords: ["underwater photography", "underwater", "scuba", "dive", "ocean floor", "coral reef", "marine life", "aquatic", "sub-aqua"]
  },
  {
    slug: "underwater-videography",
    staticSlug: "blue",
    promptTemplate: "A cinematic underwater videography still of __PROMPT__. Shot with a wide-angle dome port lens. Smooth, fluid motion blur, rich teal and blue color grading, dynamic lighting from an underwater video rig. Looks like a frame from a high-end BBC ocean documentary.",
    keywords: ["underwater videography", "underwater video", "underwater film", "dive video", "ocean documentary", "marine video"]
  },
  {
    slug: "vernacular-photography",
    staticSlug: "people",
    promptTemplate: "A mundane yet fascinating vernacular photography shot of __PROMPT__. An amateur, everyday snapshot capturing ordinary life without artistic pretension. Flash-lit, slightly awkward framing, authentic 1990s family photo album aesthetic, deeply nostalgic and human.",
    keywords: ["vernacular photography", "everyday photo", "amateur snapshot", "found vernacular", "ordinary", "mundane photo", "home photo"]
  },
  {
    slug: "vintage-print",
    staticSlug: "vintage",
    promptTemplate: "A beautiful, archival vintage print of __PROMPT__. Emulating an antique albumen print or faded silver gelatin photo. Sepia or warm monochrome tones, cracked emulsion texture, soft vignette, historical and timeless museum artifact aesthetic.",
    keywords: ["vintage print", "antique photo", "old print", "historical photograph", "archival", "faded", "sepia tone", "albumen print"]
  },
  {
    slug: "virtual-photography",
    staticSlug: "gaming",
    promptTemplate: "A stunning virtual photography shot of __PROMPT__. Captured inside a next-gen video game engine using photo mode. Hyper-realistic 3D rendering, dramatic digital lighting, perfect composition, ray-traced reflections, showcasing the peak of digital art and game world design.",
    keywords: ["virtual photography", "video game photography", "in-game photo", "screenshot art", "game world", "photomode", "digital photography"]
  },
  {
    slug: "visual-anthropology",
    staticSlug: "people",
    promptTemplate: "A profound visual anthropology photograph of __PROMPT__. Documenting cultural practices or human behavior in a field-study setting. Objective yet empathetic, highly detailed, natural lighting, capturing the raw essence of human societies for ethnographic study.",
    keywords: ["visual anthropology", "ethnographic photography", "cultural documentation", "anthropology", "tribe", "indigenous culture", "fieldwork"]
  },
  {
    slug: "vr-photography",
    staticSlug: "gaming",
    promptTemplate: "An immersive VR photography shot of __PROMPT__. A distorted, ultra-wide spherical 360-degree image. The viewer feels placed directly in the center of the scene. High resolution, seamless environment, designed for virtual reality headsets, capturing the entire surrounding space.",
    keywords: ["vr photography", "virtual reality photography", "360 vr", "immersive photo", "vr tour", "360 image", "360 degree"]
  },
  {
    slug: "wedding-photography",
    staticSlug: "event",
    promptTemplate: "A romantic, high-end wedding photography shot of __PROMPT__. Captured during a beautiful ceremony or bridal portrait session. Soft, glowing natural light, shallow depth of field to isolate the subject, elegant styling, joyful and deeply emotional aesthetic, magazine-quality.",
    keywords: ["wedding photography", "wedding", "bride", "groom", "ceremony", "nuptials", "reception", "marriage", "bridal", "engagement"]
  },
  {
    slug: "tele-snaps",
    staticSlug: "vintage",
    promptTemplate: "A retro 'tele-snaps' image of __PROMPT__. Simulating a photograph taken directly off an old CRT television screen. Visible scanlines, RGB pixel grid, slight screen curvature, muted broadcast colors, capturing a lost moment of vintage television history.",
    keywords: ["tele-snaps", "telesnaps", "tv screenshot", "television capture", "off-screen photo", "broadcast still", "tv still"]
  },
  {
    slug: "photo-op",
    staticSlug: "people",
    promptTemplate: "A highly staged public relations 'photo op' featuring __PROMPT__. Subjects are smiling widely, shaking hands, or holding a prop, looking directly at the press cameras. Bright, flat flash lighting, corporate or political event aesthetic, designed for newspaper publication.",
    keywords: ["photo op", "photo opportunity", "posed photo", "publicity photo", "press photo opportunity", "meet and greet photo"]
  },
  {
    slug: "paris-in-motion",
    staticSlug: "travel",
    promptTemplate: "A romantic 'Paris in motion' photography shot of __PROMPT__. Captured in the streets of Paris with intentional motion blur on passing cars or pedestrians, contrasting with sharp iconic architecture (like the Eiffel Tower or a classic café). Twilight lighting, cinematic and poetic European aesthetic.",
    keywords: ["paris", "paris photography", "city of light", "eiffel", "seine", "montmartre", "french street photography"]
  },
  {
    slug: "isap",
    staticSlug: "aerial",
    promptTemplate: "An elite ISAP (International Society of Aviation Photography) standard shot of __PROMPT__. Flawless technical execution, capturing an aircraft in peak dynamic action. Razor-sharp focus, perfect exposure, dramatic sky background, showcasing the pinnacle of professional aviation photography.",
    keywords: ["international society aviation photography", "isap", "aviation society", "airshow photography", "aviation club"]
  },
  {
    slug: "erotic-photography",
    staticSlug: "studio",
    promptTemplate: "A tasteful, artistic fine-art nude or erotic photography shot of __PROMPT__. Focusing on the elegant curves, shadows, and form of the human body. Sensual, low-key lighting, abstract framing, celebrating the figure with dignity, intimacy, and classical sculptural beauty.",
    keywords: ["erotic", "nude", "boudoir", "intimate", "sensual portrait", "body photography", "figure study"]
  },
  {
    slug: "humanist-photography",
    staticSlug: "people",
    promptTemplate: "A deeply touching humanist photography shot of __PROMPT__. Capturing the dignity, struggles, and everyday joys of the human condition. Black and white, natural lighting, empathetic and poetic documentary style, reminiscent of Henri Cartier-Bresson or Robert Doisneau.",
    keywords: ["humanist photography", "humanism", "humanist", "human condition", "social documentary", "people centered", "dignity"]
  }
];
