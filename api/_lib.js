// Shared helpers for the dashboard's server functions (Vercel). Files starting with "_" are not routes.
// The login middleware already protects every /api/* request.
//
// Vercel environment variables:
//   GEMINI_API_KEY          Pakhi's AI
//   DASHBOARD_GITHUB_TOKEN  fine-grained token: data repo Contents read/write + code repo Actions read/write
//   DATA_REPO               e.g. "your-name/autolab-data"
//   CODE_REPO               e.g. "your-name/autolab"

export const env = {
  geminiKey: process.env.GEMINI_API_KEY || "",
  geminiModels: (process.env.GEMINI_MODELS || "gemini-flash-lite-latest,gemini-3.5-flash,gemini-flash-latest").split(",").map((s) => s.trim()),
  githubToken: process.env.DASHBOARD_GITHUB_TOKEN || "",
  dataRepo: process.env.DATA_REPO || "",
  codeRepo: process.env.CODE_REPO || "",
};

export function send(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

/** Calls Gemini with JSON output, trying each model in turn. `images` are {mimeType, data(base64)}. */
export async function gemini({ system, contents, images = [], temperature = 0.4 }) {
  if (!env.geminiKey) throw new Error("GEMINI_API_KEY is not set in Vercel");
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
        headers: { "Content-Type": "application/json", "X-goog-api-key": env.geminiKey },
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
  const r = await fetch(`https://api.github.com${path}`, {
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

/** Starts the team workflow now, e.g. {mode: "inbox"} or {mode: "bot", bot: "id"}. */
export async function startWorkflow(inputs) {
  await github(`/repos/${env.codeRepo}/actions/workflows/team.yml/dispatches`, {
    method: "POST",
    body: JSON.stringify({ ref: "main", inputs: { niche: "auto", bot: "", ...inputs } }),
  });
}

export const newId = (prefix = "") =>
  `${prefix}${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 7)}`;

/** Saves an Approve/Reject decision for the team and starts a sync right away. */
export async function recordDecision({ draftId, decision, via, chatId }) {
  if (!/^[\w-]{1,60}$/.test(draftId)) throw new Error("Bad draft id");
  if (!["approved", "rejected"].includes(decision)) throw new Error("Bad decision");
  const at = new Date().toISOString();
  const body = { draftId, decision, at, via, ...(chatId ? { chatId: String(chatId) } : {}) };
  await writeDataFile(`data/decisions/${draftId}-${Date.now()}.json`, JSON.stringify(body, null, 2) + "\n", `${decision} ${draftId} (${via})`);
  await startWorkflow({ mode: "telegram" });
  return body;
}
