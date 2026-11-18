import { env } from "./config.js";
import type { State } from "./store.js";

/**
 * Background photos for posts, from free and legal sources:
 *  - Wikimedia Commons: real photos of places, buildings, food, history (credit required)
 *  - Openverse: Creative Commons photos for symbolic images (credit required)
 *  - Gemini image generation: AI illustrations (needs a paid Gemini plan; skipped on quota errors)
 * Work is spread across the sources with daily limits, and a failing source is skipped.
 */

export type ImageSource = "wikimedia" | "openverse" | "ai";

export interface FoundImage {
  mimeType: string;
  data: string; // base64
  source: ImageSource;
  /** Short credit shown on the post, e.g. "ছবি: Jane Doe / Wikimedia Commons (CC BY-SA 4.0)". */
  credit: string;
  /** Real photo of the subject, a symbolic stock photo, or an AI illustration. */
  kind: "real" | "symbolic" | "ai";
}

export const DAILY_LIMIT: Record<ImageSource, number> = { wikimedia: 40, openverse: 40, ai: 8 };
const UA = "AutoLabBot/0.1 (https://github.com/Nayermur/guideu-autolab)";
// Licenses that allow commercial use and changes (we put text over the photo).
const OK_LICENSE = /^(cc0|pdm|public domain|cc[- ]by(-sa)?[- ]?\d|by(-sa)?$)/i;

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" });

function usage(state: State) {
  if (!state.imageUsage || state.imageUsage.date !== today()) {
    state.imageUsage = { date: today(), counts: { wikimedia: 0, openverse: 0, ai: 0 }, unavailable: [] };
  }
  return state.imageUsage;
}

const stripTags = (s = "") => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

async function download(url: string, maxBytes = 6_000_000): Promise<{ mimeType: string; data: string } | null> {
  const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(25_000) });
  if (!r.ok) return null;
  const mimeType = (r.headers.get("content-type") ?? "").split(";")[0];
  if (!/^image\/(jpeg|png|webp)$/.test(mimeType)) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 15_000 || buf.length > maxBytes) return null; // too small to look good, or too big
  return { mimeType, data: buf.toString("base64") };
}

// ---------- Wikimedia Commons ----------
async function fromWikimedia(query: string): Promise<FoundImage | null> {
  const params = new URLSearchParams({
    action: "query", format: "json", generator: "search", gsrsearch: `${query} filetype:bitmap`,
    gsrnamespace: "6", gsrlimit: "10", prop: "imageinfo", iiprop: "url|extmetadata|size|mime", iiurlwidth: "1280",
  });
  const r = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`Wikimedia HTTP ${r.status}`);
  const pages: any[] = Object.values((await r.json())?.query?.pages ?? {}).sort((a: any, b: any) => (a.index ?? 0) - (b.index ?? 0));
  for (const p of pages) {
    const info = p.imageinfo?.[0];
    const meta = info?.extmetadata ?? {};
    const license = stripTags(meta.LicenseShortName?.value);
    if (!info || !/image\/(jpeg|png)/.test(info.mime) || info.width < 800 || !OK_LICENSE.test(license)) continue;
    const img = await download(info.thumburl || info.url).catch(() => null);
    if (!img) continue;
    // Commons sometimes writes "No machine-readable author provided. <name> assumed..."; keep just the name.
    const rawArtist = stripTags(meta.Artist?.value).replace(/No machine-readable author provided\.?\s*/i, "").replace(/\s+assumed.*$/i, "");
    const artist = rawArtist.slice(0, 40) || "Unknown";
    return { ...img, source: "wikimedia", kind: "real", credit: `ছবি: ${artist} / Wikimedia Commons (${license})` };
  }
  return null;
}

// ---------- Openverse ----------
async function fromOpenverse(query: string): Promise<FoundImage | null> {
  const params = new URLSearchParams({ q: query, license: "cc0,pdm,by,by-sa", page_size: "12", mature: "false" });
  const url = `https://api.openverse.org/v1/images/?${params}`;
  // Openverse is sometimes slow (504); one quick retry before moving on to the next source.
  let r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(25_000) }).catch(() => null);
  if (!r || r.status >= 500) {
    await new Promise((res) => setTimeout(res, 3000));
    r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(25_000) });
  }
  if (!r.ok) throw new Error(`Openverse HTTP ${r.status}`);
  for (const it of ((await r.json())?.results ?? []) as any[]) {
    if ((it.width ?? 0) < 800) continue;
    const img = (await download(it.url).catch(() => null)) ?? (await download(it.thumbnail).catch(() => null));
    if (!img) continue;
    const license = `${String(it.license).toUpperCase() === "PDM" ? "Public domain" : `CC ${String(it.license).toUpperCase()} ${it.license_version ?? ""}`}`.trim();
    const who = String(it.creator || "Unknown").slice(0, 40);
    return { ...img, source: "openverse", kind: "symbolic", credit: `প্রতীকী ছবি: ${who} / ${it.source ?? "Openverse"} (${license})` };
  }
  return null;
}

// ---------- Gemini AI illustration ----------
const AI_MODELS = (process.env.GEMINI_IMAGE_MODELS || "gemini-2.5-flash-image,gemini-3.1-flash-image").split(",").map((s) => s.trim());

async function fromAi(prompt: string): Promise<FoundImage | null> {
  if (!env.geminiKey) return null;
  let quotaError = false;
  for (const model of AI_MODELS) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-goog-api-key": env.geminiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${prompt}. Editorial illustration, rich colors, portrait 4:5. No text, no letters, no logos, no watermarks, no real people, no copyrighted characters.` }] }],
        generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "4:5" } },
      }),
      signal: AbortSignal.timeout(90_000),
    }).catch(() => null);
    if (!r) continue;
    if (r.status === 429) { quotaError = true; continue; }
    const j: any = await r.json().catch(() => ({}));
    const part = j?.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData || p.inline_data);
    const data = part?.inlineData?.data ?? part?.inline_data?.data;
    if (data) return { mimeType: part.inlineData?.mimeType ?? part.inline_data?.mime_type ?? "image/png", data, source: "ai", kind: "ai", credit: "AI দিয়ে আঁকা প্রতীকী ছবি" };
  }
  if (quotaError) throw Object.assign(new Error("Gemini image quota not available (needs a paid plan)"), { quota: true });
  return null;
}

/** Shorter search words to try when the full query finds nothing, e.g. "futuristic dystopian arena" → "dystopian arena". */
function simpler(query: string): string[] {
  const w = query.trim().split(/\s+/);
  return w.length > 2 ? [w.slice(-2).join(" "), w.slice(0, 2).join(" ")] : [];
}

/**
 * Finds a background image. `kind` "real" prefers Wikimedia (actual photos of the subject);
 * "symbolic" spreads work between Openverse and AI by today's usage. Sources over their daily limit,
 * or marked unavailable today (e.g. no AI quota), are skipped.
 *
 * So that (almost) every post gets a photo, it keeps trying in this order:
 *   1. the full search words on the niche's preferred sources, then on every other source
 *   2. shorter versions of the search words
 *   3. the niche's general fallback words (e.g. "cinema theater")
 */
export async function findImage(
  state: State,
  opts: { query: string; kind: "real" | "symbolic"; aiPrompt?: string; prefer?: ImageSource[]; fallback?: string[] },
): Promise<{ image: FoundImage | null; tried: string[] }> {
  const u = usage(state);
  const all: ImageSource[] = opts.kind === "real" ? ["wikimedia", "openverse", "ai"] : ["openverse", "ai", "wikimedia"];
  let order: ImageSource[] = opts.prefer?.length ? [...opts.prefer] : all;
  // Spread the load: among symbolic sources, the less used one today goes first.
  if (opts.kind === "symbolic" && !opts.prefer?.length) {
    const ratio = (s: ImageSource) => u.counts[s] / DAILY_LIMIT[s];
    order = [...order.filter((s) => s !== "wikimedia").sort((a, b) => ratio(a) - ratio(b)), "wikimedia"];
  }
  // The preferred sources first, then every other source.
  order = [...order, ...all.filter((s) => !order.includes(s))];

  const tried: string[] = [];
  const skip = new Set<ImageSource>();
  let aiTried = false;
  const queries = [...new Set([opts.query, ...simpler(opts.query), ...(opts.fallback ?? [])].map((q) => q.trim()).filter(Boolean))];

  for (const query of queries) {
    for (const src of order) {
      if (skip.has(src)) continue;
      if (u.unavailable.includes(src)) { tried.push(`${src}: unavailable today`); skip.add(src); continue; }
      if (u.counts[src] >= DAILY_LIMIT[src]) { tried.push(`${src}: daily limit reached`); skip.add(src); continue; }
      // One AI picture per post is enough: it draws from the scene description, not the search words.
      if (src === "ai") { if (aiTried) continue; aiTried = true; }
      try {
        const image = src === "wikimedia" ? await fromWikimedia(query)
          : src === "openverse" ? await fromOpenverse(query)
          : await fromAi(opts.aiPrompt || query);
        u.counts[src]++;
        if (image) {
          // A general niche photo is only a mood picture, not a photo of the subject itself.
          if (opts.fallback?.includes(query) && image.kind === "real") {
            image.kind = "symbolic";
            image.credit = image.credit.replace(/^ছবি:/, "প্রতীকী ছবি:");
          }
          return { image, tried: [...tried, `${src} "${query}": found`] };
        }
        tried.push(`${src} "${query}": nothing suitable`);
      } catch (e: any) {
        if (e.quota) u.unavailable.push(src);
        skip.add(src); // a failing source is not asked again for this post
        tried.push(`${src}: ${e.message}`);
      }
    }
  }
  return { image: null, tried };
}
