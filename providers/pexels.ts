import { Buffer } from "node:buffer";
import type { FallbackProvider, FallbackResult } from "./types.ts";

// Maps a prompt to a Pexels search query (just the prompt itself works well)
export class PexelsProvider implements FallbackProvider {
  readonly name = "Pexels";

  constructor(private getApiKey: () => Promise<string | undefined>) {}

  async fetch(prompt: string, _promptVector: number[]): Promise<FallbackResult | null> {
    const apiKey = await this.getApiKey();
    if (!apiKey) return null;

    const query = encodeURIComponent(prompt.slice(0, 100));
    // per_page=1 + deterministic page offset from prompt hash keeps results stable
    const page = (Math.abs(prompt.split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) % 20) + 1;

    try {
      const searchRes = await fetch(
        `https://api.pexels.com/v1/search?query=${query}&per_page=1&page=${page}&orientation=landscape`,
        { headers: { Authorization: apiKey }, signal: AbortSignal.timeout(5000) }
      );
      if (!searchRes.ok) return null;

      const json = await searchRes.json() as any;
      const photo = json?.photos?.[0];
      if (!photo) return null;

      const imgUrl: string = photo.src?.large2x || photo.src?.large || photo.src?.original;
      if (!imgUrl) return null;

      const imgRes = await fetch(imgUrl, { signal: AbortSignal.timeout(10000) });
      if (!imgRes.ok) return null;

      const buffer = Buffer.from(await imgRes.arrayBuffer());
      const mimeType = imgRes.headers.get("Content-Type") || "image/jpeg";
      return { buffer, mimeType, provider: "Pexels", sourceUrl: imgUrl };
    } catch {
      return null;
    }
  }
}
