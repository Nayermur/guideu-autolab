// Vercel Routing Middleware: protects the whole dashboard (pages, data and images) behind a login.
// Credentials live in Vercel environment variables, never in the repo:
//   AUTH_EMAIL, AUTH_PASSWORD, AUTH_SECRET (a long random string used to sign the session cookie)

export const config = {
  matcher: ["/((?!favicon.ico).*)"],
};

const COOKIE = "autolab_session";
const SESSION_DAYS = 7;
const PUBLIC_PATHS = new Set(["/login", "/login.html"]);
// Post images whose file name carries a 24-character random token are public, because
// Instagram must download them to publish. The token makes the URLs impossible to guess.
const PUBLIC_IMAGE = /^\/output\/[A-Za-z0-9-]+-[A-Za-z0-9]{24}\.png$/;
const enc = new TextEncoder();

const next = () => new Response(null, { headers: { "x-middleware-next": "1" } });
const redirect = (url, headers = {}) => new Response(null, { status: 303, headers: { Location: url, ...headers } });

function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

/** Compares two strings in constant time by comparing their HMACs. */
async function safeEqual(secret, a, b) {
  const [x, y] = await Promise.all([hmac(secret, `cmp:${a}`), hmac(secret, `cmp:${b}`)]);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.min(x.length, y.length); i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

async function validSession(secret, cookieHeader) {
  const raw = cookieHeader?.split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!raw) return false;
  const [exp, sig] = raw.split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEqual(secret, sig, await hmac(secret, `session:${exp}`));
}

export default async function middleware(request) {
  const url = new URL(request.url);
  const { AUTH_EMAIL, AUTH_PASSWORD, AUTH_SECRET } = process.env;

  if (!AUTH_EMAIL || !AUTH_PASSWORD || !AUTH_SECRET || AUTH_SECRET.length < 16) {
    return new Response("Login is not configured: set AUTH_EMAIL, AUTH_PASSWORD and AUTH_SECRET in Vercel.", { status: 500 });
  }

  // Log in
  if (url.pathname === "/api/login" && request.method === "POST") {
    const form = await request.formData().catch(() => null);
    const email = String(form?.get("email") ?? "").trim().toLowerCase();
    const password = String(form?.get("password") ?? "");
    const ok = (await safeEqual(AUTH_SECRET, email, AUTH_EMAIL.trim().toLowerCase())) & (await safeEqual(AUTH_SECRET, password, AUTH_PASSWORD));
    if (!ok) {
      await new Promise((r) => setTimeout(r, 800)); // slow down password guessing
      return redirect("/login?error=1");
    }
    const exp = String(Date.now() + SESSION_DAYS * 86400_000);
    const cookie = `${COOKIE}=${exp}.${await hmac(AUTH_SECRET, `session:${exp}`)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
    return redirect("/", { "Set-Cookie": cookie });
  }

  // Log out
  if (url.pathname === "/api/logout") {
    return redirect("/login", { "Set-Cookie": `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` });
  }

  if (PUBLIC_IMAGE.test(url.pathname)) return next();

  const loggedIn = await validSession(AUTH_SECRET, request.headers.get("cookie"));

  if (PUBLIC_PATHS.has(url.pathname)) {
    return loggedIn ? redirect("/") : next();
  }
  if (!loggedIn) {
    // Data and images get a plain 401; pages are sent to the login screen.
    if (/\.(json|png|js|css)$/.test(url.pathname)) return new Response("Unauthorized", { status: 401 });
    return redirect("/login");
  }
  return next();
}
