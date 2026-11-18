// Specialised Team bots.
// POST { action: "save", bot: { id?, name, topic, rss: [urls], localoy, onthisday, postsPerDay, active } }
// POST { action: "delete", id }
// POST { action: "run", id }     → starts the bot right away
// → { ok, bots }

import { send, readDataFile, writeDataFile, startWorkflow, newId } from "./_lib.js";

const FILE = "data/bots.json";

function cleanBot(b, existing) {
  const name = String(b.name || "").trim().slice(0, 40);
  const topic = String(b.topic || "").trim().slice(0, 500);
  if (!name || !topic) throw new Error("Name and topic are required");
  const sources = [];
  for (const url of (Array.isArray(b.rss) ? b.rss : []).map((u) => String(u).trim()).filter(Boolean).slice(0, 10)) {
    if (!/^https:\/\/[^\s]+$/.test(url)) throw new Error(`Not a valid https link: ${url}`);
    sources.push({ type: "rss", name: new URL(url).hostname.replace(/^www\./, ""), url });
  }
  if (b.localoy) sources.push({ type: "localoy-events", name: "Localoy", daysAhead: 14 });
  if (b.onthisday) sources.push({ type: "wikipedia-onthisday", name: "Wikipedia" });
  return {
    id: existing?.id ?? newId("b"),
    name,
    topic,
    sources,
    postsPerDay: Math.min(3, Math.max(1, Number(b.postsPerDay) || 1)),
    active: Boolean(b.active),
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "POST only" });
  try {
    const { action } = req.body ?? {};
    const file = await readDataFile(FILE);
    const bots = file?.json?.bots ?? [];

    if (action === "run") {
      const bot = bots.find((b) => b.id === req.body.id);
      if (!bot) return send(res, 404, { error: "Bot not found" });
      await startWorkflow({ mode: "bot", bot: bot.id });
      return send(res, 200, { ok: true, bots });
    }

    let next = bots;
    let message;
    if (action === "save") {
      const existing = bots.find((b) => b.id === req.body.bot?.id);
      const bot = cleanBot(req.body.bot ?? {}, existing);
      next = existing ? bots.map((b) => (b.id === bot.id ? bot : b)) : [...bots, bot];
      message = `${existing ? "Update" : "Add"} bot ${bot.name}`;
    } else if (action === "delete") {
      next = bots.filter((b) => b.id !== req.body.id);
      message = `Remove bot ${req.body.id}`;
    } else {
      return send(res, 400, { error: "Unknown action" });
    }
    if (next.length > 8) return send(res, 400, { error: "The Specialised Team room fits 8 bots" });
    await writeDataFile(FILE, JSON.stringify({ bots: next }, null, 2) + "\n", message, file?.sha);
    return send(res, 200, { ok: true, bots: next });
  } catch (e) {
    return send(res, 500, { error: e.message });
  }
}
