import { crawlFeeds, processOnePending } from "./workers/daily-indexer.ts";
import { getIndexerDeps, indexerStatus, drainQueue } from "./server.ts";

// Cron 0: Drain the generation queue every minute. Request handlers only
// enqueue jobs (serverless isolates die after responding, truncating any
// fire-and-forget generation); this cron's isolate lives for the full run,
// so generation completes and the document is saved.
Deno.cron("drain-generation-queue", "* * * * *", async () => {
	try {
		await drainQueue();
	} catch (err) {
		console.error("[Cron] Queue drain failed:", err);
	}
});

// Cron 1: Crawl all providers every 1 hours — metadata only, no image processing
Deno.cron("crawl-feeds", "0 */1 * * *", async () => {
	console.log("[Cron] Crawling provider feeds...");
	try {
		const { queued, skipped } = await crawlFeeds(getIndexerDeps());
		console.log(`[Cron] Crawl done — queued: ${queued}, skipped: ${skipped}`);
	} catch (err) {
		console.error("[Cron] Crawl failed:", err);
	}
});

// Cron 2: Process exactly 1 pending photo per minute — keeps peak RAM to one image at a time
Deno.cron("process-pending", "* * * * *", async () => {
	const deps = getIndexerDeps();
	const pending = await deps.countPendingPhotos();
	if (pending === 0) return;

	console.log(`[Cron] Processing 1 pending photo (${pending} remaining)...`);
	if (indexerStatus?.running) {
		console.log("[Cron] Processor already running — skipping");
		return;
	}
	if (indexerStatus) indexerStatus.running = true;
	try {
		const result = await processOnePending(deps);
		if (indexerStatus) {
			indexerStatus.running = false;
			indexerStatus.lastRun = new Date().toISOString();
		}
		console.log(`[Cron] Processor result: ${result} (${pending - 1} remaining)`);
	} catch (err) {
		if (indexerStatus) indexerStatus.running = false;
		console.error("[Cron] Processor failed:", err);
	}
});
