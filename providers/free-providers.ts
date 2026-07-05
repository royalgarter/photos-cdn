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

export class WikimediaProvider implements FallbackProvider {
	readonly name = "Wikimedia";

	async fetch(prompt: string, _promptVector: number[]): Promise<FallbackResult | null> {
		const { genre, staticSlug } = matchGenre(prompt);
		// Map genre slug to a relevant Wikimedia category
		const categoryMap: Record<string, string> = {
			geophotography: "Quality_images_of_landscapes",
			"aerial-photography": "Quality_aerial_photographs",
			"architectural-photography": "Quality_images_of_architecture",
			"wildlife-photography": "Quality_images_of_animals",
			"underwater-photography": "Quality_underwater_photographs",
		};
		const wikiCategory = categoryMap[genre] || "Quality_images_of_landscapes";
		const photos = await fetchWikimediaFeatured(wikiCategory, 10);
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
