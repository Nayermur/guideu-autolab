import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadTenantSecrets } from "./secrets.js";

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
  /** Optional order of background image sources, e.g. ["ai", "openverse"]. */
  imageSources?: ("wikimedia" | "openverse" | "ai")[];
  /** General search words used when nothing is found for the post itself, e.g. ["cinema theater"]. */
  imageFallback?: string[];
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
  /** Find background photos for posts (Wikimedia, Openverse, AI). Default true. */
  backgroundImages?: boolean;
}

export const team: TeamConfig = JSON.parse(readFileSync(resolve(ROOT, "team.json"), "utf8"));
if (process.env.DASHBOARD_URL) team.dashboardUrl = process.env.DASHBOARD_URL;

// ---------- Customers (tenants) ----------
// Every customer has their own folder: tenants/<id>/data (memory), tenants/<id>/output (post images),
// settings.json (page name, handle, niches) and secrets.json (their keys, encrypted).
// One run of the team works for one customer, chosen with TENANT. team.json holds what all customers share.

export interface TenantInfo {
  id: string;
  name: string;
  status: "active" | "paused";
  createdAt: string;
  /** The page owner's own tenant: may fall back to the keys stored as GitHub secrets. */
  owner?: boolean;
}

export interface TenantSettings {
  brand?: Partial<TeamConfig["brand"]>;
  baseHashtags?: string[];
  /** Ids of the shared niches this customer uses (all enabled niches if not set). */
  niches?: string[];
  autoPublish?: boolean;
}

export interface TenantSecrets {
  geminiKey?: string;
  telegramToken?: string;
  telegramChatId?: string;
  igUserId?: string;
  igToken?: string;
  /** graph.facebook.com (EAA tokens) or graph.instagram.com (IGAA tokens) */
  igGraphHost?: string;
  /** Telegram sends this with every button press to the customer's webhook (set by the Setup page). */
  telegramWebhookSecret?: string;
}

export const TENANTS_DIR = resolve(ROOT, "tenants");
export const TENANT = (process.env.TENANT || "guideu").trim();
if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(TENANT)) throw new Error(`Bad TENANT "${TENANT}"`);
export const TENANT_DIR = resolve(TENANTS_DIR, TENANT);
export const DATA_DIR = resolve(TENANT_DIR, "data");
export const OUTPUT_DIR = resolve(TENANT_DIR, "output");

const readJson = <T>(file: string, fallback: T): T => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : fallback);

export function listTenants(): TenantInfo[] {
  return readJson<{ tenants: TenantInfo[] }>(resolve(TENANTS_DIR, "index.json"), { tenants: [] }).tenants;
}

export const tenantInfo: TenantInfo = listTenants().find((t) => t.id === TENANT) ?? {
  id: TENANT, name: TENANT, status: "active", createdAt: "", owner: TENANT === "guideu",
};
export const tenantSettings: TenantSettings = readJson(resolve(TENANT_DIR, "settings.json"), {});

// Customer settings override the shared defaults.
team.brand = { ...team.brand, ...tenantSettings.brand };
if (tenantSettings.baseHashtags) team.baseHashtags = tenantSettings.baseHashtags;
if (tenantSettings.autoPublish !== undefined) team.autoPublish = tenantSettings.autoPublish;
if (tenantSettings.niches) {
  const chosen = new Set(tenantSettings.niches);
  team.niches = team.niches.map((n) => ({ ...n, enabled: n.enabled && chosen.has(n.id) }));
}

/** Public address of this customer's files on the dashboard site, e.g. https://site/t/guideu/ */
export const tenantBaseUrl = () => `${team.dashboardUrl.replace(/\/$/, "")}/t/${TENANT}/`;

function readSecrets(): TenantSecrets {
  try {
    return loadTenantSecrets(TENANT_DIR);
  } catch (e: any) {
    // The page owner's own runs must never stop over this: they still have the GitHub secrets.
    if (tenantInfo.owner) {
      console.warn(`Warning: could not read ${TENANT}'s saved keys (${e.message}); using the GitHub secrets.`);
      return {};
    }
    throw new Error(`Could not read the saved keys for ${TENANT}: ${e.message}`);
  }
}
/** This customer's saved keys (empty for keys they have not saved). */
export const secrets: TenantSecrets = readSecrets();
// Only the page owner's tenant may use the keys stored as GitHub secrets; a customer only ever uses their own.
const fromEnv = (name: string) => (tenantInfo.owner ? process.env[name] || "" : "");

export const env = {
  geminiKey: secrets.geminiKey || fromEnv("GEMINI_API_KEY"),
  geminiModels: (process.env.GEMINI_MODELS || "gemini-flash-lite-latest,gemini-3.5-flash,gemini-flash-latest")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  telegramToken: secrets.telegramToken || fromEnv("TELEGRAM_BOT_TOKEN"),
  telegramChatId: secrets.telegramChatId || fromEnv("TELEGRAM_CHAT_ID"),
  llmDelayMs: Number(process.env.LLM_DELAY_MS || 4000),
  igUserId: secrets.igUserId || fromEnv("IG_USER_ID"),
  igToken: secrets.igToken || fromEnv("IG_ACCESS_TOKEN"),
  // graph.facebook.com for "Instagram API with Facebook Login", graph.instagram.com for "with Instagram Login"
  igGraphBase:
    process.env.IG_GRAPH_BASE ||
    `https://${secrets.igGraphHost || process.env.IG_GRAPH_HOST || "graph.facebook.com"}/${process.env.IG_GRAPH_VERSION || "v23.0"}`,
  // For offline testing: path to a local RSS file used instead of the real sources.
  sampleFeed: process.env.SAMPLE_FEED || "",
  // Run one specific niche (its id) instead of the next one in the rotation.
  niche: process.env.NICHE || "",
};

export const enabledNiches = () => team.niches.filter((n) => n.enabled);
export const findNiche = (id: string) => team.niches.find((n) => n.id === id);
