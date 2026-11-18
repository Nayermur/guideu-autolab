import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, type Niche, type SourceConfig } from "./config.js";
import type { EventInfo } from "./sources.js";

/**
 * Data written by the dashboard (via its server functions) into the private data repo:
 *  - data/inbox/<id>.json + data/inbox/<id>/<n>.jpg : requests Pakhi organized from the owner's chat
 *  - data/bots.json                                  : Specialised Team bots the owner added
 */

const DATA = resolve(ROOT, "data");

// ---------- Pakhi's inbox ----------
export interface InboxRequest {
  id: string;
  createdAt: string;
  status: "new" | "done" | "failed";
  title: string;
  details: string;
  facts: string[];
  format: "news" | "event" | "explainer";
  event?: EventInfo;
  /** Image paths relative to data/, e.g. "inbox/abc/1.jpg". */
  images: string[];
  draftId?: string;
  error?: string;
}

const inboxDir = () => resolve(DATA, "inbox");

export function listInbox(status?: InboxRequest["status"]): InboxRequest[] {
  if (!existsSync(inboxDir())) return [];
  return readdirSync(inboxDir())
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(resolve(inboxDir(), f), "utf8")) as InboxRequest)
    .filter((r) => !status || r.status === status)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function saveInbox(r: InboxRequest) {
  mkdirSync(inboxDir(), { recursive: true });
  writeFileSync(resolve(inboxDir(), `${r.id}.json`), JSON.stringify(r, null, 2) + "\n");
}

/** Loads an inbox image as base64 for the AI and the renderer. */
export function readInboxImage(path: string): { mimeType: string; data: string } | null {
  const file = resolve(DATA, path);
  if (!file.startsWith(DATA) || !existsSync(file)) return null;
  const ext = path.split(".").pop()?.toLowerCase();
  const mimeType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  return { mimeType, data: readFileSync(file).toString("base64") };
}

/** Niche settings for the owner's own requests (they are trusted, so nothing is fact-checked). */
export function officeNiche(format: InboxRequest["format"]): Niche {
  return {
    id: "office",
    name: "My Office",
    enabled: true,
    format,
    topic: "Posts the page owner asked for personally through their assistant Pakhi",
    audience: "Followers of GuideU BD in Bangladesh",
    voice: "Clear, friendly and engaging. Use only the details the owner gave; never invent anything.",
    postsPerRun: 1,
    hashtags: [],
    kickers: ["নতুন", "আপডেট", "ঘোষণা", "জানেন কি?", "ইভেন্ট"],
    sources: [],
  };
}

// ---------- Specialised Team bots ----------
export interface Bot {
  id: string;
  name: string;
  topic: string;
  sources: SourceConfig[];
  postsPerDay: number;
  active: boolean;
  createdAt: string;
}

export function loadBots(): Bot[] {
  const file = resolve(DATA, "bots.json");
  if (!existsSync(file)) return [];
  return (JSON.parse(readFileSync(file, "utf8")).bots ?? []) as Bot[];
}

export function findBot(id: string): Bot | undefined {
  return loadBots().find((b) => b.id === id);
}

/** A bot works like a niche of its own. */
export function botNiche(bot: Bot): Niche {
  const types = new Set(bot.sources.map((s) => s.type));
  const format: Niche["format"] = types.has("localoy-events") && types.size === 1
    ? "event"
    : [...types].every((t) => t.startsWith("wikipedia"))
      ? "explainer"
      : "news";
  return {
    id: `bot:${bot.id}`,
    name: bot.name,
    enabled: bot.active,
    format,
    topic: bot.topic,
    audience: "Instagram followers of GuideU BD in Bangladesh",
    voice: "Clear, accurate and engaging, in simple Bangla. No clickbait, no invented facts.",
    postsPerRun: 1,
    maxAgeHours: 72,
    hashtags: [],
    kickers: ["আপডেট", "নতুন", "জানেন কি?", "খবর", "বিশেষ"],
    sources: bot.sources.length
      ? bot.sources
      : // No sources given: search Google News for the topic.
        [{ type: "rss", name: "Google News", url: `https://news.google.com/rss/search?q=${encodeURIComponent(bot.topic)}+when:3d&hl=bn&gl=BD&ceid=BD:bn` }],
  };
}

// ---------- Approvals from the dashboard ----------
/** Written by the dashboard's server functions: data/decisions/<draftId>-<time>.json */
export interface Decision {
  draftId: string;
  decision: "approved" | "rejected";
  at: string;
  via: "telegram" | "dashboard";
  /** For Telegram presses: the chat the button was pressed in. */
  chatId?: string;
  file: string;
}

export function removeDecision(d: Decision) {
  rmSync(d.file, { force: true });
}

export function takeDecisions(): Decision[] {
  const dir = resolve(DATA, "decisions");
  if (!existsSync(dir)) return [];
  const list = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({ ...(JSON.parse(readFileSync(resolve(dir, f), "utf8")) as Omit<Decision, "file">), file: resolve(dir, f) }))
    .sort((a, b) => a.at.localeCompare(b.at));
  return list;
}

/** The private settings the dashboard and the workflow share (not published to the site). */
export function privateConfig(): { telegramWebhookSecret?: string } {
  const file = resolve(DATA, "config", "telegram.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
}
