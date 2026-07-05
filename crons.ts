const PORT = parseInt(process.env.PORT || "34070");

Deno.cron("trigger-indexer", "0 */4 * * *", async () => {
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
