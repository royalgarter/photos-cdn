import { Buffer } from "node:buffer";
import type { FallbackProvider, FallbackResult } from "./types.ts";
import { matchGenre } from "./static-photos.ts";

export class WallhavenProvider implements FallbackProvider {
  readonly name = "Wallhaven";

  constructor(private getApiKey: () => Promise<string | undefined>) {}

  async fetch(prompt: string, _promptVector: number[]): Promise<FallbackResult | null> {
    const apiKey = await this.getApiKey();
    if (!apiKey) return null;

    const query = encodeURIComponent(prompt.slice(0, 100));
    // Stable page from prompt hash, max 3 pages to stay in free results
    const page = (Math.abs(prompt.split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) % 3) + 1;

    try {
      const searchRes = await fetch(
        `https://wallhaven.cc/api/v1/search?q=${query}&purity=100&categories=110&sorting=relevance&per_page=1&page=${page}&apikey=${apiKey}`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (!searchRes.ok) return null;

      const json = await searchRes.json() as any;
      const photo = json?.data?.[0];
      if (!photo?.path) return null;

      const imgRes = await fetch(photo.path, {
        headers: { Referer: "https://wallhaven.cc" },
        signal: AbortSignal.timeout(10000)
      });
      if (!imgRes.ok) return null;

      const buffer = Buffer.from(await imgRes.arrayBuffer());
      const mimeType = photo.file_type || imgRes.headers.get("Content-Type") || "image/jpeg";
      const { genre, staticSlug } = matchGenre(prompt);
      return { buffer, mimeType, provider: "Wallhaven", sourceUrl: photo.path, genre, staticSlug };
    } catch {
      return null;
    }
  }
}
