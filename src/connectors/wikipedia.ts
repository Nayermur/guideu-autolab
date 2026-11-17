import type { FeedItem } from "../sources.js";

/**
 * Wikipedia content via the official REST API (free, no key). Text is CC BY-SA,
 * so every post credits Wikipedia.
 */

const UA = "AutoLabBot/0.1 (https://github.com/Nayermur/guideu-autolab)";
const API = "https://en.wikipedia.org/api/rest_v1";

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function pageToItem(p: any, title = p.title, extra = ""): FeedItem | null {
  const extract: string = p.extract ?? "";
  if (extract.length < 120) return null; // too thin to write an accurate post
  return {
    title,
    link: p.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title)}`,
    summary: extract.slice(0, 600),
    feed: "Wikipedia",
    sourceText: `${extra}${extract}`,
    topicKey: `wiki:${p.title}`,
  };
}

/** Article summaries for a handful of not-yet-used topics from the list. */
export async function fetchWikipediaTopics(topics: string[], used: Set<string>, count = 6): Promise<FeedItem[]> {
  const fresh = topics.filter((t) => !used.has(`wiki:${t}`) && !used.has(`wiki:${t.replace(/ /g, "_")}`));
  const pool = (fresh.length ? fresh : topics).slice().sort(() => Math.random() - 0.5).slice(0, count);
  const items = await Promise.all(
    pool.map(async (t) => {
      try {
        const p = await getJson(`${API}/page/summary/${encodeURIComponent(t.replace(/ /g, "_"))}`);
        const item = pageToItem(p);
        if (item) item.topicKey = `wiki:${t}`;
        return item;
      } catch {
        return null;
      }
    }),
  );
  return items.filter((x): x is FeedItem => x !== null);
}

/** "On this day" selected events for today's date (Bangladesh time). */
export async function fetchOnThisDay(): Promise<FeedItem[]> {
  const [, mm, dd] = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" }).split("-");
  const data = await getJson(`${API}/feed/onthisday/selected/${mm}/${dd}`);
  const out: FeedItem[] = [];
  for (const ev of data.selected ?? []) {
    const page = ev.pages?.[0];
    if (!page) continue;
    const item = pageToItem(page, `${ev.year}: ${ev.text}`, `On this day (${dd}/${mm}) in ${ev.year}: ${ev.text}\n\nAbout ${page.title}: `);
    if (item) {
      item.topicKey = `onthisday:${ev.year}:${page.title}`;
      out.push(item);
    }
  }
  return out;
}
