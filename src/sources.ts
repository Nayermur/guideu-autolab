import { readFileSync } from "node:fs";
import { XMLParser } from "fast-xml-parser";
import { env, type Niche, type SourceConfig } from "./config.js";
import { fetchLocaloyEvents } from "./connectors/localoy.js";
import { fetchOnThisDay, fetchWikipediaTopics } from "./connectors/wikipedia.js";

export interface EventInfo {
  start: string; // YYYY-MM-DD
  end?: string;
  venue?: string;
  area?: string;
  address?: string;
  mapUrl?: string;
  organizer?: string;
  tags?: string[];
}

export interface FeedItem {
  title: string;
  link: string;
  summary: string;
  published?: string;
  feed: string;
  /** Full source text when the connector already has it (no page download needed). */
  sourceText?: string;
  /** Structured event details for event posters. */
  event?: EventInfo;
  /** Identifies an evergreen topic so it is not repeated. */
  topicKey?: string;
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@" });
const UA = "Mozilla/5.0 (compatible; AutoLabBot/0.1)";

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

const text = (v: any): string => (typeof v === "string" ? v : v?.["#text"] ?? "");

export function parseFeed(xml: string, feedName: string): FeedItem[] {
  const doc = parser.parse(xml);
  const toArray = (x: any) => (Array.isArray(x) ? x : x ? [x] : []);
  // RSS 2.0
  const rssItems = toArray(doc?.rss?.channel?.item).map((it: any) => ({
    title: stripHtml(text(it.title)),
    link: text(it.link),
    summary: stripHtml(text(it.description)).slice(0, 600),
    published: it.pubDate,
    feed: feedName,
  }));
  // Atom
  const atomItems = toArray(doc?.feed?.entry).map((it: any) => {
    const links = toArray(it.link);
    const link = links.find((l: any) => l["@rel"] === "alternate" || !l["@rel"])?.["@href"] ?? links[0]?.["@href"] ?? "";
    return {
      title: stripHtml(text(it.title)),
      link,
      summary: stripHtml(text(it.summary) || text(it.content)).slice(0, 600),
      published: it.published ?? it.updated,
      feed: feedName,
    };
  });
  return [...rssItems, ...atomItems].filter((i) => i.title && i.link);
}

async function fetchRss(src: Extract<SourceConfig, { type: "rss" }>): Promise<FeedItem[]> {
  const res = await fetch(src.url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  let items = parseFeed(await res.text(), src.name);
  if (src.filter) {
    const re = new RegExp(src.filter, "i");
    items = items.filter((i) => re.test(`${i.title} ${i.summary}`));
  }
  return items;
}

export async function fetchSource(src: SourceConfig, usedTopics: Set<string>): Promise<FeedItem[]> {
  switch (src.type) {
    case "rss":
      return fetchRss(src);
    case "localoy-events":
      return fetchLocaloyEvents({ daysAhead: src.daysAhead, tags: src.tags });
    case "wikipedia-onthisday":
      return fetchOnThisDay();
    case "wikipedia-topics":
      return fetchWikipediaTopics(src.topics, usedTopics);
  }
}

/** Gathers fresh material for one niche from all of its sources. */
export async function fetchNicheItems(niche: Niche, usedTopics = new Set<string>()): Promise<{ items: FeedItem[]; errors: string[] }> {
  if (env.sampleFeed) {
    return { items: parseFeed(readFileSync(env.sampleFeed, "utf8"), "Sample feed"), errors: [] };
  }
  const errors: string[] = [];
  const results = await Promise.all(
    niche.sources.map(async (s) => {
      try {
        return await fetchSource(s, usedTopics);
      } catch (e: any) {
        errors.push(`${s.name}: ${e.message}`);
        return [];
      }
    }),
  );
  const cutoff = Date.now() - (niche.maxAgeHours ?? 48) * 3600_000;
  const seen = new Set<string>();
  const items = results.flat().filter((i) => {
    if (niche.format === "news") {
      const t = i.published ? Date.parse(i.published) : NaN;
      if (!Number.isNaN(t) && t < cutoff) return false;
    }
    const key = i.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { items, errors };
}

/** Download the article and return readable text (best effort; falls back to the feed summary). */
export async function fetchArticleText(url: string): Promise<string> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return "";
    const html = await res.text();
    const body = html.match(/<article[\s\S]*?<\/article>/i)?.[0] ?? html;
    return stripHtml(body).slice(0, 8000);
  } catch {
    return "";
  }
}

/** The page's own description (og:description / meta description), without related-items noise. */
export async function fetchMetaDescription(url: string): Promise<string> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return "";
    const html = await res.text();
    const m =
      html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]*)"/i) ??
      html.match(/<meta[^>]+name="description"[^>]+content="([^"]*)"/i);
    return m ? stripHtml(m[1]) : "";
  } catch {
    return "";
  }
}
