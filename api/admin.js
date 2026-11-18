// The admin page (only for the admin): customers, their accounts, and invitation links.
// GET  → { tenants: [...with accounts], invites: [...] }
// POST { action: "invite", note?, days? }      → a new invitation link (single use)
// POST { action: "delete-invite", code }
// POST { action: "status", tenant, status: "active" | "paused" }

import { send, fail, requireSession, readDataFile, updateDataJson, listTenants, randomCode, TENANT_ID_RE } from "./_lib.js";

const INVITES = "invites.json";

export default async function handler(req, res) {
  try {
    const s = await requireSession(req);
    if (s.role !== "admin") return send(res, 403, { error: "Admin only" });
    const origin = `https://${req.headers["x-forwarded-host"] || req.headers.host}`;
    const withLink = (i) => ({ ...i, link: `${origin}/join?code=${i.code}` });

    if (req.method === "GET") {
      const [tenants, accounts, invites] = await Promise.all([
        listTenants(),
        readDataFile("accounts.json").then((f) => f?.json?.accounts ?? []),
        readDataFile(INVITES).then((f) => f?.json?.invites ?? []),
      ]);
      return send(res, 200, {
        tenants: tenants.map((t) => ({ ...t, accounts: accounts.filter((a) => a.tenant === t.id).map((a) => a.email) })),
        invites: invites.map(withLink).reverse(),
      });
    }

    const { action } = req.body ?? {};
    if (action === "invite") {
      const days = Math.min(30, Math.max(1, Number(req.body.days) || 7));
      const invite = {
        code: randomCode(24),
        note: String(req.body.note ?? "").trim().slice(0, 100),
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + days * 86400_000).toISOString(),
      };
      await updateDataJson(INVITES, { invites: [] }, (j) => { j.invites.push(invite); }, `Invite ${invite.note || invite.code.slice(0, 6)}`);
      return send(res, 200, { ok: true, invite: withLink(invite) });
    }
    if (action === "delete-invite") {
      await updateDataJson(INVITES, { invites: [] }, (j) => { j.invites = j.invites.filter((i) => i.code !== req.body.code); }, "Remove invite");
      return send(res, 200, { ok: true });
    }
    if (action === "status") {
      const { tenant, status } = req.body;
      if (!TENANT_ID_RE.test(String(tenant)) || !["active", "paused"].includes(status)) return send(res, 400, { error: "Bad request" });
      await updateDataJson("tenants/index.json", { tenants: [] }, (j) => {
        const t = j.tenants.find((x) => x.id === tenant);
        if (!t) throw Object.assign(new Error("Unknown customer"), { status: 404 });
        if (t.owner && status !== "active") throw Object.assign(new Error("Your own page cannot be paused here"), { status: 400 });
        t.status = status;
      }, `${status === "active" ? "Activate" : "Pause"} ${tenant}`);
      return send(res, 200, { ok: true });
    }
    return send(res, 400, { error: "Unknown action" });
  } catch (e) {
    return fail(res, e);
  }
}
