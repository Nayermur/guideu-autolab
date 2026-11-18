// Approve / Reject from the dashboard (behind the login), for the logged-in customer's own drafts.
// POST { id, decision: "approved" | "rejected" }

import { send, fail, recordDecision, requireSession } from "./_lib.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "POST only" });
  try {
    const s = await requireSession(req);
    const out = await recordDecision({ draftId: String(req.body?.id ?? ""), decision: req.body?.decision, via: "dashboard", tenant: s.tenant });
    return send(res, 200, { ok: true, ...out });
  } catch (e) {
    return fail(res, e);
  }
}
