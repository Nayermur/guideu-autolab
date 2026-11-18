import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { OUTPUT_DIR, team } from "./config.js";
import { randomToken } from "./store.js";
import type { DesignBrief } from "./agents.js";
import type { EventInfo } from "./sources.js";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Post size: square 1080x1080 by default ("postSize": "portrait" in team.json gives 1080x1350). */
export const POST_W = 1080;
export const POST_H = (team as any).postSize === "portrait" ? 1350 : 1080;
const SQ = POST_H === 1080;
/** Scales a size for the square format, where there is less room. */
const k = (n: number) => Math.round(SQ ? n * 0.85 : n);

const BN_MONTHS = ["জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন", "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর"];
const BN_DAYS = ["রবিবার", "সোমবার", "মঙ্গলবার", "বুধবার", "বৃহস্পতিবার", "শুক্রবার", "শনিবার"];
const bnDigits = (s: string | number) => String(s).replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);

/** Date block for event posters, e.g. big "২১" + "নভেম্বর · শুক্রবার", or a range for multi-day events. */
export function eventDate(ev: EventInfo) {
  const [y, m, d] = ev.start.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, d));
  const multi = ev.end && ev.end !== ev.start;
  if (!multi) return { big: bnDigits(d), small: `${BN_MONTHS[m - 1]} · ${BN_DAYS[start.getUTCDay()]}` };
  const [, m2, d2] = ev.end!.split("-").map(Number);
  return {
    big: `${bnDigits(d)}–${bnDigits(d2)}`,
    small: m2 === m ? BN_MONTHS[m - 1] : `${BN_MONTHS[m - 1]} – ${BN_MONTHS[m2 - 1]}`,
  };
}

/** Builds the Instagram post (square by default) as HTML. Edit this to change your visual style. */
export function postHtml(o: { headline: string; subline: string; source: string; brief: DesignBrief; event?: EventInfo; photo?: string; credit?: string }): string {
  o = { ...o, headline: String(o.headline ?? ""), subline: String(o.subline ?? ""), source: String(o.source ?? "") };
  if (o.photo && (o.brief.layout === "photo-bg" || o.brief.layout === "photo-card")) return photoPosterHtml({ ...o, photo: o.photo });
  if (o.event && o.brief.layout === "event") return eventPosterHtml({ ...o, event: o.event });
  const b = team.brand;
  const big = o.brief.layout === "bold";
  const headlineSize = k(o.headline.length > 60 ? 76 : o.headline.length > 40 ? 88 : big ? 108 : 96);
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@500;700&family=Space+Grotesk:wght@500;700&display=block" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: ${POST_W}px; height: ${POST_H}px; background: ${b.background}; color: ${b.text};
    font-family: "Space Grotesk", "Hind Siliguri", sans-serif; overflow: hidden; position: relative; }
  .grid { position: absolute; inset: 0; opacity: .07;
    background-image: linear-gradient(${b.text} 1px, transparent 1px), linear-gradient(90deg, ${b.text} 1px, transparent 1px);
    background-size: 54px 54px; }
  .glow { position: absolute; width: 900px; height: 900px; border-radius: 50%; right: -380px; top: -320px;
    background: radial-gradient(circle, ${b.accent}55, transparent 65%); }
  .wrap { position: absolute; inset: ${SQ ? 72 : 90}px; display: flex; flex-direction: column; }
  .top { display: flex; align-items: center; gap: 18px; font-size: 30px; letter-spacing: 6px; text-transform: uppercase; }
  .dot { width: 18px; height: 18px; border-radius: 50%; background: ${b.accent}; }
  .kicker { margin-top: auto; align-self: flex-start; background: ${b.accent}; color: #fff; font-weight: 700;
    font-size: 34px; padding: 10px 26px; border-radius: 12px; letter-spacing: 2px; }
  .emoji { position: absolute; right: ${SQ ? 72 : 90}px; top: ${SQ ? 130 : 170}px; font-size: ${k(big ? 150 : 110)}px; }
  h1 { font-family: "Hind Siliguri", "Space Grotesk", sans-serif; font-weight: 700; font-size: ${headlineSize}px;
    line-height: 1.18; margin-top: ${k(34)}px; }
  .sub { font-family: "Hind Siliguri", sans-serif; font-weight: 500; font-size: ${k(42)}px; line-height: 1.45; opacity: .82;
    margin-top: ${k(34)}px; ${o.brief.layout === "split" ? `border-left: 8px solid ${b.accent}; padding-left: 28px;` : ""} }
  .foot { margin-top: ${k(64)}px; padding-top: ${k(30)}px; border-top: 2px solid ${b.text}33; display: flex; justify-content: space-between;
    font-size: 28px; opacity: .75; letter-spacing: 1px; }
</style></head><body>
  <div class="grid"></div>${o.brief.layout === "minimal" ? "" : '<div class="glow"></div>'}
  <div class="wrap">
    <div class="top"><span class="dot"></span>${esc(b.name)}</div>
    <div class="kicker">${esc(o.brief.kicker)}</div>
    <h1>${esc(o.headline)}</h1>
    <div class="sub">${esc(o.subline)}</div>
    <div class="foot"><span>${team.language.toLowerCase() === "bangla" ? "সূত্র" : "Source"}: ${esc(o.source)}</span><span>${esc(b.handle)}</span></div>
  </div>
  <div class="emoji">${esc(o.brief.emoji)}</div>
</body></html>`;
}

/** Event poster: date block, event name, what to expect, venue and area. */
function eventPosterHtml(o: { headline: string; subline: string; source: string; brief: DesignBrief; event: EventInfo }): string {
  const b = team.brand;
  const date = eventDate(o.event);
  const headlineSize = k(o.headline.length > 50 ? 72 : o.headline.length > 30 ? 84 : 100);
  const where = [o.event.venue, o.event.area].filter(Boolean).join(", ");
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@500;700&family=Space+Grotesk:wght@500;700&display=block" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: ${POST_W}px; height: ${POST_H}px; background: ${b.background}; color: ${b.text};
    font-family: "Hind Siliguri", "Space Grotesk", sans-serif; overflow: hidden; position: relative; }
  .grid { position: absolute; inset: 0; opacity: .07;
    background-image: linear-gradient(${b.text} 1px, transparent 1px), linear-gradient(90deg, ${b.text} 1px, transparent 1px);
    background-size: 54px 54px; }
  .glow { position: absolute; width: 1000px; height: 1000px; border-radius: 50%; left: -420px; bottom: -480px;
    background: radial-gradient(circle, ${b.accent}44, transparent 65%); }
  .wrap { position: absolute; inset: ${SQ ? 72 : 90}px; display: flex; flex-direction: column; }
  .top { display: flex; align-items: center; justify-content: space-between; font-family: "Space Grotesk", sans-serif;
    font-size: 30px; letter-spacing: 6px; text-transform: uppercase; }
  .brand { display: flex; align-items: center; gap: 18px; }
  .dot { width: 18px; height: 18px; border-radius: 50%; background: ${b.accent}; }
  .emoji { font-size: 84px; letter-spacing: 0; }
  .date { margin-top: ${SQ ? 36 : 70}px; align-self: flex-start; display: flex; align-items: center; gap: 30px;
    background: ${b.text}; color: ${b.background}; border-radius: 28px; padding: 22px 40px 22px 34px; }
  .date b { font-size: ${k(120)}px; line-height: 1; font-weight: 700; }
  .date span { font-size: ${k(40)}px; font-weight: 700; line-height: 1.25; max-width: 420px; }
  .kicker { margin-top: auto; align-self: flex-start; background: ${b.accent}; color: #fff; font-weight: 700;
    font-size: 34px; padding: 10px 26px; border-radius: 12px; }
  h1 { font-weight: 700; font-size: ${headlineSize}px; line-height: 1.15; margin-top: ${k(30)}px; }
  .sub { font-weight: 500; font-size: ${k(40)}px; line-height: 1.45; opacity: .82; margin-top: ${k(26)}px; }
  .where { margin-top: ${k(34)}px; display: flex; gap: 16px; align-items: flex-start; font-size: ${k(40)}px; font-weight: 700; line-height: 1.35; }
  .foot { margin-top: ${k(54)}px; padding-top: ${k(28)}px; border-top: 2px solid ${b.text}33; display: flex; justify-content: space-between;
    font-family: "Space Grotesk", "Hind Siliguri", sans-serif; font-size: 28px; opacity: .75; letter-spacing: 1px; }
</style></head><body>
  <div class="grid"></div><div class="glow"></div>
  <div class="wrap">
    <div class="top"><span class="brand"><span class="dot"></span>${esc(b.name)}</span><span class="emoji">${esc(o.brief.emoji)}</span></div>
    <div class="date"><b>${esc(date.big)}</b><span>${esc(date.small)}</span></div>
    <div class="kicker">${esc(o.brief.kicker)}</div>
    <h1>${esc(o.headline)}</h1>
    <div class="sub">${esc(o.subline)}</div>
    ${where ? `<div class="where"><span>📍</span><span>${esc(where)}</span></div>` : ""}
    <div class="foot"><span>${o.event.organizer ? `${team.language.toLowerCase() === "bangla" ? "আয়োজক" : "Organizer"}: ${esc(o.event.organizer)}` : ""}</span><span>${esc(b.handle)}</span></div>
  </div>
</body></html>`;
}

/** Posts built around the owner's photo: full background with overlay, or a photo card with text below. */
function photoPosterHtml(o: { headline: string; subline: string; source: string; brief: DesignBrief; event?: EventInfo; photo: string; credit?: string }): string {
  const b = team.brand;
  const bg = o.brief.layout === "photo-bg";
  const date = o.event ? eventDate(o.event) : null;
  const where = o.event ? [o.event.venue, o.event.area].filter(Boolean).join(", ") : "";
  // Card: the photo takes the top part, the text gets the rest.
  const PHOTO_H = SQ ? 540 : 640;
  const headlineSize = bg
    ? k(o.headline.length > 50 ? 70 : o.headline.length > 30 ? 82 : 96)
    : (SQ ? (o.headline.length > 50 ? 46 : o.headline.length > 30 ? 52 : 60) : (o.headline.length > 50 ? 58 : o.headline.length > 30 ? 66 : 78));
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@500;700&family=Space+Grotesk:wght@500;700&display=block" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: ${POST_W}px; height: ${POST_H}px; background: ${b.background}; color: ${b.text};
    font-family: "Hind Siliguri", "Space Grotesk", sans-serif; overflow: hidden; position: relative; }
  .photo { position: absolute; left: 0; top: 0; width: ${POST_W}px; height: ${bg ? POST_H : PHOTO_H}px;
    background: url("${o.photo}") center / cover no-repeat; }
  .shade { position: absolute; inset: 0; background: ${bg
    ? `linear-gradient(180deg, ${b.background}cc 0%, ${b.background}22 28%, ${b.background}bb 50%, ${b.background}f2 66%, ${b.background} 85%)`
    : `linear-gradient(180deg, ${b.background}99 0px, transparent 180px, transparent ${PHOTO_H - 170}px, ${b.background} ${PHOTO_H}px)`}; }
  /* Card: the photo fills the top, the text gets its own area below it so they never overlap. */
  .wrap { position: absolute; ${bg ? `inset: ${SQ ? 72 : 90}px;` : `left: ${SQ ? 72 : 90}px; right: ${SQ ? 72 : 90}px; top: ${PHOTO_H + 10}px; bottom: ${SQ ? 44 : 60}px;`} display: flex; flex-direction: column; }
  .top { position: absolute; top: ${SQ ? 72 : 90}px; left: ${SQ ? 72 : 90}px; display: flex; align-items: center; gap: 18px; font-family: "Space Grotesk", sans-serif; font-size: 30px;
    letter-spacing: 6px; text-transform: uppercase; text-shadow: 0 2px 12px #0008; }
  .dot { width: 18px; height: 18px; border-radius: 50%; background: ${b.accent}; }
  .row { margin-top: ${bg ? "auto" : "0"}; display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
  .kicker { background: ${b.accent}; color: #fff; font-weight: 700; font-size: ${k(34)}px; padding: ${SQ ? "8px 22px" : "10px 26px"}; border-radius: 12px; }
  .date { background: ${b.text}; color: ${b.background}; font-weight: 700; font-size: ${k(34)}px; padding: ${SQ ? "8px 20px" : "10px 24px"}; border-radius: 12px; }
  h1 { font-weight: 700; font-size: ${headlineSize}px; line-height: 1.15; margin-top: ${bg ? k(26) : 18}px; text-shadow: 0 2px 18px #0009; }
  .sub { font-weight: 500; font-size: ${bg ? k(40) : SQ ? 28 : 34}px; line-height: 1.4; opacity: .9; margin-top: ${bg ? k(22) : 12}px; }
  .credit { font-family: "Hind Siliguri", sans-serif; font-size: 20px; letter-spacing: 0; opacity: .8; max-width: 640px; line-height: 1.3; }
  .where { margin-top: ${bg ? k(22) : 12}px; font-size: ${bg ? k(36) : SQ ? 26 : 32}px; font-weight: 700; }
  .foot { margin-top: ${bg ? `${k(44)}px` : "auto"}; padding-top: ${SQ ? 18 : 26}px; border-top: 2px solid ${b.text}33; display: flex; justify-content: space-between; gap: 24px; align-items: center;
    font-family: "Space Grotesk", sans-serif; font-size: 28px; opacity: .8; letter-spacing: 1px; }
</style></head><body>
  <div class="photo"></div><div class="shade"></div>
  <div class="top"><span class="dot"></span>${esc(b.name)}</div>
  <div class="wrap">
    <div class="row"><span class="kicker">${esc(o.brief.kicker)}</span>${date ? `<span class="date">${esc(date.big)} ${esc(date.small)}</span>` : ""}</div>
    <h1>${esc(o.headline)}</h1>
    <div class="sub">${esc(o.subline)}</div>
    ${where ? `<div class="where">📍 ${esc(where)}</div>` : ""}
    <div class="foot"><span class="credit">${o.credit ? esc(o.credit) : ""}</span><span>${esc(b.handle)}</span></div>
  </div>
</body></html>`;
}

/** Renders the post to PNG with Playwright. Returns the PNG path, or the HTML path if no browser is available. */
export async function renderPost(id: string, html: string): Promise<string> {
  // Instagram downloads the image from a public URL, so the file name carries an unguessable token.
  id = `${id}-${randomToken()}`;
  const dir = OUTPUT_DIR;
  mkdirSync(dir, { recursive: true });
  const htmlPath = resolve(dir, `${id}.html`);
  writeFileSync(htmlPath, html);
  const pngPath = resolve(dir, `${id}.png`);
  try {
    const { chromium } = await import("playwright");
    const exe = process.env.CHROMIUM_PATH;
    const browser = await chromium.launch(exe ? { executablePath: exe } : {});
    const page = await browser.newPage({ viewport: { width: POST_W, height: POST_H } });
    await page.setContent(html, { waitUntil: "networkidle", timeout: 30_000 });
    await page.evaluate(() => (document as any).fonts.ready);
    await page.screenshot({ path: pngPath, type: "png" });
    await browser.close();
    return pngPath;
  } catch (e: any) {
    console.warn(`Could not render PNG (${e.message}); kept HTML at ${htmlPath}`);
    return htmlPath;
  }
}
