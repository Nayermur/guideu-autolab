// Log in (the form on /login posts here).
// - The admin (page owner): AUTH_EMAIL / AUTH_PASSWORD in Vercel. Starts in their own customer (DEFAULT_TENANT)
//   and can switch between customers.
// - Customers: accounts.json in the data repo (made when they join), each tied to one customer folder.
//   { "accounts": [{ "email", "tenant", "password": "pbkdf2$...", "createdAt", "disabled"? }] }

import { env, readDataFile, listTenants } from "./_lib.js";
import { safeEqual, checkPassword, sessionCookie } from "./_session.js";

const redirect = (res, url, cookie) => {
  if (cookie) res.setHeader("Set-Cookie", cookie);
  res.statusCode = 303;
  res.setHeader("Location", url);
  res.setHeader("Cache-Control", "no-store");
  res.end();
};

export default async function handler(req, res) {
  if (req.method !== "POST") return redirect(res, "/login");
  const { AUTH_EMAIL = "", AUTH_PASSWORD = "", AUTH_SECRET = "" } = process.env;
  const email = String(req.body?.email ?? "").trim().toLowerCase().slice(0, 200);
  const password = String(req.body?.password ?? "").slice(0, 200);
  const failed = async (code = 1) => {
    await new Promise((r) => setTimeout(r, 800)); // slow down password guessing
    return redirect(res, `/login?error=${code}`);
  };
  if (!AUTH_SECRET || !email || !password) return failed();

  try {
    // The admin
    if (AUTH_EMAIL && (await safeEqual(AUTH_SECRET, email, AUTH_EMAIL.trim().toLowerCase()))) {
      if (!(await safeEqual(AUTH_SECRET, password, AUTH_PASSWORD))) return failed();
      return redirect(res, "/", await sessionCookie(AUTH_SECRET, { email, tenant: env.tenant, role: "admin" }));
    }

    // A customer
    const accounts = (await readDataFile("accounts.json"))?.json?.accounts ?? [];
    const acc = accounts.find((a) => a.email === email);
    if (!acc || !(await checkPassword(AUTH_SECRET, password, acc.password))) return failed();
    const tenant = (await listTenants()).find((t) => t.id === acc.tenant);
    if (acc.disabled || !tenant) return failed(2);
    return redirect(res, "/", await sessionCookie(AUTH_SECRET, { email, tenant: acc.tenant, role: "customer" }));
  } catch {
    return failed(3);
  }
}
