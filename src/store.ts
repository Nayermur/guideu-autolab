import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, type AgentKey } from "./config.js";
import type { EventInfo } from "./sources.js";

/**
 * Phase 1 storage: one JSON file in data/. GitHub Actions commits it back to the repo,
 * so it is free and you can see the full history. Later the dashboard can move to Supabase.
 */

export type DraftStatus = "pending" | "approved" | "rejected" | "published" | "failed";

export interface Draft {
  id: string;
  /** Which niche (team.json niches[].id) produced this draft. */
  niche?: string;
  /** Event details for event posters. */
  event?: EventInfo;
  createdAt: string;
  status: DraftStatus;
  source: { title: string; link: string; feed: string; published?: string };
  angle: string;
  facts: string[];
  headline: string;
  subline: string;
  caption: string;
  hashtags: string[];
  kicker: string;
  imagePath?: string;
  /** Credit for the background photo, if one was used. */
  imageCredit?: string;
  critic: { score: number; notes: string; revisions: number };
  decidedAt?: string;
  telegramMessageId?: number;
  /** Filled in by the Instagram publisher (Phase 3). */
  instagram?: { mediaId: string; permalink?: string; publishedAt: string };
  publish?: { attempts: number; lastError?: string; lastTriedAt?: string };
}

export interface AgentState {
  status: "idle" | "working" | "error";
  activity: string;
  updatedAt: string;
}

export interface LogEntry {
  at: string;
  agent: AgentKey | "system";
  message: string;
}

export interface State {
  agents: Record<string, AgentState>;
  drafts: Draft[];
  seenLinks: string[];
  logs: LogEntry[];
  telegramOffset: number;
  lastRunAt?: string;
  /** Position in the niche rotation. */
  nicheCursor?: number;
  /** Background image requests per source today, to spread the load (see images.ts). */
  imageUsage?: { date: string; counts: Record<"wikimedia" | "openverse" | "ai", number>; unavailable: string[] };
  /** Evergreen topics already turned into posts (e.g. "wiki:Panam Nagar"). */
  usedTopics?: string[];
}

const DATA_DIR = resolve(ROOT, "data");
const STATE_FILE = resolve(DATA_DIR, "state.json");

export function loadState(): State {
  if (!existsSync(STATE_FILE)) {
    return { agents: {}, drafts: [], seenLinks: [], logs: [], telegramOffset: 0 };
  }
  return JSON.parse(readFileSync(STATE_FILE, "utf8"));
}

export function saveState(state: State) {
  mkdirSync(DATA_DIR, { recursive: true });
  state.seenLinks = state.seenLinks.slice(-1000);
  if (state.usedTopics) state.usedTopics = state.usedTopics.slice(-2000);
  state.logs = state.logs.slice(-500);
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
}

export function log(state: State, agent: LogEntry["agent"], message: string) {
  const entry = { at: new Date().toISOString(), agent, message };
  state.logs.push(entry);
  console.log(`[${entry.at.slice(11, 19)}] ${agent.padEnd(8)} ${message}`);
}

export function setAgent(state: State, agent: AgentKey, status: AgentState["status"], activity: string) {
  state.agents[agent] = { status, activity, updatedAt: new Date().toISOString() };
  // Save on every status change so a live dashboard (Phase 2) can follow along.
  saveState(state);
}

/** Long random token used in public image URLs so they cannot be guessed. */
export function randomToken(length = 24) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

export function newId() {
  const d = new Date();
  const stamp = d.toISOString().slice(0, 10).replace(/-/g, "");
  return `${stamp}-${Math.random().toString(36).slice(2, 7)}`;
}
