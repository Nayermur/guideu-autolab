// Who is logged in, and which customer the dashboard shows.
// GET  → { email, role, tenant, name, brand, tenants? }   (tenants: the customer list, admin only)
// POST { tenant } → the admin switches to another customer (a new session cookie)

import { send, fail, requireSession, tenantProfile, listTenants } from "./_lib.js";
import { sessionCookie, TENANT_ID } from "./_session.js";

export default async function handler(req, res) {
  try {
    const s = await requireSession(req);

    if (req.method === "POST") {
      if (s.role !== "admin") return send(res, 403, { error: "Only the admin can switch customers" });
      const tenant = String(req.body?.tenant ?? "");
      if (!TENANT_ID.test(tenant) || !(await listTenants()).some((t) => t.id === tenant)) return send(res, 404, { error: "Unknown customer" });
      res.setHeader("Set-Cookie", await sessionCookie(process.env.AUTH_SECRET, { ...s, tenant }));
      return send(res, 200, { ok: true, tenant });
    }

    const profile = await tenantProfile(s.tenant);
    const out = { email: s.email, role: s.role, tenant: s.tenant, name: profile.name, brand: profile.brand, status: profile.status };
    if (s.role === "admin") out.tenants = (await listTenants()).map(({ id, name, status }) => ({ id, name, status }));
    return send(res, 200, out);
  } catch (e) {
    return fail(res, e);
  }
}
