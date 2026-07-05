import { runDailyIndexer } from "./workers/daily-indexer.ts";
import { getIndexerDeps, indexerStatus } from "./server.ts";

Deno.cron("trigger-indexer-fetch", "0 */1 * * *", async () => {
  console.log("[Cron] Triggering /api/indexer/trigger (every 4 hours)...");
  try {
    const res = await fetch(`http://localhost:${PORT}/api/indexer/trigger`, {
      method: "POST",
    });
    const body = await res.json();
    console.log(`[Cron] Indexer trigger response (${res.status}):`, body);
  } catch (err) {
    console.error("[Cron] Failed to trigger indexer:", err);
  }
});

// Deno.cron("trigger-indexer", "0 */4 * * *", async () => {
//   console.log("[Cron] Starting indexer (every 4 hours)...");
//   if (indexerStatus?.running) {
//     console.log("[Cron] Indexer already running — skipping");
//     return;
//   }
//   if (indexerStatus) indexerStatus.running = true;
//   try {
//     const result = await runDailyIndexer(getIndexerDeps());
//     if (indexerStatus) {
//       indexerStatus.running = false;
//       indexerStatus.lastRun = new Date().toISOString();
//       indexerStatus.lastResult = result;
//     }
//     console.log(
//       `[Cron] Indexer finished — indexed: ${result.indexed}, skipped: ${result.skipped}, errors: ${result.errors} (${(result.duration / 1000).toFixed(1)}s)`,
//     );
//   } catch (err) {
//     if (indexerStatus) indexerStatus.running = false;
//     console.error("[Cron] Indexer failed:", err);
//   }
// });