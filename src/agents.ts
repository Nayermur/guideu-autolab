import { team, type AgentKey } from "./config.js";
import { generateJson } from "./llm.js";
import type { FeedItem } from "./sources.js";

/** Shared persona header so every agent knows who it is and which team it works for. */
function persona(key: AgentKey, extra: string) {
  const a = team.agents[key];
  return [
    `You are ${a.name}, the ${a.role}, on "${team.teamName}", an AI content team that runs the Instagram page "${team.brand.name}" (${team.brand.handle}).`,
    `Niche: ${team.niche}.`,
    `Audience: ${team.audience}.`,
    `Brand voice: ${team.voice}`,
    `Nothing is published without the human owner's approval, so be honest about doubts instead of hiding them.`,
    extra,
  ].join("\n");
}

// ---------- Scout ----------
export interface Pick {
  index: number;
  angle: string;
  why: string;
}

export async function scout(items: FeedItem[], recentHeadlines: string[], count: number): Promise<Pick[]> {
  const list = items
    .slice(0, 60)
    .map((it, i) => `${i}. [${it.feed}] ${it.title}\n   ${it.summary.slice(0, 200)}`)
    .join("\n");
  const res = await generateJson<{ picks: Pick[] }>({
    system: persona(
      "scout",
      "Your job: pick the stories most worth a post today. Prefer stories that are new, important or useful for this audience (public notices, prices, weather, exams, transport, health, major national and world events). If two feeds cover the same event, pick it once. Avoid recently covered topics, rumors, unconfirmed claims, celebrity gossip, deals/ads, pure opinion pieces and stories whose main content is graphic violence.",
    ),
    prompt: `Recently covered (do not repeat these topics):\n${recentHeadlines.join("\n") || "(none)"}\n\nToday's headlines:\n${list}\n\nPick up to ${count} stories. Return JSON: {"picks":[{"index":<number from the list>,"angle":"<the one-sentence angle for our post>","why":"<why this audience will care>"}]}`,
    temperature: 0.4,
  });
  const raw: any[] = Array.isArray(res) ? res : res.picks ?? [];
  const picks = raw
    .map((p) => ({ ...p, index: Number(p.index) }))
    .filter((p) => Number.isInteger(p.index) && items[p.index]);
  if (raw.length && !picks.length) console.warn(`Scout returned unusable picks: ${JSON.stringify(res).slice(0, 300)}`);
  return [...new Map(picks.map((p) => [p.index, p])).values()].slice(0, count);
}

// ---------- Verifier ----------
export interface Verification {
  verdict: "pass" | "fail";
  facts: string[];
  concerns: string;
}

export async function verify(item: FeedItem, articleText: string): Promise<Verification> {
  const source = articleText.length > 300 ? articleText : `${item.summary}\n(Only the feed summary was available.)`;
  return generateJson<Verification>({
    system: persona(
      "verifier",
      "Your job: extract only facts that the source text actually states. Never add outside knowledge, numbers or quotes that are not in the text. Fail the story if the source is too thin to write an accurate post, if it is clearly an ad, or if the headline is not supported by the text.",
    ),
    prompt: `Headline: ${item.title}\nPublisher feed: ${item.feed}\nLink: ${item.link}\n\nSource text:\n"""${source}"""\n\nReturn JSON: {"verdict":"pass"|"fail","facts":["<short fact stated in the source>", "..."],"concerns":"<anything uncertain, or empty string>"}. Give 3 to 6 facts when passing.`,
    temperature: 0.1,
  });
}

// ---------- Writer ----------
export interface Copy {
  headline: string;
  subline: string;
  caption: string;
  hashtags: string[];
}

export async function write(item: FeedItem, angle: string, facts: string[], feedback?: string, previous?: Copy): Promise<Copy> {
  const revision = feedback
    ? `\n\nThis is a REVISION. Your previous version:\n${JSON.stringify(previous)}\n\nCritic feedback you must fix:\n${feedback}`
    : "";
  return generateJson<Copy>({
    system: persona(
      "writer",
      `Your job: write an Instagram post in ${team.language}. Use ONLY the verified facts given to you; never invent numbers, names, dates or quotes. Keep English product/company names as they are.`,
    ),
    prompt: `Story: ${item.title}\nAngle: ${angle}\nVerified facts:\n- ${facts.join("\n- ")}\nSource: ${item.feed}${revision}\n\nReturn JSON:\n{"headline":"<image headline, max 9 words, strong hook>","subline":"<one supporting line for the image, max 16 words>","caption":"<Instagram caption: hook line, 2-4 short paragraphs covering what happened, who/where/when, and why it matters to ordinary people. End with what happens next, or a neutral question to invite comments (no question for deaths, disasters or tragedies). Attribute claims and mention the source name. Max 1200 characters. No hashtags here.>","hashtags":["#tag", "... 4 to 8 relevant tags; no years, numbers or names unless they appear in the verified facts"]}`,
    temperature: 0.8,
  });
}

// ---------- Critic ----------
export interface Review {
  score: number;
  approve: boolean;
  feedback: string;
}

export async function critique(item: FeedItem, facts: string[], copy: Copy): Promise<Review> {
  return generateJson<Review>({
    system: persona(
      "critic",
      `Your job: review the Writer's post before it goes to the owner. Be strict but fair. Check: (1) every claim is supported by the verified facts, (2) the headline hooks without clickbait, (3) natural, correct ${team.language}, (4) the caption explains why it matters, (5) neutral and respectful: no political bias, no sensationalism, no graphic details, claims attributed to their source, (6) length limits (headline <= 9 words, subline <= 16 words), (7) spelling: no typos, repeated words or broken words anywhere. Score 1-10. Approve only if score >= ${team.minCriticScore}, there are no factual problems AND no spelling mistakes; any typo means approve=false with the exact fix in feedback.`,
    ),
    prompt: `Story: ${item.title}\nVerified facts:\n- ${facts.join("\n- ")}\n\nPost to review:\n${JSON.stringify(copy, null, 2)}\n\nReturn JSON: {"score":<1-10>,"approve":<true|false>,"feedback":"<specific, actionable changes; empty if perfect>"}`,
    temperature: 0.2,
  });
}

// ---------- Designer ----------
export interface DesignBrief {
  kicker: string;
  emoji: string;
  layout: "bold" | "split" | "minimal";
}

export async function designBrief(copy: Copy, angle: string): Promise<DesignBrief> {
  const res = await generateJson<DesignBrief>({
    system: persona(
      "designer",
      "Your job: choose how the post image should look. Pick a short kicker label (1-2 words in the post language, e.g. জাতীয়, আন্তর্জাতিক, আপডেট, জরুরি, অর্থনীতি, আবহাওয়া), one emoji that fits the story, and a layout: bold (big headline, high energy), split (headline plus clear supporting line) or minimal (calm, serious topics).",
    ),
    prompt: `Headline: ${copy.headline}\nSubline: ${copy.subline}\nAngle: ${angle}\n\nReturn JSON: {"kicker":"...","emoji":"...","layout":"bold"|"split"|"minimal"}`,
    temperature: 0.6,
  });
  if (!["bold", "split", "minimal"].includes(res.layout)) res.layout = "bold";
  return res;
}
