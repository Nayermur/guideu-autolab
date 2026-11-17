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

export interface TeamConfig {
  teamName: string;
  niche: string;
  audience: string;
  language: string;
  voice: string;
  postsPerRun: number;
  maxRevisions: number;
  minCriticScore: number;
  maxArticleAgeHours: number;
  brand: { name: string; handle: string; background: string; accent: string; text: string };
  baseHashtags: string[];
  sources: { name: string; url: string }[];
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
};
