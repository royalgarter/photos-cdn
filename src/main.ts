import Alpine from "alpinejs";
import { createIcons, Zap, Cpu, Database, Layers, Code, RefreshCw, Sparkles, Search, Play, Eye, ExternalLink, Server, Terminal, Check, Copy, Image, Settings } from "lucide";

const renderIcons = () => {
  createIcons({
    icons: {
      Zap, Cpu, Database, Layers, Code, RefreshCw, Sparkles, Search, Play, Eye, ExternalLink, Server, Terminal, Check, Copy, Image, Settings
    }
  });
};

// ==========================================
// BLURHASH DECODER HELPER (PURE TS)
// ==========================================
const base83Decode = (str: string): number => {
  const digits = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$*+,-.:;=?@[]^_{|}~";
  let value = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    const digit = digits.indexOf(char);
    value = value * 83 + digit;
  }
  return value;
};

const sRGBToLinear = (value: number): number => {
  const v = value / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};

const linearTosRGB = (value: number): number => {
  const v = Math.max(0, Math.min(1, value));
  return v <= 0.0031308 ? Math.round(v * 12.92 * 255) : Math.round((1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255);
};

const decodeBlurhash = (blurhash: string, width: number, height: number, punch: number = 1.0): Uint8ClampedArray | null => {
  if (!blurhash || blurhash.length < 6) return null;

  const numComponentsX = (base83Decode(blurhash[0]) % 9) + 1;
  const numComponentsY = Math.floor(base83Decode(blurhash[0]) / 9) + 1;

  if (blurhash.length !== 4 + 2 * numComponentsX * numComponentsY) {
    return null;
  }

  const quantVal = base83Decode(blurhash[1]);
  const maxVal = (quantVal + 1) / 166;

  const colors: [number, number, number][] = [];

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

const renderBlurhash = (blurhash: string, canvas: HTMLCanvasElement) => {
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

// ==========================================
// ALPINEJS APPLICATION INITIALIZATION
// ==========================================
const registerAppState = () => {
  Alpine.data("appState", () => ({
    // Config state
    width: 800,
    height: 600,
    category: "nature",
    seed: 42,
    text: "",
    format: "image",

    // Server state
    images: [] as any[],
    queue: [] as any[],
    logs: [] as any[],
    denoCode: "",
    loading: false,
    copied: false,

    // Settings config
    settings: {
      geminiApiKey: "",
      replicateApiToken: "",
      r2AccessKeyId: "",
      r2SecretAccessKey: "",
      r2BucketName: "",
      r2Endpoint: ""
    },
    settingsSavedMessage: false,

    // Live test result
    testResult: null as any,

    // Navigation tab
    activeTab: "sandbox",

    // Highlight system step matching
    activeStep: null as number | null,

    // Database view filtering & selection states
    dbCategoryFilter: "all",
    selectedDbImageKey: null as string | null,

    // Presets
    presets: [
      { label: "Waterfall", text: "cascade waterfall green forest", cat: "nature" },
      { label: "Cyberpunk", text: "cyberpunk streets neon city rain", cat: "urban" },
      { label: "Starry sky", text: "milky way starry sky dark night", cat: "space" },
      { label: "Desert Sunset", text: "warm sun sand dunes hot sunset", cat: "nature" },
      { label: "New Theme (Cold Glacier)", text: "frozen arctic ice cold winter glacier", cat: "nature" }
    ],

    semanticLabels: [
      "Nature", "Water", "Sky", "Night/Dark", "Urban", "Warmth", "Coldness", "Futuristic", "Animals", "Minimalism"
    ],

    // Lifecycle Init
    init() {
      this.fetchImages();
      this.fetchQueue();
      this.fetchLogs();
      this.fetchDenoCode();
      this.fetchSettings();

      // Background Poll
      setInterval(() => {
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

    // Fetch Images API
    async fetchImages() {
      try {
        const res = await fetch("/api/images");
        if (res.ok) {
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
        if (res.ok) {
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
        if (res.ok) {
          this.logs = await res.json();
        }
      } catch (e) {
        console.error(e);
      }
    },

    // Fetch Deno source code
    async fetchDenoCode() {
      try {
        const res = await fetch("/deno_cdn.ts");
        if (res.ok) {
          this.denoCode = await res.text();
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
      this.activeStep = 1; // Interception
      const startTime = Date.now();

      const queryParams = new URLSearchParams({
        category: this.category,
        seed: this.seed.toString(),
        format: this.format
      });
      if (this.text) queryParams.append("text", this.text);

      const testUrl = `/api/cdn/${this.width}/${this.height}?${queryParams.toString()}`;

      try {
        // Step transition simulations
        setTimeout(() => { this.activeStep = 2; }, 350);

        const res = await fetch(testUrl, { redirect: "manual" });
        const duration = Date.now() - startTime;

        const similarityHeader = res.headers.get("X-Similarity-Score");
        const similarity = similarityHeader ? parseFloat(similarityHeader) : 1.0;
        const isAsync = res.headers.get("X-Async-Generated") === "true";
        const cacheControl = res.headers.get("Cache-Control") || "None";

        if (isAsync) {
          setTimeout(() => { this.activeStep = 3; }, 700);
        }

        setTimeout(() => { this.activeStep = 4; }, isAsync ? 1100 : 800);

        let finalUrl = testUrl;
        let blurhashStr = "";

        if (this.format === "blurhash") {
          const data = await res.json();
          blurhashStr = data.blurhash;
          finalUrl = data.sourceUrl;
        } else {
          finalUrl = res.url;
        }

        const matchedImage = this.images.find(
          (img: any) => finalUrl.includes(img._key) || finalUrl.includes(encodeURIComponent(img.text))
        );

        this.testResult = {
          status: res.status === 0 ? 302 : res.status,
          url: finalUrl,
          similarity,
          cacheControl,
          isAsync,
          duration,
          blurhash: blurhashStr,
          matchedImage
        };

        // Render blurhash canvas if present
        if (blurhashStr) {
          this.$nextTick(() => {
            const canvas = document.getElementById("blurhash-canvas") as HTMLCanvasElement;
            if (canvas) {
              renderBlurhash(blurhashStr, canvas);
            }
          });
        }

        // Reset steps after delay
        setTimeout(() => { this.activeStep = null; }, 2500);

      } catch (error) {
        console.error("API simulation error:", error);
      } finally {
        this.loading = false;
        this.$nextTick(() => {
          renderIcons();
        });
      }
    },

    // Copy to clipboard
    copyToClipboard() {
      navigator.clipboard.writeText(this.denoCode);
      this.copied = true;
      setTimeout(() => { this.copied = false; }, 2000);
    },

    // Fetch and Save Settings API
    async fetchSettings() {
      try {
        const res = await fetch("/api/settings");
        if (res.ok) {
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

    // Computed Properties
    get filteredImages() {
      return this.images.filter(
        (img: any) => this.dbCategoryFilter === "all" || img.category.toLowerCase() === this.dbCategoryFilter.toLowerCase()
      );
    },

    get selectedDoc() {
      return this.images.find((img: any) => img._key === this.selectedDbImageKey) || this.images[0];
    },

    get activeQueueCount() {
      return this.queue.filter((q: any) => q.status === "pending" || q.status === "processing").length;
    }
  }));
};

// Register & Start Alpine
(window as any).Alpine = Alpine;
registerAppState();
Alpine.start();
