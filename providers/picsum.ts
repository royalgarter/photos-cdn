import { Buffer } from "node:buffer";
import type { FallbackProvider, FallbackResult } from "./types.ts";
import { matchGenre } from "./static-photos.ts";

// Picsum Photos — no API key needed.
// Uses prompt as seed so same prompt → same deterministic image.
export class PicsumProvider implements FallbackProvider {
	readonly name = "Picsum";

	async fetch(prompt: string, _promptVector: number[]): Promise<FallbackResult | null> {
		const seed = encodeURIComponent(prompt.slice(0, 40));
		const url = `https://picsum.photos/seed/${seed}/1024/1024`;

		try {
			const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
			if (!res.ok) return null;
			const buffer = Buffer.from(await res.arrayBuffer());
			const mimeType = res.headers.get("Content-Type") || "image/jpeg";
			const { genre, staticSlug } = matchGenre(prompt);
			return { buffer, mimeType, provider: "Picsum", sourceUrl: res.url, genre, staticSlug };
		} catch {
			return null;
		}
	}
}
