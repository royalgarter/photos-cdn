import { Buffer } from "node:buffer";
import type { FallbackProvider, FallbackResult } from "./types.ts";
import { matchGenre } from "./static-photos.ts";

// ── Bing Daily Photos ─────────────────────────────────────────────────────────

export async function fetchBingDaily(n = 16): Promise<Array<{ sourceUrl: string; pageUrl: string; alt: string; category: string; width: number; height: number }>> {
	const res = await fetch(
		`https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=${Math.min(n, 16)}&mkt=en-US`,
		{ signal: AbortSignal.timeout(10000) }
	);
	if (!res.ok) return [];
	const json = await res.json() as any;
	return (json.images || []).map((img: any) => ({
		sourceUrl: `https://www.bing.com${img.url}`,
		pageUrl: `https://www.bing.com${img.copyrightlink || ""}`,
		alt: img.title || img.copyright || "bing daily photo",
		category: "nature",
		width: 1920,
		height: 1080,
	})).filter((p: any) => p.sourceUrl);
}

export class BingProvider implements FallbackProvider {
	readonly name = "Bing";

	async fetch(prompt: string, _promptVector: number[]): Promise<FallbackResult | null> {
		const photos = await fetchBingDaily(8);
		if (!photos.length) return null;
		const { genre, staticSlug } = matchGenre(prompt);
		// Pick pseudo-randomly based on prompt hash
		const idx = Math.abs(prompt.split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) % photos.length;
		const photo = photos[idx];
		try {
			const imgRes = await fetch(photo.sourceUrl, { signal: AbortSignal.timeout(12000) });
			if (!imgRes.ok) return null;
			const buffer = Buffer.from(await imgRes.arrayBuffer());
			const mimeType = imgRes.headers.get("Content-Type") || "image/jpeg";
			return { buffer, mimeType, provider: "Bing", sourceUrl: photo.sourceUrl, genre, staticSlug };
		} catch {
			return null;
		}
	}
}

// ── Wikimedia Commons ─────────────────────────────────────────────────────────

export async function fetchWikimediaFeatured(category = "Quality_images_of_landscapes", perPage = 20): Promise<Array<{ sourceUrl: string; pageUrl: string; alt: string; category: string; width: number; height: number }>> {
	const res = await fetch(
		`https://commons.wikimedia.org/w/api.php?action=query&generator=categorymembers&gcmtitle=Category:${encodeURIComponent(category)}&gcmlimit=${perPage}&gcmtype=file&prop=imageinfo&iiprop=url|size|extmetadata&format=json&origin=*`,
		{ signal: AbortSignal.timeout(12000) }
	);
	if (!res.ok) return [];
	const json = await res.json() as any;
	const pages = Object.values(json?.query?.pages || {}) as any[];
	return pages
		.filter((p: any) => p.imageinfo?.[0]?.width >= 1200)
		.map((p: any) => {
			const ii = p.imageinfo[0];
			const meta = ii.extmetadata || {};
			return {
				sourceUrl: ii.url,
				pageUrl: ii.descriptionurl || "",
				alt: meta.ImageDescription?.value?.replace(/<[^>]+>/g, "").slice(0, 200) || p.title || "wikimedia photo",
				category: "nature",
				width: ii.width,
				height: ii.height,
			};
		});
}

export async function fetchWikimediaSearch(
	query: string,
	limit = 20,
): Promise<Array<{ sourceUrl: string; pageUrl: string; alt: string; category: string; width: number; height: number }>> {
	const params = new URLSearchParams({
		action: "query",
		generator: "search",
		gsrsearch: `filetype:bitmap ${query}`,
		gsrnamespace: "6",
		gsrlimit: String(limit),
		gsrinfo: "totalhits",
		prop: "imageinfo",
		iiprop: "url|size|extmetadata|mediatype",
		iiurlwidth: "1200",
		format: "json",
		origin: "*",
	});
	const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
		signal: AbortSignal.timeout(12000),
	});
	if (!res.ok) return [];
	const json = await res.json() as any;
	const pages = Object.values(json?.query?.pages || {}) as any[];
	return pages
		.filter((p: any) => {
			const ii = p.imageinfo?.[0];
			return ii && ii.width >= 1200 && ii.mediatype === "BITMAP";
		})
		.map((p: any) => {
			const ii = p.imageinfo[0];
			const meta = ii.extmetadata || {};
			return {
				sourceUrl: ii.url,
				pageUrl: ii.descriptionurl || "",
				alt: meta.ImageDescription?.value?.replace(/<[^>]+>/g, "").slice(0, 200) || p.title || "wikimedia photo",
				category: "nature",
				width: ii.width,
				height: ii.height,
			};
		});
}

export class WikimediaProvider implements FallbackProvider {
	readonly name = "Wikimedia";

	async fetch(prompt: string, _promptVector: number[]): Promise<FallbackResult | null> {
		const { genre, staticSlug } = matchGenre(prompt);
		const photos = await fetchWikimediaSearch(prompt, 20);
		if (!photos.length) return null;
		const idx = Math.abs(prompt.split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) % photos.length;
		const photo = photos[idx];
		try {
			const imgRes = await fetch(photo.sourceUrl, { signal: AbortSignal.timeout(15000) });
			if (!imgRes.ok) return null;
			const buffer = Buffer.from(await imgRes.arrayBuffer());
			const mimeType = imgRes.headers.get("Content-Type") || "image/jpeg";
			return { buffer, mimeType, provider: "Wikimedia", sourceUrl: photo.sourceUrl, genre, staticSlug };
		} catch {
			return null;
		}
	}
}

// ── Flickr Public Feed ────────────────────────────────────────────────────────

export async function fetchFlickrPublic(tags = "landscape nature", n = 20): Promise<Array<{ sourceUrl: string; pageUrl: string; alt: string; category: string; width: number; height: number }>> {
	const res = await fetch(
		`https://api.flickr.com/services/feeds/photos_public.gne?format=json&nojsoncallback=1&tags=${encodeURIComponent(tags)}&license=4,5,6,9,10`,
		{ signal: AbortSignal.timeout(10000) }
	);
	if (!res.ok) return [];
	const json = await res.json() as any;
	return (json.items || []).slice(0, n).map((item: any) => ({
		// Replace _m (thumbnail ~240px) with _b (large ~1024px)
		sourceUrl: (item.media?.m || "").replace(/_m\.jpg$/, "_b.jpg"),
		pageUrl: item.link || "",
		alt: item.title || "flickr photo",
		category: "nature",
		width: 1024,
		height: 768,
	})).filter((p: any) => p.sourceUrl);
}

export class FlickrPublicProvider implements FallbackProvider {
	readonly name = "FlickrPublic";

	async fetch(prompt: string, _promptVector: number[]): Promise<FallbackResult | null> {
		const { genre, staticSlug } = matchGenre(prompt);
		// Use top keywords as Flickr tags
		const photos = await fetchFlickrPublic(prompt.split(/\s+/).slice(0, 3).join(","), 10);
		if (!photos.length) return null;
		const photo = photos[0];
		try {
			const imgRes = await fetch(photo.sourceUrl, { signal: AbortSignal.timeout(12000) });
			if (!imgRes.ok) return null;
			const buffer = Buffer.from(await imgRes.arrayBuffer());
			const mimeType = imgRes.headers.get("Content-Type") || "image/jpeg";
			return { buffer, mimeType, provider: "FlickrPublic", sourceUrl: photo.sourceUrl, genre, staticSlug };
		} catch {
			return null;
		}
	}
}

// ── Shopify Burst ─────────────────────────────────────────────────────────────

const SHOPIFY_CATEGORY_MAP: Record<string, string> = {
	geophotography: "nature",
	"aerial-photography": "nature",
	"architectural-photography": "urban-life",
	"wildlife-photography": "animals",
	"underwater-photography": "nature",
	"street-photography": "urban-life",
	"fashion-photography": "fashion",
	"food-photography": "food-and-drink",
	"sports-photography": "fitness",
	"portrait-photography": "people",
};

export async function fetchShopifyBurst(category = "nature", page = 1): Promise<Array<{ sourceUrl: string; pageUrl: string; alt: string; category: string; width: number; height: number }>> {
	const res = await fetch(
		`https://www.shopify.com/stock-photos/${encodeURIComponent(category)}?page=${page}`,
		{
			headers: { "accept": "text/html", "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
			signal: AbortSignal.timeout(12000),
		}
	);
	if (!res.ok) return [];
	const html = await res.text();
	const imgRe = /<img[^>]+src="(https:\/\/burst\.shopifycdn\.com\/photos\/([^"?]+\.jpg))[^"]*"[^>]*alt="([^"]*?)"/g;
	const results: Array<{ sourceUrl: string; pageUrl: string; alt: string; category: string; width: number; height: number }> = [];
	const seen = new Set<string>();
	let m: RegExpExecArray | null;
	while ((m = imgRe.exec(html)) !== null) {
		const slug = m[2];
		if (seen.has(slug)) continue;
		seen.add(slug);
		// Request full-size (1200px) without crop params
		results.push({
			sourceUrl: `https://burst.shopifycdn.com/photos/${slug}?width=1200&format=pjpg&exif=0&iptc=0`,
			pageUrl: `https://www.shopify.com/stock-photos/${category}`,
			alt: m[3] || slug.replace(/-/g, " "),
			category,
			width: 1200,
			height: 800,
		});
	}
	return results;
}

export class ShopifyBurstProvider implements FallbackProvider {
	readonly name = "ShopifyBurst";

	async fetch(prompt: string, _promptVector: number[]): Promise<FallbackResult | null> {
		const { genre, staticSlug } = matchGenre(prompt);
		const category = SHOPIFY_CATEGORY_MAP[genre] || "nature";
		const photos = await fetchShopifyBurst(category);
		if (!photos.length) return null;
		const idx = Math.abs(prompt.split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) % photos.length;
		const photo = photos[idx];
		try {
			const imgRes = await fetch(photo.sourceUrl, { signal: AbortSignal.timeout(12000) });
			if (!imgRes.ok) return null;
			const buffer = Buffer.from(await imgRes.arrayBuffer());
			const mimeType = imgRes.headers.get("Content-Type") || "image/jpeg";
			return { buffer, mimeType, provider: "ShopifyBurst", sourceUrl: photo.sourceUrl, genre, staticSlug };
		} catch {
			return null;
		}
	}
}

// ── Freestocks ────────────────────────────────────────────────────────────────

export async function fetchFreestocks(page = 1): Promise<Array<{ sourceUrl: string; pageUrl: string; alt: string; category: string; width: number; height: number }>> {
	const res = await fetch(
		`https://freestocks.org/page/${page}/`,
		{
			headers: { "accept": "text/html", "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
			signal: AbortSignal.timeout(12000),
		}
	);
	if (!res.ok) return [];
	const html = await res.text();
	const imgRe = /<img[^>]+src="(https:\/\/freestocks\.org\/fs\/wp-content\/uploads\/(\d{4}\/\d{2}\/([^"-]+?))-\d+x\d+\.jpg)"[^>]*alt="([^"]*?)"/g;
	const results: Array<{ sourceUrl: string; pageUrl: string; alt: string; category: string; width: number; height: number }> = [];
	const seen = new Set<string>();
	let m: RegExpExecArray | null;
	while ((m = imgRe.exec(html)) !== null) {
		const key = m[3];
		if (seen.has(key)) continue;
		seen.add(key);
		// Strip WordPress thumbnail dimensions to get original
		const fullUrl = `https://freestocks.org/fs/wp-content/uploads/${m[2]}/${m[3]}.jpg`;
		const alt = m[4].replace(/ - free stock photo$/i, "").trim();
		results.push({
			sourceUrl: fullUrl,
			pageUrl: "https://freestocks.org/",
			alt: alt || key.replace(/_/g, " "),
			category: "nature",
			width: 5000,
			height: 3333,
		});
	}
	return results;
}

export class FreestocksProvider implements FallbackProvider {
	readonly name = "Freestocks";

	async fetch(prompt: string, _promptVector: number[]): Promise<FallbackResult | null> {
		const { genre, staticSlug } = matchGenre(prompt);
		const page = (Math.abs(prompt.split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) % 5) + 1;
		const photos = await fetchFreestocks(page);
		if (!photos.length) return null;
		const idx = Math.abs(prompt.split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) % photos.length;
		const photo = photos[idx];
		try {
			const imgRes = await fetch(photo.sourceUrl, { signal: AbortSignal.timeout(20000) });
			if (!imgRes.ok) return null;
			const buffer = Buffer.from(await imgRes.arrayBuffer());
			const mimeType = imgRes.headers.get("Content-Type") || "image/jpeg";
			return { buffer, mimeType, provider: "Freestocks", sourceUrl: photo.sourceUrl, genre, staticSlug };
		} catch {
			return null;
		}
	}
}

// ── Life of Pix ───────────────────────────────────────────────────────────────

export async function fetchLifeOfPix(search: string, limit = 10): Promise<Array<{ sourceUrl: string; pageUrl: string; alt: string; category: string; width: number; height: number }>> {
	const query = `{
		assets(volume: "lopixs", limit: ${limit}, lopixsStatus: "approved", width: ">= 1200", search: ${JSON.stringify(search)}, orderBy: "score DESC") {
			id title url width height
			tags { title }
		}
	}`;
	const res = await fetch("https://www.lifeofpix.com/api/", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"origin": "https://www.lifeofpix.com",
			"user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
		},
		body: JSON.stringify({ query }),
		signal: AbortSignal.timeout(12000),
	});
	if (!res.ok) return [];
	const json = await res.json() as any;
	return (json?.data?.assets || []).map((a: any) => ({
		sourceUrl: a.url,
		pageUrl: `https://www.lifeofpix.com/`,
		alt: a.title?.replace(/_/g, " ") || "life of pix photo",
		category: (a.tags?.[0]?.title || "nature").toLowerCase(),
		width: a.width,
		height: a.height,
	})).filter((p: any) => p.sourceUrl);
}

export class LifeOfPixProvider implements FallbackProvider {
	readonly name = "LifeOfPix";

	async fetch(prompt: string, _promptVector: number[]): Promise<FallbackResult | null> {
		const { genre, staticSlug } = matchGenre(prompt);
		const keywords = prompt.split(/\s+/).slice(0, 4).join(" ");
		const photos = await fetchLifeOfPix(keywords, 10);
		if (!photos.length) return null;
		const idx = Math.abs(prompt.split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) % photos.length;
		const photo = photos[idx];
		try {
			const imgRes = await fetch(photo.sourceUrl, { signal: AbortSignal.timeout(15000) });
			if (!imgRes.ok) return null;
			const buffer = Buffer.from(await imgRes.arrayBuffer());
			const mimeType = imgRes.headers.get("Content-Type") || "image/jpeg";
			return { buffer, mimeType, provider: "LifeOfPix", sourceUrl: photo.sourceUrl, genre, staticSlug };
		} catch {
			return null;
		}
	}
}

// ── ImgSearch ─────────────────────────────────────────────────────────────────

export async function fetchImgSearch(query: string, perPage = 30): Promise<Array<{ sourceUrl: string; pageUrl: string; alt: string; category: string; width: number; height: number }>> {
	const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
	const slug = query.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");

	// Step 1: GET search page to collect session cookies + CSRF token
	const pageRes = await fetch(`https://imgsearch.com/search/${slug}`, {
		headers: { "user-agent": UA, "accept": "text/html" },
		signal: AbortSignal.timeout(12000),
	});
	if (!pageRes.ok) return [];

	const html = await pageRes.text();
	const csrfMatch = html.match(/meta[^>]+name="csrf-token"[^>]+content="([^"]+)"/);
	if (!csrfMatch) return [];
	const csrfToken = csrfMatch[1];

	// Collect Set-Cookie headers
	const rawCookies = pageRes.headers.getSetCookie?.() ?? [];
	const cookieStr = rawCookies.map((c: string) => c.split(";")[0]).join("; ");

	// Step 2: POST search-data
	const body = new URLSearchParams({ perPage: String(perPage), page: "1", searchQuery: query });
	const dataRes = await fetch("https://imgsearch.com/search-data", {
		method: "POST",
		headers: {
			"content-type": "application/x-www-form-urlencoded; charset=UTF-8",
			"accept": "application/json, text/javascript, */*; q=0.01",
			"x-csrf-token": csrfToken,
			"x-requested-with": "XMLHttpRequest",
			"origin": "https://imgsearch.com",
			"referer": `https://imgsearch.com/search/${slug}`,
			"cookie": cookieStr,
			"user-agent": UA,
		},
		body: body.toString(),
		signal: AbortSignal.timeout(15000),
	});
	if (!dataRes.ok) return [];

	const json = await dataRes.json() as any;
	// Response is { html: "...", count: N } — parse JSON-LD blocks embedded in HTML
	const htmlContent: string = json?.html ?? "";
	const ldMatches = [...htmlContent.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
	return ldMatches.map((m) => {
		try {
			const ld = JSON.parse(m[1]);
			const url = ld.contentUrl || ld.url;
			if (!url || !url.startsWith("http")) return null;
			return {
				sourceUrl: url,
				pageUrl: ld.url || `https://imgsearch.com/search/${slug}`,
				alt: ld.name || ld.caption || ld.description || query,
				category: "photo",
				width: 1200,
				height: 800,
			};
		} catch { return null; }
	}).filter(Boolean) as any[];
}

// ── PxHere ────────────────────────────────────────────────────────────────────
// NOTE: Cloudflare challenge blocks server-side requests without valid cf_clearance cookie

export async function fetchPxHere(query: string, page = 1): Promise<Array<{ sourceUrl: string; pageUrl: string; alt: string; category: string; width: number; height: number }>> {
	const params = new URLSearchParams({ order: "latest", page: String(page), q: query, format: "json" });
	const res = await fetch(`https://pxhere.com/en/photos?${params}`, {
		headers: {
			"accept": "application/json, text/javascript, */*; q=0.01",
			"x-requested-with": "XMLHttpRequest",
			"referer": "https://pxhere.com/en/photos?order=latest",
			"user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
		},
		signal: AbortSignal.timeout(12000),
	});
	if (!res.ok) return [];
	const json = await res.json() as any;
	const items: any[] = json?.photos ?? json?.data ?? (Array.isArray(json) ? json : []);
	return items.map((item: any) => {
		const url = item?.images?.original?.url || item?.url || item?.large_src || item?.src;
		if (!url) return null;
		return {
			sourceUrl: url,
			pageUrl: item?.link ? `https://pxhere.com${item.link}` : "https://pxhere.com/",
			alt: item?.tags?.join(", ") || item?.title || query,
			category: item?.tags?.[0]?.toLowerCase() || "photo",
			width: item?.width || 1920,
			height: item?.height || 1280,
		};
	}).filter(Boolean) as any[];
}

export class PxHereProvider implements FallbackProvider {
	readonly name = "PxHere";

	async fetch(prompt: string, _promptVector: number[]): Promise<FallbackResult | null> {
		const { genre, staticSlug } = matchGenre(prompt);
		const keywords = prompt.split(/\s+/).slice(0, 5).join(" ");
		const page = (Math.abs(prompt.split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) % 5) + 1;
		const photos = await fetchPxHere(keywords, page);
		if (!photos.length) return null;
		const idx = Math.abs(prompt.split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) % photos.length;
		const photo = photos[idx];
		try {
			const imgRes = await fetch(photo.sourceUrl, { signal: AbortSignal.timeout(20000) });
			if (!imgRes.ok) return null;
			const buffer = Buffer.from(await imgRes.arrayBuffer());
			const mimeType = imgRes.headers.get("Content-Type") || "image/jpeg";
			return { buffer, mimeType, provider: "PxHere", sourceUrl: photo.sourceUrl, genre, staticSlug };
		} catch {
			return null;
		}
	}
}

export class ImgSearchProvider implements FallbackProvider {
	readonly name = "ImgSearch";

	async fetch(prompt: string, _promptVector: number[]): Promise<FallbackResult | null> {
		const { genre, staticSlug } = matchGenre(prompt);
		const keywords = prompt.split(/\s+/).slice(0, 8).join(" ");
		const photos = await fetchImgSearch(keywords, 30);
		if (!photos.length) return null;
		const idx = Math.abs(prompt.split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) % photos.length;
		const photo = photos[idx];
		try {
			const imgRes = await fetch(photo.sourceUrl, { signal: AbortSignal.timeout(20000) });
			if (!imgRes.ok) return null;
			const buffer = Buffer.from(await imgRes.arrayBuffer());
			const mimeType = imgRes.headers.get("Content-Type") || "image/jpeg";
			return { buffer, mimeType, provider: "ImgSearch", sourceUrl: photo.sourceUrl, genre, staticSlug };
		} catch {
			return null;
		}
	}
}
