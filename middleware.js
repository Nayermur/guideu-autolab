// Vercel Routing Middleware: protects the whole dashboard (pages, data and images) behind a login.
// Every customer logs in with their own account and only sees their own files under /t/<their id>/.
// Logging in itself happens in api/login.js; this file only checks the signed session cookie.
// Vercel environment variables: AUTH_SECRET (long random string that signs sessions), AUTH_EMAIL / AUTH_PASSWORD (the admin).

import { readSession, clearCookie } from "./api/_session.js";

export const config = {
  matcher: ["/((?!favicon.ico).*)"],
};

const PUBLIC_PATHS = new Set(["/login", "/login.html"]);
// Post images whose file name carries a 24-character random token are public, because
// Instagram must download them to publish. The token makes the URLs impossible to guess.
const PUBLIC_IMAGE = /^\/t\/[a-z0-9-]+\/output\/[A-Za-z0-9-]+-[A-Za-z0-9]{24}\.png$/;
// Server functions that work without a login (they check their own secret or password).
const PUBLIC_API = new Set(["/api/login", "/api/telegram"]);

const next = () => new Response(null, { headers: { "x-middleware-next": "1" } });
const redirect = (url, headers = {}) => new Response(null, { status: 303, headers: { Location: url, ...headers } });

export default async function middleware(request) {
  const url = new URL(request.url);
  const { AUTH_SECRET } = process.env;
  if (!AUTH_SECRET || AUTH_SECRET.length < 16) {
    return new Response("Login is not configured: set AUTH_SECRET (and AUTH_EMAIL, AUTH_PASSWORD) in Vercel.", { status: 500 });
  }

  if (url.pathname === "/api/logout") return redirect("/login", { "Set-Cookie": clearCookie() });
  if (PUBLIC_IMAGE.test(url.pathname) || PUBLIC_API.has(url.pathname)) return next();

  const session = await readSession(AUTH_SECRET, request.headers.get("cookie"));

  if (PUBLIC_PATHS.has(url.pathname)) return session ? redirect("/") : next();
  if (!session) {
    // Data and images get a plain 401; pages are sent to the login screen.
    if (/\.(json|png|js|css)$/.test(url.pathname) || url.pathname.startsWith("/api/")) return new Response("Unauthorized", { status: 401 });
    return redirect("/login");
  }

  // A customer's files are only for that customer.
  const own = url.pathname.match(/^\/t\/([^/]+)\//);
  if (own && own[1] !== session.tenant) return new Response("Forbidden", { status: 403 });
  return next();
}
