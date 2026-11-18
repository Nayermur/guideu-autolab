// Joining with an invitation link (/join?code=...). Works without a login.
// GET  ?code=...  → { ok, note }  (is the link still valid?)
// POST { code, name, company, handle, email, password }
//   → creates the customer's folder, settings and account, uses up the invitation and logs them in.
//   The new customer starts in status "setup" (the team does not run for them until Setup is complete).

import { send, readDataFile, updateDataJson, writeDataFile, tenantPath, listTenants, TENANT_ID_RE } from "./_lib.js";
import { hashPassword, sessionCookie } from "./_session.js";

const INVITES = "invites.json";
const bad = (message, status = 400) => Object.assign(new Error(message), { status });

async function validInvite(code) {
  if (!/^[A-Za-z0-9]{24}$/.test(String(code))) return null;
  const invites = (await readDataFile(INVITES))?.json?.invites ?? [];
  const inv = invites.find((i) => i.code === code);
  if (!inv || inv.usedBy || Date.parse(inv.expiresAt) < Date.now()) return null;
  return inv;
}

/** A short folder id from the company name, e.g. "Dhaka Food Club" → "dhaka-food-club". */
function makeId(company, taken) {
  let base = company.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);
  if (base.length < 3) base = "client";
  let id = base;
  for (let n = 2; taken.has(id) || !TENANT_ID_RE.test(id); n++) id = `${base}-${n}`;
  return id;
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const inv = await validInvite(new URL(req.url, "http://x").searchParams.get("code"));
      if (!inv) return send(res, 404, { error: "এই ইনভাইট লিংকটা আর কাজ করছে না (মেয়াদ শেষ বা আগেই ব্যবহার হয়েছে)।" });
      return send(res, 200, { ok: true, note: inv.note || "" });
    }
    if (req.method !== "POST") return send(res, 405, { error: "POST only" });

    const b = req.body ?? {};
    const name = String(b.name ?? "").trim().slice(0, 80);
    const company = String(b.company ?? "").trim().slice(0, 80);
    const handle = String(b.handle ?? "").trim().replace(/^@?/, "@").slice(0, 40);
    const email = String(b.email ?? "").trim().toLowerCase().slice(0, 200);
    const password = String(b.password ?? "");
    if (!name || !company) throw bad("আপনার নাম আর কোম্পানির নাম দিন।");
    if (!/^@[A-Za-z0-9._]{1,30}$/.test(handle)) throw bad("Instagram হ্যান্ডেলটা ঠিক নেই (যেমন @yourpage)।");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad("ইমেইলটা ঠিক নেই।");
    if (password.length < 8) throw bad("পাসওয়ার্ড অন্তত ৮ অক্ষরের দিন।");
    if (email === String(process.env.AUTH_EMAIL ?? "").trim().toLowerCase()) throw bad("এই ইমেইল দিয়ে অ্যাকাউন্ট খোলা যাবে না।");

    const inv = await validInvite(b.code);
    if (!inv) throw bad("এই ইনভাইট লিংকটা আর কাজ করছে না।", 404);

    const accounts = (await readDataFile("accounts.json"))?.json?.accounts ?? [];
    if (accounts.some((a) => a.email === email)) throw bad("এই ইমেইল দিয়ে আগেই অ্যাকাউন্ট আছে। লগইন করুন।", 409);

    // 1. Use up the invitation first, so one link can only ever make one customer.
    const taken = new Set((await listTenants()).map((t) => t.id));
    const id = makeId(company, taken);
    await updateDataJson(INVITES, { invites: [] }, (j) => {
      const i = j.invites.find((x) => x.code === inv.code);
      if (!i || i.usedBy) throw bad("এই ইনভাইট লিংকটা আর কাজ করছে না।", 404);
      i.usedBy = id;
      i.usedAt = new Date().toISOString();
    }, `Invite used by ${id}`);

    // 2. The customer's folder: settings, then the customer list, then the login.
    const now = new Date().toISOString();
    await writeDataFile(tenantPath("settings.json", id), JSON.stringify({ brand: { name: company, handle }, contactName: name }, null, 2) + "\n", `New customer ${id}: settings`);
    await updateDataJson("tenants/index.json", { tenants: [] }, (j) => {
      if (j.tenants.some((t) => t.id === id)) throw bad("আবার চেষ্টা করুন।", 409);
      j.tenants.push({ id, name: company, status: "setup", createdAt: now });
    }, `New customer ${id}`);
    const passwordHash = await hashPassword(password);
    await updateDataJson("accounts.json", { accounts: [] }, (j) => {
      if (j.accounts.some((a) => a.email === email)) throw bad("এই ইমেইল দিয়ে আগেই অ্যাকাউন্ট আছে।", 409);
      j.accounts.push({ email, tenant: id, name, password: passwordHash, createdAt: now });
    }, `New account for ${id}`);

    res.setHeader("Set-Cookie", await sessionCookie(process.env.AUTH_SECRET, { email, tenant: id, role: "customer" }));
    return send(res, 200, { ok: true, tenant: id, redirect: "/setup" });
  } catch (e) {
    return send(res, e.status || 500, { error: e.message });
  }
}
