import type { Buffer } from "node:buffer";

export interface FallbackResult {
  buffer: Buffer;
  mimeType: string;
  provider: string;
  sourceUrl: string;
}

export interface FallbackProvider {
  name: string;
  fetch(prompt: string, promptVector: number[]): Promise<FallbackResult | null>;
}
