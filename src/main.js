// ==========================================
// BLURHASH DECODER HELPER (PURE JS)
// ==========================================
const base83Decode = (str) => {
	const digits = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$*+,-.:;=?@[]^_{|}~";
	let value = 0;
	for (let i = 0; i < str.length; i++) {
		const char = str[i];
		const digit = digits.indexOf(char);
		value = value * 83 + digit;
	}
	return value;
};

const sRGBToLinear = (value) => {
	const v = value / 255;
	return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};

const linearTosRGB = (value) => {
	const v = Math.max(0, Math.min(1, value));
	return v <= 0.0031308 ? Math.round(v * 12.92 * 255) : Math.round((1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255);
};

const decodeBlurhash = (blurhash, width, height, punch = 1.0) => {
	if (!blurhash || blurhash.length < 6) return null;

	const numComponentsX = (base83Decode(blurhash[0]) % 9) + 1;
	const numComponentsY = Math.floor(base83Decode(blurhash[0]) / 9) + 1;

	if (blurhash.length !== 4 + 2 * numComponentsX * numComponentsY) {
		return null;
	}

	const quantVal = base83Decode(blurhash[1]);
	const maxVal = (quantVal + 1) / 166;

	const colors = [];

	const value = base83Decode(blurhash.substring(2, 6));
	colors.push([
		sRGBToLinear((value >> 16) & 255),
		sRGBToLinear((value >> 8) & 255),
		sRGBToLinear(value & 255),
	]);

	for (let i = 1; i < numComponentsX * numComponentsY; i++) {
		const acVal = base83Decode(blurhash.substring(6 + 2 * (i - 1), 6 + 2 * i));
		const r = Math.floor(acVal / (19 * 19)) - 9;
		const g = (Math.floor(acVal / 19) % 19) - 9;
		const b = (acVal % 19) - 9;

		const signR = r < 0 ? -1 : 1;
		const signG = g < 0 ? -1 : 1;
		const signB = b < 0 ? -1 : 1;

		colors.push([
			Math.pow(Math.abs(r) / 9, 2) * signR * maxVal * punch,
			Math.pow(Math.abs(g) / 9, 2) * signG * maxVal * punch,
			Math.pow(Math.abs(b) / 9, 2) * signB * maxVal * punch,
		]);
	}

	const pixels = new Uint8ClampedArray(width * height * 4);

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			let r = 0;
			let g = 0;
			let b = 0;

			for (let j = 0; j < numComponentsY; j++) {
				for (let i = 0; i < numComponentsX; i++) {
					const cosX = Math.cos((Math.PI * x * i) / width);
					const cosY = Math.cos((Math.PI * y * j) / height);
					const factor = cosX * cosY;
					const color = colors[i + j * numComponentsX];
					r += color[0] * factor;
					g += color[1] * factor;
					b += color[2] * factor;
				}
			}

			const index = 4 * (x + y * width);
			pixels[index] = linearTosRGB(r);
			pixels[index + 1] = linearTosRGB(g);
			pixels[index + 2] = linearTosRGB(b);
			pixels[index + 3] = 255; // Alpha
		}
	}

	return pixels;
};

const renderBlurhash = (blurhash, canvas) => {
	if (!canvas) return;
	const ctx = canvas.getContext("2d");
	if (!ctx) return;

	const width = 32;
	const height = 32;
	canvas.width = width;
	canvas.height = height;

	const pixels = decodeBlurhash(blurhash, width, height);
	if (pixels) {
		const imageData = ctx.createImageData(width, height);
		imageData.data.set(pixels);
		ctx.putImageData(imageData, 0, 0);
	}
};

const renderIcons = () => {
	if (window.lucide && typeof window.lucide.createIcons === "function") {
		window.lucide.createIcons();
	}
};

// ==========================================
// ALPINEJS APPLICATION INITIALIZATION
// ==========================================
const registerAppState = () => {
	window.Alpine.data("appState", () => ({
		// Config state
		width: 1920,
		height: 1080,
		seed: Math.floor(Math.random() * 1e4),
		category: "nature",
		format: "image",
		text: "mountain lake at golden hour sunset",

		// Server state
		images: [],
		queue: [],
		logs: [],
		loading: false,
		copied: false,

		// Settings config
		settings: {
			geminiApiKey: "",
			replicateApiToken: "",
			r2AccessKeyId: "",
			r2SecretAccessKey: "",
			r2BucketName: "",
			r2Endpoint: "",
			cfAccountId: "",
			cfApiToken: "",
			hfApiToken: "",
			cdnDomain: "",
			openverseClientId: "",
			openverseClientSecret: "",
			providerRanks: {},
		},
		settingsSavedMessage: false,

		// Genre picker
		genres: [],
		selectedGenre: "",

		// Category slugs for Hard Filter
		categories: [],

		// Live test result
		testResult: null,

		// srcset tab state
		srcsetText: "misty mountain at dawn",
		srcsetOutput: "webp",
		srcsetAsync: false,
		srcsetResult: null,
		srcsetPollUrl: null,
		srcsetPollTimer: null,

		// Review panel
		reviewTab: "generated",
		pendingPhotos: [],
		pendingTotal: 0,
		pendingPages: 1,
		retryingKey: null,
		reviewGenPage: 1,
		reviewCrawledPage: 1,
		reviewPageSize: 10,
		crawledPageSize: 20,

		// Admin auth state
		isAdmin: false,

		// Navigation tab
		activeTab: "sandbox",

		// Highlight system step matching
		activeStep: null,

		// Database view filtering & selection states
		dbCategoryFilter: "all",
		selectedDbImageKey: null,

		// Presets
		presets: [
			{ label: "Waterfall", text: "cascade waterfall green forest", cat: "nature" },
			{ label: "Cyberpunk", text: "cyberpunk streets neon city rain", cat: "technology" },
			{ label: "Starry sky", text: "milky way starry sky dark night", cat: "aerial" },
			{ label: "Desert Sunset", text: "warm sun sand dunes hot sunset", cat: "nature" },
			{ label: "Cold Glacier", text: "frozen arctic ice cold winter glacier", cat: "nature" }
		],

		semanticLabels: [
			"Nature", "Water", "Sky", "Night/Dark", "Urban", "Warmth", "Coldness", "Futuristic", "Animals", "Minimalism"
		],

		// Lifecycle Init
		init() {
			this.checkAuth().then(() => {
				if (this.isAdmin) {
					this.fetchImages();
					this.fetchQueue();
					this.fetchLogs();
					this.fetchSettings();
					this.fetchPendingPhotos();
				}
			});
			this.fetchGenres();
			this.fetchCategories();
			this.fetchRandomPrompt();

			// Background Poll (admin only)
			setInterval(() => {
				if (!this.isAdmin) return;
				this.fetchQueue();
				this.fetchLogs();
				this.fetchImages();
			}, 1500);

			// Render initial icons
			this.$nextTick(() => {
				renderIcons();
			});

			// Watch tab selection to refresh icons
			this.$watch("activeTab", () => {
				this.$nextTick(() => {
					renderIcons();
				});
			});

			// Watch image list to auto-select first key
			this.$watch("images", (newVal) => {
				if (newVal && newVal.length > 0 && !this.selectedDbImageKey) {
					this.selectedDbImageKey = newVal[0]._key;
				}
			});

			// Watch selectedDbImageKey to refresh icons in database tab
			this.$watch("selectedDbImageKey", () => {
				this.$nextTick(() => {
					renderIcons();
				});
			});

			// Watch category filter to refresh icons
			this.$watch("dbCategoryFilter", () => {
				this.$nextTick(() => {
					renderIcons();
				});
			});
		},

		// Check admin authentication status
		async checkAuth() {
			try {
				const res = await fetch("/api/auth/check");
				this.isAdmin = res.ok;
			} catch(e) {
				this.isAdmin = false;
			}
		},

		// srcset endpoint tester
		async executeSrcset() {
			if (this.srcsetPollTimer) { clearInterval(this.srcsetPollTimer); this.srcsetPollTimer = null; }
			this.srcsetResult = null;
			this.srcsetPollUrl = null;

			const params = new URLSearchParams({ text: this.srcsetText, output: this.srcsetOutput });
			const headers = {};
			if (this.srcsetAsync) headers["Prefer"] = "respond-async";

			try {
				const res = await fetch(`/api/cdn/srcset?${params}`, { headers });
				const data = await res.json();
				this.srcsetResult = { ...data, status: res.status };

				if (res.status === 202) {
					this.srcsetPollUrl = res.headers.get("Location") || data.fallback?.pollUrl;
					if (this.srcsetPollUrl) {
						this.srcsetPollTimer = setInterval(async () => {
							try {
								const pr = await fetch(this.srcsetPollUrl);
								const pd = await pr.json();
								if (pr.status === 200) {
									this.srcsetResult = { ...pd, status: 200 };
									clearInterval(this.srcsetPollTimer);
									this.srcsetPollTimer = null;
									this.$nextTick(() => renderIcons());
								}
							} catch (e) { console.error("poll error", e); }
						}, 3000);
					}
				}
			} catch (e) {
				console.error("srcset error", e);
			}
			this.$nextTick(() => renderIcons());
		},

		buildImgTag() {
			if (!this.srcsetResult?.src) return "";
			return `<img\n  src="${this.srcsetResult.src}"\n  srcset="${this.srcsetResult.srcset}"\n  sizes="${this.srcsetResult.sizes}"\n  alt="${this.srcsetResult.alt || ""}"\n  loading="lazy"\n  decoding="async"\n/>`;
		},

		// Fetch Images API
		async fetchGenres() {
			try {
				const res = await fetch("/api/genres");
				if (res.ok) this.genres = await res.json();
			} catch(e) {}
		},

		async fetchCategories() {
			try {
				const res = await fetch("/api/categories");
				if (res.ok) this.categories = await res.json();
			} catch(e) {}
		},

		async fetchRandomPrompt() {
			try {
				const res = await fetch("/api/images/random-text");
				if (res.ok) {
					const data = await res.json();
					if (data.text) this.text = data.text;
				}
			} catch(e) {}
		},

		applyGenre(slug) {
			this.selectedGenre = slug;
			const g = this.genres.find(g => g.slug === slug);
			if (g && g.keywords.length) {
				this.text = g.keywords.slice(0, 3).join(" ");
			}
		},

		async fetchImages() {
			try {
				const res = await fetch("/api/images");
				if (res.ok && res.headers.get("Content-Type")?.includes("application/json")) {
					const data = await res.json();
					this.images = data;
					if (data && data.length > 0 && !this.selectedDbImageKey) {
						this.selectedDbImageKey = data[0]._key;
					}
				}
			} catch (e) {
				console.error(e);
			}
		},

		// Fetch Queue API
		async fetchQueue() {
			try {
				const res = await fetch("/api/queue");
				if (res.ok && res.headers.get("Content-Type")?.includes("application/json")) {
					this.queue = await res.json();
				}
			} catch (e) {
				console.error(e);
			}
		},

		// Fetch Logs API
		async fetchLogs() {
			try {
				const res = await fetch("/api/logs");
				if (res.ok && res.headers.get("Content-Type")?.includes("application/json")) {
					this.logs = await res.json();
				}
			} catch (e) {
				console.error(e);
			}
		},

		// Reseed DB
		async handleReset() {
			if (confirm("Are you sure you want to re-seed the vector database to original mock data?")) {
				await fetch("/api/reset", { method: "POST" });
				this.fetchImages();
				this.fetchLogs();
				this.testResult = null;
				this.$nextTick(() => {
					renderIcons();
				});
			}
		},

		// Execute Sandbox GET Call
		async executeApiCall() {
			this.loading = true;
			this.activeStep = 1;
			const startTime = Date.now();

			const baseParams = new URLSearchParams({
				category: this.category,
				seed: this.seed.toString(),
			});
			if (this.text) baseParams.append("text", this.text);

			// Fetch metadata via blurhash format — returns JSON with similarity, key, genre, etc.
			// This avoids the opaque-redirect problem (redirect: "manual" strips all headers).
			const metaParams = new URLSearchParams(baseParams);
			metaParams.set("format", "blurhash");
			const metaUrl = `/api/cdn/${this.width}/${this.height}?${metaParams.toString()}`;

			// Final display URL uses the user-selected format
			const imageParams = new URLSearchParams(baseParams);
			imageParams.set("format", this.format);
			const testUrl = `/api/cdn/${this.width}/${this.height}?${imageParams.toString()}`;

			try {
				setTimeout(() => { this.activeStep = 2; }, 350);

				const res = await fetch(metaUrl);
				const duration = Date.now() - startTime;

				let similarity = 0;
				let isAsync = false;
				let cacheControl = "None";
				let genre = "";
				let genreSlug = "";
				let blurhashStr = "";
				let finalUrl = testUrl;
				let matchedImage = null;

				if (res.ok) {
					const data = await res.json();

					similarity = typeof data.similarity === "number" ? data.similarity : 0;
					isAsync = res.headers.get("X-Async-Generated") === "true";
					cacheControl = res.headers.get("Cache-Control") || "None";
					genre = res.headers.get("X-Genre") || "";
					genreSlug = res.headers.get("X-Genre-Slug") || "";
					blurhashStr = data.blurhash || "";

					// For image/lqip formats, use the CDN URL directly as img src
					if (this.format === "blurhash") {
						finalUrl = data.sourceUrl || testUrl;
					} else {
						finalUrl = testUrl; // browser fetches this directly, no JS redirect
					}

					// Match against loaded images by key from metadata
					const key = data.metadata?.key || res.headers.get("X-Image-Key");
					if (key) {
						matchedImage = this.images.find(img => img._key === key) || null;
					}
					// Fallback: match by similarity on text
					if (!matchedImage && data.metadata?.prompt) {
						matchedImage = this.images.find(img => img.text === data.metadata.prompt) || null;
					}
				} else {
					console.warn(`Metadata fetch failed: ${res.status}`);
					similarity = 0;
					finalUrl = testUrl;
				}

				if (isAsync) setTimeout(() => { this.activeStep = 3; }, 700);
				setTimeout(() => { this.activeStep = 4; }, isAsync ? 1100 : 800);

				// Derive the delivery status for display: blurhash → 200 JSON, image/lqip → 302 redirect
				const deliveryStatus = this.format === "blurhash" ? 200 : 302;

				this.testResult = {
					status: deliveryStatus,
					url: finalUrl,
					requestUrl: window.location.origin + testUrl,
					similarity,
					cacheControl,
					isAsync,
					duration,
					blurhash: blurhashStr,
					matchedImage,
					genre,
					genreSlug,
				};

				if (blurhashStr) {
					this.$nextTick(() => {
						const canvas = document.getElementById("blurhash-canvas");
						if (canvas) renderBlurhash(blurhashStr, canvas);
					});
				}

				setTimeout(() => { this.activeStep = null; }, 2500);

			} catch (error) {
				console.error("API simulation error:", error);
			} finally {
				this.loading = false;
				this.$nextTick(() => { renderIcons(); });
			}
		},

		// Fetch and Save Settings API
		async fetchSettings() {
			try {
				const res = await fetch("/api/settings");
				if (res.ok && res.headers.get("Content-Type")?.includes("application/json")) {
					this.settings = await res.json();
				}
			} catch (e) {
				console.error("Error fetching settings:", e);
			}
		},

		async saveSettings() {
			try {
				const res = await fetch("/api/settings", {
					method: "POST",
					headers: {
						"Content-Type": "application/json"
					},
					body: JSON.stringify(this.settings)
				});
				if (res.ok) {
					const data = await res.json();
					this.settings = data.settings;
					this.settingsSavedMessage = true;
					this.fetchLogs();
					setTimeout(() => {
						this.settingsSavedMessage = false;
					}, 3000);
				}
			} catch (e) {
				console.error("Error saving settings:", e);
			}
		},

		async fetchPendingPhotos(page) {
			page = page || this.reviewCrawledPage;
			try {
				const res = await fetch(`/api/pending-photos?page=${page}&limit=${this.crawledPageSize}`);
				if (res.ok) {
					const data = await res.json();
					this.pendingPhotos = data.items;
					this.pendingTotal = data.total;
					this.pendingPages = data.pages;
					this.reviewCrawledPage = data.page;
				}
			} catch (e) {}
		},

		async deletePendingPhoto(key) {
			try {
				await fetch(`/api/pending-photos/${key}`, { method: "DELETE" });
				this.pendingPhotos = this.pendingPhotos.filter(p => p._key !== key);
			} catch (e) {}
		},

		async retryGenerated(key) {
			this.retryingKey = key;
			try {
				await fetch(`/api/images/${key}/retry`, { method: "POST" });
				await this.fetchQueue();
			} catch (e) {}
			this.retryingKey = null;
		},

		// Computed Properties
		get filteredImages() {
			return this.images.filter(
				(img) => this.dbCategoryFilter === "all" || img.category.toLowerCase() === this.dbCategoryFilter.toLowerCase()
			);
		},

		get generatedImages() {
			return this.images
				.filter(img => img._key && img._key.startsWith("gen-"))
				.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
		},

		get pagedGeneratedImages() {
			const start = (this.reviewGenPage - 1) * this.reviewPageSize;
			return this.generatedImages.slice(start, start + this.reviewPageSize);
		},

		get generatedPageCount() {
			return Math.max(1, Math.ceil(this.generatedImages.length / this.reviewPageSize));
		},

		get crawledPageCount() {
			return this.pendingPages;
		},

		get selectedDoc() {
			return this.images.find((img) => img._key === this.selectedDbImageKey) || this.images[0];
		},

		get activeQueueCount() {
			return this.queue.filter((q) => q.status === "pending" || q.status === "processing").length;
		}
	}));
};

// Register Alpine State
if (window.Alpine) {
	registerAppState();
} else {
	document.addEventListener("alpine:init", registerAppState);
}
