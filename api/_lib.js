// Shared helpers for the dashboard's server functions (Vercel). Files starting with "_" are not routes.
// The login middleware already protects every /api/* request; each function still reads the session
// (requireSession) to know which customer it works for.

import { readSession } from "./_session.js";
import { decryptSecrets } from "./_crypto.js";
//
// Vercel environment variables:
//   GEMINI_API_KEY          Pakhi's AI
//   DASHBOARD_GITHUB_TOKEN  fine-grained token: data repo Contents read/write + code repo Actions read/write
//   DATA_REPO               e.g. "your-name/autolab-data"
//   CODE_REPO               e.g. "your-name/autolab"
//   DEFAULT_TENANT          the admin's own customer (default "guideu")
//   TENANT_SECRETS_KEY      unlocks customers' keys (same value as the GitHub secret)
//   AUTH_SECRET             signs login sessions
//
// Each customer's files live in the data repo under tenants/<id>/ (data/, output/, settings.json, secrets.json).

export const env = {
  geminiKey: process.env.GEMINI_API_KEY || "",
  geminiModels: (process.env.GEMINI_MODELS || "gemini-flash-lite-latest,gemini-3.5-flash,gemini-flash-latest").split(",").map((s) => s.trim()),
  githubToken: process.env.DASHBOARD_GITHUB_TOKEN || "",
  dataRepo: process.env.DATA_REPO || "",
  codeRepo: process.env.CODE_REPO || "",
  tenant: process.env.DEFAULT_TENANT || "guideu",
  githubApi: process.env.GITHUB_API_URL || "https://api.github.com",
};

/** The logged-in user: { email, tenant, role }. Throws a 401 error when there is no valid session. */
export async function requireSession(req) {
  const s = await readSession(process.env.AUTH_SECRET, req.headers?.cookie);
  if (!s) throw Object.assign(new Error("Please log in again"), { status: 401 });
  return s;
}

/** Path of a file in a customer's folder in the data repo, e.g. tenantPath("data/bots.json"). */
export const tenantPath = (path, tenant = env.tenant) => `tenants/${tenant}/${path}`;

export function send(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

/** Calls Gemini with JSON output, trying each model in turn. `images` are {mimeType, data(base64)}. */
export async function gemini({ system, contents, images = [], temperature = 0.4, key = env.geminiKey }) {
  if (!key) throw new Error("No Gemini API key: add yours in Setup");
  const last = contents[contents.length - 1];
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: contents.map((c) => ({
      role: c.role,
      parts: [
        ...(c === last ? images.map((i) => ({ inline_data: { mime_type: i.mimeType, data: i.data } })) : []),
        { text: c.text },
      ],
    })),
    generationConfig: { temperature, responseMimeType: "application/json" },
  };
  const errors = [];
  for (const model of env.geminiModels) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-goog-api-key": key },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(25_000),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`${model}: HTTP ${r.status} ${j?.error?.message ?? ""}`);
      const text = j?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      return JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
    } catch (e) {
      errors.push(e.message);
    }
  }
  throw new Error(`AI is busy right now (${errors.join(" | ").slice(0, 300)})`);
}

async function github(path, init = {}) {
  if (!env.githubToken) throw new Error("DASHBOARD_GITHUB_TOKEN is not set in Vercel");
  const r = await fetch(`${env.githubApi}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.githubToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "autolab-dashboard",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (r.status === 204) return null;
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    // Fine-grained tokens answer 404 (not 403) when a repo or permission is missing, so say which one.
    const repo = path.split("/").slice(2, 4).join("/");
    const need = path.includes("/actions/") ? "Actions: Read and write" : "Contents: Read and write";
    const hint = r.status === 404 || r.status === 403
      ? ` (token needs access to ${repo} with ${need})`
      : "";
    const err = new Error(`GitHub ${r.status}: ${j.message ?? "error"}${hint}`);
    err.status = r.status;
    throw err;
  }
  return j;
}

/** Reads a JSON file from the data repo (null if it does not exist). */
export async function readDataFile(path) {
  try {
    const j = await github(`/repos/${env.dataRepo}/contents/${path}`);
    return { sha: j.sha, json: JSON.parse(Buffer.from(j.content, "base64").toString("utf8")) };
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

/** Creates or replaces a file in the data repo. `content` is a Buffer or a string. */
export async function writeDataFile(path, content, message, sha) {
  const b64 = Buffer.isBuffer(content) ? content.toString("base64") : Buffer.from(content, "utf8").toString("base64");
  return github(`/repos/${env.dataRepo}/contents/${path}`, {
    method: "PUT",
    body: JSON.stringify({ message, content: b64, ...(sha ? { sha } : {}) }),
  });
}

/** Starts the team workflow now for one customer, e.g. {mode: "inbox"} or {mode: "bot", bot: "id"}. */
export async function startWorkflow(inputs, tenant = env.tenant) {
  await github(`/repos/${env.codeRepo}/actions/workflows/team.yml/dispatches`, {
    method: "POST",
    body: JSON.stringify({ ref: "main", inputs: { niche: "auto", bot: "", tenant, ...inputs } }),
  });
}

export const newId = (prefix = "") =>
  `${prefix}${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 7)}`;

/** Saves an Approve/Reject decision for the team and starts a sync right away. */
export async function recordDecision({ draftId, decision, via, chatId, tenant = env.tenant }) {
  if (!/^[\w-]{1,60}$/.test(draftId)) throw new Error("Bad draft id");
  if (!["approved", "rejected"].includes(decision)) throw new Error("Bad decision");
  const at = new Date().toISOString();
  const body = { draftId, decision, at, via, ...(chatId ? { chatId: String(chatId) } : {}) };
  await writeDataFile(tenantPath(`data/decisions/${draftId}-${Date.now()}.json`, tenant), JSON.stringify(body, null, 2) + "\n", `${decision} ${draftId} (${via})`);
  await startWorkflow({ mode: "telegram" }, tenant);
  return body;
}

// ---------- customers ----------
/** The customer list (tenants/index.json). */
export async function listTenants() {
  return (await readDataFile("tenants/index.json"))?.json?.tenants ?? [];
}

/** A customer's name, page brand and status. */
export async function tenantProfile(tenant) {
  const [list, settings] = await Promise.all([listTenants(), readDataFile(tenantPath("settings.json", tenant))]);
  const info = list.find((t) => t.id === tenant);
  if (!info) throw Object.assign(new Error("Unknown customer"), { status: 404 });
  const s = settings?.json ?? {};
  return { ...info, brand: { name: s.brand?.name || info.name, handle: s.brand?.handle || "" } };
}

/** A customer's own keys (decrypted). The admin's own customer falls back to the keys set in Vercel. */
export async function tenantSecrets(tenant, profile) {
  const file = await readDataFile(tenantPath("secrets.json", tenant));
  const secrets = file ? decryptSecrets(file.json) : {};
  if (profile?.owner && !secrets.geminiKey) secrets.geminiKey = env.geminiKey;
  return secrets;
}

/** Sends an error from a server function with the right status. */
export const fail = (res, e) => send(res, e.status || 500, { error: e.message });
