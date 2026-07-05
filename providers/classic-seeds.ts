import { Buffer } from "node:buffer";
import type { FallbackProvider, FallbackResult } from "./types.ts";

interface SeedItem {
	provider: string;
	category: string;
	url: string;
	text: string;
	embedding?: number[];
}

const SEEDS: SeedItem[] = [
	{
		provider: "Unsplash", category: "nature",
		url: "https://images.unsplash.com/photo-1506744038136-46273834b3fb",
		text: "emerald cascade green forest waterfall trees water organic stream nature"
	},
	{
		provider: "Unsplash", category: "urban",
		url: "https://images.unsplash.com/photo-1515621061946-eff1c2a352bd",
		text: "cyberpunk city street rain night neon lights glowing skyscrapers urban"
	},
	{
		provider: "Unsplash", category: "space",
		url: "https://images.unsplash.com/photo-1506318137071-a8e063b4bec0",
		text: "milky way galaxy cosmic starry night sky stars universe outer space celestial"
	},
	{
		provider: "Unsplash", category: "architecture",
		url: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c",
		text: "modernist concrete architecture building facade sharp lines geometric museum minimalist"
	},
	{
		provider: "Unsplash", category: "animals",
		url: "https://images.unsplash.com/photo-1504198453319-5ce911bafcde",
		text: "arctic fox animal winter snow cold white fluffy puppy wildlife fauna"
	},
	{
		provider: "Pexels", category: "nature",
		url: "https://images.pexels.com/photos/3408744/pexels-photo-3408744.jpeg",
		text: "autumn forest gold red leaves trees woods scenic nature foliage path wilderness"
	},
	{
		provider: "Pexels", category: "urban",
		url: "https://images.pexels.com/photos/169647/pexels-photo-169647.jpeg",
		text: "downtown skyscrapers traffic trails speed city life cityscape architecture road street"
	},
	{
		provider: "Flickr", category: "nature",
		url: "https://live.staticflickr.com/65535/51299834246_7f16751280_b.jpg",
		text: "majestic mountain peaks snow lake reflection calm peaceful sunrise hills scenic landscape"
	},
	{
		provider: "Flickr", category: "animals",
		url: "https://live.staticflickr.com/65535/50849301987_a1459a930b_b.jpg",
		text: "bald eagle bird prey flying wings feathers wild majestic predator sky"
	},
	{
		provider: "Picsum", category: "nature",
		url: "https://picsum.photos/id/10/1024/1024",
		text: "lake mountain shore forest trees green waters sky nature landscape"
	},
	{
		provider: "Picsum", category: "urban",
		url: "https://picsum.photos/id/1031/1024/1024",
		text: "city street buildings architecture car traffic road urban people"
	},
];

export class ClassicSeedsProvider implements FallbackProvider {
	readonly name = "ClassicSeeds";

	constructor(
		private getVector: (text: string) => number[],
		private cosineSim: (a: number[], b: number[]) => number,
	) {}

	async fetch(_prompt: string, promptVector: number[]): Promise<FallbackResult | null> {
		let best = SEEDS[0];
		let maxSim = -1;

		for (const item of SEEDS) {
			if (!item.embedding || item.embedding.length !== 128) {
				item.embedding = this.getVector(item.text);
			}
			const sim = this.cosineSim(promptVector, item.embedding);
			if (sim > maxSim) { maxSim = sim; best = item; }
		}

		try {
			const response = await fetch(best.url);
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const arrayBuffer = await response.arrayBuffer();
			const buffer = Buffer.from(arrayBuffer);
			const mimeType = response.headers.get("Content-Type") || "image/jpeg";
			return { buffer, mimeType, provider: best.provider, sourceUrl: best.url };
		} catch (err) {
			return null;
		}
	}
}
