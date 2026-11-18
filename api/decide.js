// Approve / Reject from the dashboard (behind the login).
// POST { id, decision: "approved" | "rejected" }

import { send, recordDecision } from "./_lib.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "POST only" });
  try {
    const out = await recordDecision({ draftId: String(req.body?.id ?? ""), decision: req.body?.decision, via: "dashboard" });
    return send(res, 200, { ok: true, ...out });
  } catch (e) {
    return send(res, 500, { error: e.message });
  }
}
