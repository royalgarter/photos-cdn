import { Buffer } from "node:buffer";
import type { FallbackProvider, FallbackResult } from "./types.ts";

export class UnsplashProvider implements FallbackProvider {
  readonly name = "Unsplash";

  constructor(private getAccessKey: () => Promise<string | undefined>) {}

  async fetch(prompt: string, _promptVector: number[]): Promise<FallbackResult | null> {
    const accessKey = await this.getAccessKey();
    if (!accessKey) return null;

    const query = encodeURIComponent(prompt.slice(0, 100));
    // Stable page offset from prompt hash
    const page = (Math.abs(prompt.split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) % 10) + 1;

    try {
      const searchRes = await fetch(
        `https://api.unsplash.com/search/photos?query=${query}&per_page=1&page=${page}&orientation=landscape`,
        {
          headers: {
            Authorization: `Client-ID ${accessKey}`,
            "Accept-Version": "v1"
          },
          signal: AbortSignal.timeout(5000)
        }
      );
      if (!searchRes.ok) return null;

      const json = await searchRes.json() as any;
      const photo = json?.results?.[0];
      if (!photo) return null;

      // raw URL with width param to avoid huge downloads
      const imgUrl: string = photo.urls?.regular || photo.urls?.full || photo.urls?.raw;
      if (!imgUrl) return null;

      const imgRes = await fetch(imgUrl, { signal: AbortSignal.timeout(10000) });
      if (!imgRes.ok) return null;

      const buffer = Buffer.from(await imgRes.arrayBuffer());
      const mimeType = imgRes.headers.get("Content-Type") || "image/jpeg";
      return { buffer, mimeType, provider: "Unsplash", sourceUrl: imgUrl };
    } catch {
      return null;
    }
  }
}
