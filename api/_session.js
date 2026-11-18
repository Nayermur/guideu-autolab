// Login sessions and password hashing, shared by the middleware (Edge) and the server functions (Node).
// Uses only Web Crypto, which both runtimes have. Files starting with "_" are not routes.
//
// Session cookie: base64url(JSON {e: email, t: tenant, r: role, x: expiry ms}) + "." + HMAC-SHA256 signature,
// signed with AUTH_SECRET. Roles: "admin" (the page owner, can switch between customers) and "customer".

export const COOKIE = "autolab_session";
export const SESSION_DAYS = 7;
const enc = new TextEncoder();

function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

/** Compares two strings in constant time by comparing their HMACs. */
export async function safeEqual(secret, a, b) {
  const [x, y] = await Promise.all([hmac(secret, `cmp:${a}`), hmac(secret, `cmp:${b}`)]);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.min(x.length, y.length); i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

/** Builds the Set-Cookie header for a new session. */
export async function sessionCookie(secret, { email, tenant, role }) {
  const x = Date.now() + SESSION_DAYS * 86400_000;
  const body = b64url(enc.encode(JSON.stringify({ e: email, t: tenant, r: role, x })));
  const value = `${body}.${await hmac(secret, `session:${body}`)}`;
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}

export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

/** Reads and checks the session cookie. Returns { email, tenant, role } or null. */
export async function readSession(secret, cookieHeader) {
  if (!secret) return null;
  const raw = String(cookieHeader ?? "").split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!raw) return null;
  const [body, sig] = raw.split(".");
  if (!body || !sig) return null;
  if (!(await safeEqual(secret, sig, await hmac(secret, `session:${body}`)))) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(fromB64url(body)));
    if (!p.x || p.x < Date.now() || !p.t || !["admin", "customer"].includes(p.r)) return null;
    return { email: p.e, tenant: p.t, role: p.r };
  } catch {
    return null;
  }
}

// ---------- passwords (PBKDF2-SHA256) ----------
const ITERATIONS = 100_000;

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return b64url(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}

/** Returns "pbkdf2$<iterations>$<salt>$<hash>". */
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONS}$${b64url(salt)}$${await pbkdf2(password, salt, ITERATIONS)}`;
}

export async function checkPassword(secret, password, stored) {
  const [kind, iter, salt, hash] = String(stored ?? "").split("$");
  if (kind !== "pbkdf2" || !salt || !hash) return false;
  return safeEqual(secret, await pbkdf2(password, fromB64url(salt), Number(iter)), hash);
}

export const TENANT_ID = /^[a-z0-9][a-z0-9-]{1,30}$/;
