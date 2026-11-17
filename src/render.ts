import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, team } from "./config.js";
import { randomToken } from "./store.js";
import type { DesignBrief } from "./agents.js";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Builds the 1080x1350 Instagram portrait post as HTML. Edit this to change your visual style. */
export function postHtml(o: { headline: string; subline: string; source: string; brief: DesignBrief }): string {
  const b = team.brand;
  const big = o.brief.layout === "bold";
  const headlineSize = o.headline.length > 60 ? 76 : o.headline.length > 40 ? 88 : big ? 108 : 96;
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@500;700&family=Space+Grotesk:wght@500;700&display=block" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 1080px; height: 1350px; background: ${b.background}; color: ${b.text};
    font-family: "Space Grotesk", "Hind Siliguri", sans-serif; overflow: hidden; position: relative; }
  .grid { position: absolute; inset: 0; opacity: .07;
    background-image: linear-gradient(${b.text} 1px, transparent 1px), linear-gradient(90deg, ${b.text} 1px, transparent 1px);
    background-size: 54px 54px; }
  .glow { position: absolute; width: 900px; height: 900px; border-radius: 50%; right: -380px; top: -320px;
    background: radial-gradient(circle, ${b.accent}55, transparent 65%); }
  .wrap { position: absolute; inset: 90px; display: flex; flex-direction: column; }
  .top { display: flex; align-items: center; gap: 18px; font-size: 30px; letter-spacing: 6px; text-transform: uppercase; }
  .dot { width: 18px; height: 18px; border-radius: 50%; background: ${b.accent}; }
  .kicker { margin-top: auto; align-self: flex-start; background: ${b.accent}; color: #fff; font-weight: 700;
    font-size: 34px; padding: 10px 26px; border-radius: 12px; letter-spacing: 2px; }
  .emoji { position: absolute; right: 90px; top: 170px; font-size: ${big ? 150 : 110}px; }
  h1 { font-family: "Hind Siliguri", "Space Grotesk", sans-serif; font-weight: 700; font-size: ${headlineSize}px;
    line-height: 1.18; margin-top: 34px; }
  .sub { font-family: "Hind Siliguri", sans-serif; font-weight: 500; font-size: 42px; line-height: 1.45; opacity: .82;
    margin-top: 34px; ${o.brief.layout === "split" ? `border-left: 8px solid ${b.accent}; padding-left: 28px;` : ""} }
  .foot { margin-top: 64px; padding-top: 30px; border-top: 2px solid ${b.text}33; display: flex; justify-content: space-between;
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

/** Renders the post to PNG with Playwright. Returns the PNG path, or the HTML path if no browser is available. */
export async function renderPost(id: string, html: string): Promise<string> {
  // Instagram downloads the image from a public URL, so the file name carries an unguessable token.
  id = `${id}-${randomToken()}`;
  const dir = resolve(ROOT, "output");
  mkdirSync(dir, { recursive: true });
  const htmlPath = resolve(dir, `${id}.html`);
  writeFileSync(htmlPath, html);
  const pngPath = resolve(dir, `${id}.png`);
  try {
    const { chromium } = await import("playwright");
    const exe = process.env.CHROMIUM_PATH;
    const browser = await chromium.launch(exe ? { executablePath: exe } : {});
    const page = await browser.newPage({ viewport: { width: 1080, height: 1350 } });
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
