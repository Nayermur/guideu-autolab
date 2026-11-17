import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export const ROOT = resolve(import.meta.dirname, "..");

// Minimal .env loader so no extra dependency is needed. Real env vars win.
const envPath = resolve(ROOT, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

export type AgentKey = "scout" | "verifier" | "writer" | "designer" | "critic";

/** Where a niche gets its raw material from. */
export type SourceConfig =
  /** Any RSS/Atom feed. `filter` is a case-insensitive regex; only matching stories are kept. */
  | { type: "rss"; name: string; url: string; filter?: string }
  /** Upcoming events listed on localoy.app (Dhaka). `tags` keeps only events with a matching tag. */
  | { type: "localoy-events"; name: string; tags?: string[]; daysAhead?: number }
  /** Wikipedia "On this day" events for today's date. */
  | { type: "wikipedia-onthisday"; name: string }
  /** A fixed list of Wikipedia article titles; one unused topic is picked at a time. */
  | { type: "wikipedia-topics"; name: string; topics: string[] };

export interface Niche {
  id: string;
  name: string;
  enabled: boolean;
  /** news = timely story, event = event poster, explainer = evergreen facts */
  format: "news" | "event" | "explainer";
  topic: string;
  audience: string;
  voice: string;
  postsPerRun: number;
  /** For news feeds: ignore stories older than this. */
  maxAgeHours?: number;
  hashtags: string[];
  /** Example labels for the image's kicker badge. */
  kickers: string[];
  sources: SourceConfig[];
}

export interface TeamConfig {
  teamName: string;
  language: string;
  maxRevisions: number;
  minCriticScore: number;
  brand: { name: string; handle: string; background: string; accent: string; text: string };
  /** Added to every post, e.g. the page's own hashtag. */
  baseHashtags: string[];
  niches: Niche[];
  agents: Record<AgentKey, { name: string; role: string }>;
  /** Public address of the Vercel dashboard; Instagram fetches post images from here. */
  dashboardUrl: string;
  /** Publish to Instagram automatically once a draft is approved. */
  autoPublish: boolean;
}

export const team: TeamConfig = JSON.parse(readFileSync(resolve(ROOT, "team.json"), "utf8"));
if (process.env.DASHBOARD_URL) team.dashboardUrl = process.env.DASHBOARD_URL;

export const env = {
  geminiKey: process.env.GEMINI_API_KEY || "",
  geminiModels: (process.env.GEMINI_MODELS || "gemini-flash-lite-latest,gemini-3.5-flash,gemini-flash-latest")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  telegramToken: process.env.TELEGRAM_BOT_TOKEN || "",
  telegramChatId: process.env.TELEGRAM_CHAT_ID || "",
  llmDelayMs: Number(process.env.LLM_DELAY_MS || 4000),
  igUserId: process.env.IG_USER_ID || "",
  igToken: process.env.IG_ACCESS_TOKEN || "",
  // graph.facebook.com for "Instagram API with Facebook Login", graph.instagram.com for "with Instagram Login"
  igGraphBase:
    process.env.IG_GRAPH_BASE ||
    `https://${process.env.IG_GRAPH_HOST || "graph.facebook.com"}/${process.env.IG_GRAPH_VERSION || "v23.0"}`,
  // For offline testing: path to a local RSS file used instead of the real sources.
  sampleFeed: process.env.SAMPLE_FEED || "",
  // Run one specific niche (its id) instead of the next one in the rotation.
  niche: process.env.NICHE || "",
};

export const enabledNiches = () => team.niches.filter((n) => n.enabled);
export const findNiche = (id: string) => team.niches.find((n) => n.id === id);
