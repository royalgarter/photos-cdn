import { Buffer } from "node:buffer";
import type { FallbackProvider, FallbackResult } from "./types.ts";
import { matchGenre } from "./static-photos.ts";

const TOKEN_URL = "https://api.openverse.org/v1/auth_tokens/token/";
const SEARCH_URL = "https://api.openverse.org/v1/images/";

let cachedToken: string | null = null;
let tokenExpiry = 0;

async function getToken(clientId: string, clientSecret: string): Promise<string | null> {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  try {
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    });
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { access_token: string; expires_in: number };
    cachedToken = data.access_token;
    tokenExpiry = Date.now() + (data.expires_in - 60) * 1000; // 1 min buffer
    return cachedToken;
  } catch {
    return null;
  }
}

export async function fetchOpenversePhotos(
  clientId: string,
  clientSecret: string,
  query = "nature",
  perPage = 20
): Promise<Array<{ sourceUrl: string; pageUrl: string; alt: string; category: string; width: number; height: number }>> {
  const token = await getToken(clientId, clientSecret);
  if (!token) return [];
  try {
    const params = new URLSearchParams({
      q: query,
      page_size: perPage.toString(),
      license_type: "commercial",
      extension: "jpg",
      filter_dead: "true",
      mature: "false",
    });
    const res = await fetch(`${SEARCH_URL}?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const data = await res.json() as { results: any[] };
    return (data.results || [])
      .filter((r: any) => r.url && r.width >= 800)
      .map((r: any) => ({
        sourceUrl: r.url,
        pageUrl: r.foreign_landing_url || r.url,
        alt: r.title || r.tags?.map((t: any) => t.name).join(" ") || query,
        category: r.tags?.[0]?.name || "nature",
        width: r.width || 0,
        height: r.height || 0,
      }));
  } catch {
    return [];
  }
}

type KeyGetter = () => Promise<string | undefined>;

export class OpenverseProvider implements FallbackProvider {
  readonly name = "Openverse";
  private getClientId: KeyGetter;
  private getClientSecret: KeyGetter;

  constructor(getClientId: KeyGetter, getClientSecret: KeyGetter) {
    this.getClientId = getClientId;
    this.getClientSecret = getClientSecret;
  }

  async fetch(prompt: string, _promptVector: number[]): Promise<FallbackResult | null> {
    const clientId = await this.getClientId();
    const clientSecret = await this.getClientSecret();
    if (!clientId || !clientSecret) return null;
    const { genre, staticSlug } = matchGenre(prompt);
    const photos = await fetchOpenversePhotos(clientId, clientSecret, prompt, 5);
    if (!photos.length) return null;

    // pick highest-res result
    const photo = photos.sort((a, b) => b.width - a.width)[0];
    try {
      const imgRes = await fetch(photo.sourceUrl, { signal: AbortSignal.timeout(12000) });
      if (!imgRes.ok) return null;
      const buffer = Buffer.from(await imgRes.arrayBuffer());
      const mimeType = imgRes.headers.get("Content-Type") || "image/jpeg";
      return {
        buffer,
        mimeType,
        provider: "Openverse",
        sourceUrl: photo.sourceUrl,
        genre,
        staticSlug,
      };
    } catch {
      return null;
    }
  }
}
