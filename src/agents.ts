import { team, type AgentKey, type Niche } from "./config.js";
import { generateJson } from "./llm.js";
import type { FeedItem } from "./sources.js";

/** Shared persona header so every agent knows who it is, which page and which niche it works on. */
function persona(key: AgentKey, niche: Niche, extra: string) {
  const a = team.agents[key];
  return [
    `You are ${a.name}, the ${a.role}, on "${team.teamName}", an AI content team that runs the Instagram page "${team.brand.name}" (${team.brand.handle}).`,
    `Today's niche: ${niche.name}: ${niche.topic}.`,
    `Audience: ${niche.audience}.`,
    `Voice: ${niche.voice}`,
    `Nothing is published without the human owner's approval, so be honest about doubts instead of hiding them.`,
    extra,
  ].join("\n");
}

/** What a good post looks like for each format. */
const SCOUT_RULES: Record<Niche["format"], string> = {
  news: "Pick the stories most worth a post today: new, important or genuinely useful for this audience. If two feeds cover the same story, pick it once. Avoid recently covered topics, unconfirmed claims presented as fact, gossip, deals/ads, pure opinion pieces and graphic violence.",
  event: "Pick the events this audience would most want to go to. Prefer events that are soon, open to the public and clearly described. Avoid near-duplicates (the same organizer or series) and anything that looks private or like a pure sales promotion.",
  explainer: "Pick the topics that make the most fascinating, save-worthy post for this audience. Prefer topics with rich, specific facts in the summary. Avoid topics too close to recently covered ones.",
};

const CAPTION_RULES: Record<Niche["format"], string> = {
  news: "hook line, 2-4 short paragraphs covering what happened, who/where/when, and why it matters. End with what happens next, or a neutral question to invite comments (no question for deaths, disasters or tragedies). Attribute claims and mention the source name.",
  event: "hook line saying what the event is, then the exact date, venue and area on their own short lines (use 📅 📍 emoji), then 1-2 sentences on why it's worth going. Mention the organizer if given. Never invent the time, ticket price or registration details: if they are not in the facts, tell readers to check the organizer's page for details. Do not mention the website the listing came from. End with a question like who you'd go with.",
  explainer: "hook line with a surprising fact, then 2-4 short paragraphs telling the story (what it is, where it comes from, what makes it special). End with a question to invite comments. Mention the source name.",
};

// ---------- Scout ----------
export interface Pick {
  index: number;
  angle: string;
  why: string;
}

export async function scout(niche: Niche, items: FeedItem[], recentHeadlines: string[], count: number, insist = false): Promise<Pick[]> {
  const list = items
    .slice(0, 60)
    .map((it, i) => `${i}. [${it.feed}] ${it.title}\n   ${it.summary.replace(/\n/g, " · ").slice(0, 220)}`)
    .join("\n");
  const res = await generateJson<{ picks: Pick[] }>({
    system: persona("scout", niche, `Your job: ${SCOUT_RULES[niche.format]}`),
    prompt: `Recently covered (do not repeat these topics):\n${recentHeadlines.join("\n") || "(none)"}\n\nCandidates:\n${list}\n\n${insist ? `You MUST pick exactly ${Math.min(count, items.length)}: choose the best available even if none is perfect. Never return an empty list.` : `Pick up to ${count}.`} Return JSON: {"picks":[{"index":<number from the list>,"angle":"<the one-sentence angle for our post>","why":"<why this audience will care>"}]}`,
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

export async function verify(niche: Niche, item: FeedItem, articleText: string): Promise<Verification> {
  // Event listings carry their key facts in the summary; add the detail page text when we have it.
  const source = item.event
    ? `${item.summary}\n\nEvent page text:\n${articleText || "(not available)"}`
    : item.sourceText || (articleText.length > 300 ? articleText : `${item.summary}\n(Only the feed summary was available.)`);
  return generateJson<Verification>({
    system: persona(
      "verifier",
      niche,
      "Your job: extract only facts that the source text actually states. Never add outside knowledge, numbers, dates or quotes that are not in the text. For events, always include the event name, date and venue as facts if given. Fail the item if the source is too thin to write an accurate post, if it is clearly an ad, or if the title is not supported by the text. For gaming or film news, mark rumors and leaks as such in the fact itself.",
    ),
    prompt: `Title: ${item.title}\nSource: ${item.feed}\nLink: ${item.link}\n\nSource text:\n"""${source.slice(0, 9000)}"""\n\nReturn JSON: {"verdict":"pass"|"fail","facts":["<short fact stated in the source>", "..."],"concerns":"<anything uncertain, or empty string>"}. Give 3 to 7 facts when passing.`,
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

export async function write(niche: Niche, item: FeedItem, angle: string, facts: string[], feedback?: string, previous?: Copy): Promise<Copy> {
  const revision = feedback
    ? `\n\nThis is a REVISION. Your previous version:\n${JSON.stringify(previous)}\n\nCritic feedback you must fix:\n${feedback}`
    : "";
  const headlineRule = niche.format === "event"
    ? "the event name or a short catchy version of it, max 9 words"
    : "image headline, max 9 words, strong hook";
  const sublineRule = niche.format === "event"
    ? "one line on what to expect, max 14 words (date and venue are shown separately on the poster)"
    : "one supporting line for the image, max 16 words";
  return generateJson<Copy>({
    system: persona(
      "writer",
      niche,
      `Your job: write an Instagram post in ${team.language}. Use ONLY the verified facts given to you; never invent numbers, names, dates, prices or quotes. Keep English names of events, games, films, products and companies as they are. Never mention "verified facts", the team, AI or how the post was made: write as the page speaking to its followers. A short credit naming the publication (for example "সূত্র: Wikipedia") is fine and expected where the caption rules ask for it. The headline, subline and caption MUST be in ${team.language} even when the facts are in English.`,
    ),
    prompt: `Item: ${item.title}\nAngle: ${angle}\nVerified facts:\n- ${facts.join("\n- ")}\n${niche.id === "office" ? "This is the page's own post, written from the owner's notes: do not mention any source, website or assistant." : `Source: ${item.feed}`}${revision}\n\nReturn JSON:\n{"headline":"<${headlineRule}>","subline":"<${sublineRule}>","caption":"<Instagram caption: ${CAPTION_RULES[niche.format]} Max 1200 characters. No hashtags here.>","hashtags":["#tag", "... 3 to 6 relevant tags; no years, numbers or names unless they appear in the verified facts"]}`,
    temperature: 0.8,
  });
}

// ---------- Critic ----------
export interface Review {
  score: number;
  approve: boolean;
  feedback: string;
  /** Every problem still present in the post. Any item blocks approval. */
  issues?: string[];
}

export async function critique(niche: Niche, item: FeedItem, facts: string[], copy: Copy): Promise<Review> {
  const formatCheck = {
    news: "the caption explains why it matters, claims are attributed, and rumors are clearly labelled as rumors",
    event: "the caption states the date and venue exactly as in the facts and does not invent a time, price or registration details",
    explainer: "the caption tells an interesting story and every fact, date and number appears in the verified facts",
  }[niche.format];
  const ownPost = niche.id === "office" ? " This is the page's own post from the owner's notes, so it needs no source attribution." : "";
  return generateJson<Review>({
    system: persona(
      "critic",
      niche,
      `Your job: review the Writer's post before it goes to the owner. Be strict but fair. Check: (1) every claim is supported by the verified facts, (2) the headline hooks without clickbait, (3) natural, correct ${team.language}, (4) ${formatCheck}, (5) neutral and respectful, no sensationalism, (6) length limits (headline <= 9 words, subline <= 16 words), (7) spelling: no typos, repeated words or broken words anywhere. Score 1-10. Approve only if score >= ${team.minCriticScore}, there are no factual problems AND no spelling mistakes; any typo means approve=false with the exact fix in feedback. You cannot edit the post yourself: never say something "has been fixed". List every problem that is still in the post in "issues"; if "issues" is not empty, approve must be false. Also flag any caption that mentions "verified facts", the team, AI or how the post was made. A short credit naming the publication (like "সূত্র: Wikipedia" or "সূত্র: Prothom Alo") is required attribution, not a problem.${ownPost}`,
    ),
    prompt: `Item: ${item.title}\nVerified facts:\n- ${facts.join("\n- ")}\n\nPost to review:\n${JSON.stringify(copy, null, 2)}\n\nReturn JSON: {"score":<1-10>,"approve":<true|false>,"issues":["<each problem still in the post, with the exact fix>"],"feedback":"<specific, actionable changes; empty if perfect>"}`,
    temperature: 0.2,
  });
}

// ---------- Designer ----------
export interface DesignBrief {
  kicker: string;
  emoji: string;
  layout: "bold" | "split" | "minimal" | "event" | "photo-bg" | "photo-card";
  /** Which of the owner's photos is shown (photo layouts only). */
  imageIndex?: number;
  /** How the photo is used: background, poster (main picture), reference (not shown) or none. */
  imageUse?: "background" | "poster" | "reference" | "none";
  /** When there is no owner photo: English search words for a background photo. */
  imageQuery?: string;
  /** "real" = a photo of the actual subject exists (place, dish, building); "symbolic" = use a mood photo. */
  imageKind?: "real" | "symbolic";
  /** A one-sentence scene description for an AI illustration (no text, logos or real people). */
  aiPrompt?: string;
}

export async function designBrief(
  niche: Niche,
  copy: Copy,
  angle: string,
  images: { mimeType: string; data: string }[] = [],
): Promise<DesignBrief> {
  const withImages = images.length > 0;
  const imageRule = withImages
    ? ` The owner attached ${images.length} photo(s), shown in order (index 0 first). Decide how to use them: "poster" (the photo is the main picture, text below it; best for clear photos of a product, place, person or event flyer), "background" (photo behind the text with a dark overlay; best for atmospheric photos), or "reference" (do not show it, e.g. blurry, a screenshot of text, or not suitable). Pick the best photo index.`
    : ` Also plan a background photo: "imageQuery" (2-5 English search words, e.g. "Lalbagh Fort Dhaka", "acoustic concert stage", "bakarkhani bread"), "imageKind" ("real" if a photo of the exact subject likely exists, like a famous place, dish or building; otherwise "symbolic") and "aiPrompt" (one English sentence describing a fitting scene, without text, logos, real people or copyrighted characters).`;
  const res = await generateJson<DesignBrief>({
    system: persona(
      "designer",
      niche,
      `Your job: choose how the post image should look. Pick a short kicker label (1-2 words in the post language, for example: ${niche.kickers.join(", ")}), one emoji that fits, and a layout: bold (big headline, high energy), split (headline plus clear supporting line) or minimal (calm, serious topics).${imageRule}`,
    ),
    prompt: `Headline: ${copy.headline}\nSubline: ${copy.subline}\nAngle: ${angle}\n\nReturn JSON: {"kicker":"...","emoji":"...","layout":"bold"|"split"|"minimal"${withImages ? ',"imageUse":"poster"|"background"|"reference","imageIndex":<number>' : ',"imageQuery":"...","imageKind":"real"|"symbolic","aiPrompt":"..."'}}`,
    temperature: 0.6,
    images,
  });
  const idx = Number(res.imageIndex ?? 0);
  res.imageIndex = Number.isInteger(idx) && idx >= 0 && idx < images.length ? idx : 0;
  if (withImages && res.imageUse === "poster") res.layout = "photo-card";
  else if (withImages && res.imageUse === "background") res.layout = "photo-bg";
  else if (niche.format === "event") res.layout = "event";
  else if (!["bold", "split", "minimal"].includes(res.layout)) res.layout = "bold";
  if (!withImages) res.imageUse = "none";
  return res;
}

// ---------- Automatic checks (no AI) ----------
/** Words that mix Bangla and Latin letters, e.g. "কমics": a typo the AI critic sometimes misses. */
export function mixedScriptWords(copy: Copy): string[] {
  const text = [copy.headline, copy.subline, copy.caption].join(" ");
  const words = text.match(/[\p{L}\p{M}]+/gu) ?? [];
  return [...new Set(words.filter((w) => /[\u0980-\u09FF]/.test(w) && /[A-Za-z]/.test(w)))];
}

/** Share of letters that are Bangla script (0..1), used to catch captions written in the wrong language. */
export function banglaShare(copy: Copy): number {
  const text = [copy.headline, copy.subline, copy.caption].join(" ");
  const bangla = (text.match(/[\u0980-\u09FF]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  return bangla + latin ? bangla / (bangla + latin) : 1;
}
