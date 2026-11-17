import type { FeedItem } from "../sources.js";

/**
 * Upcoming Dhaka events from localoy.app.
 * Only basic event facts are used (title, dates, venue, organizer, tags, link) and every post
 * credits Localoy. The page is read once per shift, never their images.
 */

const BASE = "https://localoy.app";
const UA = "Mozilla/5.0 (compatible; AutoLabBot/0.1; +https://github.com/Nayermur/guideu-autolab)";

interface LocaloyItem {
  title?: string;
  experience_item_id?: string;
  partner_name?: string;
  tags?: string[];
  event_date?: { start_date?: string; end_date?: string; day_duration?: number };
  venue?: { venue_name?: string; area?: string; zone?: string; city?: string; full_address?: string; google_map_link?: string };
}

/** Next.js streams page data as JSON strings inside self.__next_f.push([1,"..."]) calls. */
function flightData(html: string): string {
  const chunks = html.match(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g) ?? [];
  return chunks
    .map((c) => {
      const raw = c.slice(c.indexOf('"'), c.lastIndexOf('"') + 1);
      try {
        return JSON.parse(raw) as string;
      } catch {
        return "";
      }
    })
    .join("");
}

/** Returns every JSON object in `s` that contains `"key":`. */
function objectsWith(s: string, key: string): any[] {
  const out: any[] = [];
  const needle = `"${key}":`;
  for (let i = s.indexOf(needle); i !== -1; i = s.indexOf(needle, i + 1)) {
    let depth = 0;
    let j = i;
    for (; j > 0; j--) {
      if (s[j] === "}") depth++;
      else if (s[j] === "{") {
        if (depth === 0) break;
        depth--;
      }
    }
    depth = 0;
    for (let k = j; k < s.length; k++) {
      if (s[k] === "{") depth++;
      else if (s[k] === "}" && --depth === 0) {
        try {
          out.push(JSON.parse(s.slice(j, k + 1)));
        } catch {
          /* not a clean object */
        }
        break;
      }
    }
  }
  return out;
}

export function parseLocaloy(html: string): LocaloyItem[] {
  const byId = new Map<string, LocaloyItem>();
  for (const o of objectsWith(flightData(html), "event_date")) {
    if (o?.title && o?.event_date?.start_date) byId.set(o.experience_item_id ?? o.title, o);
  }
  return [...byId.values()];
}

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" }); // YYYY-MM-DD

export async function fetchLocaloyEvents(opts: { daysAhead?: number; tags?: string[] }): Promise<FeedItem[]> {
  const res = await fetch(`${BASE}/discover`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items = parseLocaloy(await res.text());
  const from = today();
  const until = new Date(Date.now() + (opts.daysAhead ?? 14) * 86400_000).toISOString().slice(0, 10);
  const wanted = opts.tags?.map((t) => t.toLowerCase());

  return items
    .filter((e) => {
      const start = e.event_date!.start_date!;
      const end = e.event_date!.end_date ?? start;
      if (end < from || start > until) return false; // already over, or too far away
      if (wanted && !e.tags?.some((t) => wanted.some((w) => t.toLowerCase().includes(w)))) return false;
      return true;
    })
    .map((e) => {
      const v = e.venue ?? {};
      const area = [v.area, v.city].filter(Boolean).join(", ");
      const when = e.event_date!.end_date && e.event_date!.end_date !== e.event_date!.start_date
        ? `${e.event_date!.start_date} to ${e.event_date!.end_date}`
        : e.event_date!.start_date!;
      const facts = [
        `Event: ${e.title}`,
        `Date: ${when}`,
        v.venue_name && `Venue: ${v.venue_name}`,
        area && `Area: ${area}`,
        v.full_address && `Address: ${v.full_address}`,
        e.partner_name && `Organizer: ${e.partner_name}`,
        e.tags?.length && `Tags: ${e.tags.join(", ")}`,
      ].filter(Boolean).join("\n");
      return {
        title: e.title!,
        link: `${BASE}/details/${e.experience_item_id}`,
        summary: facts,
        feed: "Localoy",
        event: {
          start: e.event_date!.start_date!,
          end: e.event_date!.end_date,
          venue: v.venue_name,
          area,
          address: v.full_address,
          mapUrl: v.google_map_link,
          organizer: e.partner_name,
          tags: e.tags,
        },
      } satisfies FeedItem;
    })
    .sort((a, b) => a.event!.start.localeCompare(b.event!.start));
}
