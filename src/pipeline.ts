import { team, env, enabledNiches, findNiche, type Niche } from "./config.js";
import { scout, verify, write, critique, designBrief, mixedScriptWords, banglaShare, type Copy, type Review } from "./agents.js";
import { fetchNicheItems, fetchArticleText, fetchMetaDescription, type FeedItem } from "./sources.js";
import { listInbox, saveInbox, readInboxImage, officeNiche, loadBots, findBot, botNiche } from "./workspace.js";
import { postHtml, renderPost } from "./render.js";
import { loadState, saveState, log, setAgent, newId, type Draft, type State } from "./store.js";
import { sendDraft, notify, processTelegramUpdates, resendUnsent } from "./telegram.js";
import { publishApproved } from "./instagram.js";

const A = team.agents;

/** Picks the niche for this shift: the NICHE override if set, otherwise the next enabled one in rotation. */
export function pickNiche(state: State): Niche {
  if (env.niche) {
    const n = findNiche(env.niche);
    if (!n) throw new Error(`Unknown niche "${env.niche}". Available: ${team.niches.map((x) => x.id).join(", ")}`);
    return n;
  }
  const list = enabledNiches();
  if (!list.length) throw new Error("No enabled niches in team.json");
  const cursor = state.nicheCursor ?? 0;
  state.nicheCursor = (cursor + 1) % list.length;
  return list[cursor % list.length];
}

interface ProduceOptions {
  /** Facts already known to be true (the owner's own requests): skips the Verifier. */
  facts?: string[];
  /** The owner's photos, for the Designer and the renderer. */
  images?: { mimeType: string; data: string }[];
  /** Shown in logs, e.g. the bot or Pakhi. */
  by?: string;
}

/** Verifier → Writer ⇄ Critic → Designer → approval queue, for one item. Returns the draft or null if it was dropped. */
async function produce(state: State, niche: Niche, item: FeedItem, angle: string, opts: ProduceOptions = {}): Promise<Draft | null> {
  // ---- Verifier (skipped for the owner's own requests) ----
  let facts = opts.facts;
  if (!facts) {
    setAgent(state, "verifier", "working", `Checking: ${item.title}`);
    // Event pages also list other events, so only their own description is used.
    const article = item.sourceText ? "" : item.event ? await fetchMetaDescription(item.link) : await fetchArticleText(item.link);
    const v = await verify(niche, item, article);
    setAgent(state, "verifier", "idle", `${v.verdict}: ${item.title}`);
    if (v.verdict !== "pass" || !v.facts?.length) {
      log(state, "verifier", `${A.verifier.name} rejected "${item.title}": ${v.concerns}`);
      return null;
    }
    log(state, "verifier", `${A.verifier.name} verified ${v.facts.length} facts`);
    facts = v.facts;
  }

  // ---- Writer ⇄ Critic loop ----
  setAgent(state, "writer", "working", `Writing: ${item.title}`);
  let copy: Copy = await write(niche, item, angle, facts);
  setAgent(state, "writer", "idle", "Draft ready");
  let review: Review = { score: 0, approve: false, feedback: "" };
  let revisions = 0;
  while (true) {
    setAgent(state, "critic", "working", `Reviewing: ${copy.headline}`);
    review = await critique(niche, item, facts, copy);
    // The critic sometimes notes a problem but still approves: any listed issue blocks approval.
    const issues = (review.issues ?? []).filter((x) => String(x).trim());
    if (issues.length && review.approve) {
      review.approve = false;
      review.score = Math.min(review.score, team.minCriticScore - 1);
      review.feedback = `${issues.join(" ")} ${review.feedback}`.trim();
    }
    const broken = mixedScriptWords(copy);
    if (broken.length) {
      review.approve = false;
      review.score = Math.min(review.score, team.minCriticScore - 1);
      review.feedback = `Spelling: these words mix Bangla and English letters and must be fixed: ${broken.join(", ")}. ${review.feedback}`;
    }
    // English names are fine, but the text itself must be mostly Bangla.
    if (team.language.toLowerCase() === "bangla" && banglaShare(copy) < 0.5) {
      review.approve = false;
      review.score = Math.min(review.score, team.minCriticScore - 1);
      review.feedback = `Language: the post must be written in Bangla (keep only names in English). ${review.feedback}`;
    }
    log(state, "critic", `${A.critic.name} scored ${review.score}/10${review.feedback ? `: ${review.feedback}` : ""}`);
    setAgent(state, "critic", "idle", `Scored ${review.score}/10`);
    if ((review.approve && review.score >= team.minCriticScore) || revisions >= team.maxRevisions) break;
    revisions++;
    setAgent(state, "writer", "working", `Revision ${revisions}: ${copy.headline}`);
    copy = await write(niche, item, angle, facts, review.feedback, copy);
    setAgent(state, "writer", "idle", `Revision ${revisions} ready`);
  }
  if (review.score < team.minCriticScore) {
    log(state, "critic", `${A.critic.name} blocked "${copy.headline}" after ${revisions} revisions`);
    return null;
  }

  // ---- Designer ----
  setAgent(state, "designer", "working", `Designing: ${copy.headline}`);
  const images = opts.images ?? [];
  const brief = await designBrief(niche, copy, angle, images);
  const chosen = images[brief.imageIndex ?? 0];
  const photo = chosen && brief.layout.startsWith("photo") ? `data:${chosen.mimeType};base64,${chosen.data}` : undefined;
  const id = newId();
  const imagePath = await renderPost(id, postHtml({ headline: copy.headline, subline: copy.subline, source: item.feed, brief, event: item.event, photo }));
  setAgent(state, "designer", "idle", `Designed ${id}`);
  log(state, "designer", `${A.designer.name} designed ${id} (${brief.layout}${images.length ? `, photo: ${brief.imageUse}` : ""})`);

  // Instagram hashtags are case-insensitive, so #GuideUBD and #guideubd count as one.
  const hashtags = [...new Map([...(copy.hashtags ?? []), ...niche.hashtags, ...team.baseHashtags].map((t) => [t.toLowerCase(), t])).values()].slice(0, 12);
  const draft: Draft = {
    id,
    niche: niche.id,
    event: item.event,
    createdAt: new Date().toISOString(),
    status: "pending",
    source: { title: item.title, link: item.link, feed: item.feed, published: item.published },
    angle,
    facts,
    headline: copy.headline,
    subline: copy.subline,
    caption: copy.caption,
    hashtags,
    kicker: brief.kicker,
    imagePath: imagePath.replace(/^.*\/output\//, "output/"),
    critic: { score: review.score, notes: review.feedback, revisions },
  };
  draft.telegramMessageId = await sendDraft({ ...draft, imagePath }).catch((e) => {
    log(state, "system", `Telegram send failed: ${e.message}`);
    return undefined;
  });
  state.drafts.push(draft);
  saveState(state);
  log(state, "system", `Draft ${id} is waiting for your approval${opts.by ? ` (${opts.by})` : ""}`);
  return draft;
}

/** Scout → produce() for one niche (an HQ niche or a Specialised Team bot). */
async function runNiche(state: State, niche: Niche, count = niche.postsPerRun): Promise<Draft[]> {
  const created: Draft[] = [];
  const usedTopics = new Set(state.usedTopics ?? []);
  setAgent(state, "scout", "working", `Researching ${niche.name}`);
  const { items, errors } = await fetchNicheItems(niche, usedTopics);
  errors.forEach((e) => log(state, "scout", `Source error: ${e}`));
  const fresh = items.filter((i) => !state.seenLinks.includes(i.link) && !(i.topicKey && usedTopics.has(i.topicKey)));
  log(state, "scout", `${A.scout.name} found ${items.length} ${niche.name} items, ${fresh.length} new`);
  if (!fresh.length) {
    setAgent(state, "scout", "idle", `Nothing new for ${niche.name}`);
    return created;
  }
  const recent = state.drafts.filter((d) => (d.niche ?? "news") === niche.id).slice(-20).map((d) => d.source.title);
  setAgent(state, "scout", "working", `Choosing from ${fresh.length} ${niche.name} items`);
  const picks = await scout(niche, fresh, recent, count);
  // News headlines are read once. Events and evergreen topics stay available until they are used.
  if (niche.format === "news") fresh.forEach((i) => state.seenLinks.push(i.link));
  log(state, "scout", `${A.scout.name} picked ${picks.length}: ${picks.map((p) => fresh[p.index].title).join(" | ")}`);
  setAgent(state, "scout", "idle", `Picked ${picks.length} for ${niche.name}`);

  for (const pick of picks) {
    const item = fresh[pick.index];
    if (!state.seenLinks.includes(item.link)) state.seenLinks.push(item.link);
    if (item.topicKey) {
      usedTopics.add(item.topicKey);
      state.usedTopics = [...usedTopics];
    }
    try {
      const d = await produce(state, niche, item, pick.angle, { by: niche.id.startsWith("bot:") ? niche.name : undefined });
      if (d) created.push(d);
    } catch (e: any) {
      log(state, "system", `"${item.title}" failed, will retry next time: ${e.message}`);
      state.seenLinks = state.seenLinks.filter((l) => l !== item.link);
      if (item.topicKey) {
        usedTopics.delete(item.topicKey);
        state.usedTopics = [...usedTopics];
      }
      resetWorkingAgents(state, e.message);
    }
  }
  return created;
}

function resetWorkingAgents(state: State, message: string) {
  for (const k of ["scout", "verifier", "writer", "critic", "designer"] as const) {
    if (state.agents[k]?.status === "working") setAgent(state, k, "error", message.slice(0, 120));
  }
}

/** Turns the requests Pakhi organized into drafts. Sabbir (Writer) starts; the owner's facts are trusted. */
export async function runInbox(state: State = loadState()): Promise<Draft[]> {
  const created: Draft[] = [];
  for (const req of listInbox("new")) {
    log(state, "system", `Pakhi handed "${req.title}" to ${A.writer.name}`);
    try {
      const images = req.images.map(readInboxImage).filter((x): x is { mimeType: string; data: string } => x !== null);
      const item: FeedItem = { title: req.title, link: "", summary: req.details, feed: "Pakhi", event: req.event };
      const d = await produce(state, officeNiche(req.format), item, req.details, { facts: req.facts, images, by: "Pakhi" });
      req.status = d ? "done" : "failed";
      req.draftId = d?.id;
      if (!d) req.error = "The critic did not approve the post after revisions";
      if (d) created.push(d);
    } catch (e: any) {
      req.status = "failed";
      req.error = e.message;
      log(state, "system", `Pakhi's request "${req.title}" failed: ${e.message}`);
      resetWorkingAgents(state, e.message);
    }
    saveInbox(req);
    saveState(state);
  }
  return created;
}

const dhakaDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" });

/** Runs one Specialised Team bot now (from the dashboard's Run button or the shift quota). */
export async function runBot(botId: string, state: State = loadState()): Promise<Draft[]> {
  const bot = findBot(botId);
  if (!bot) throw new Error(`No bot with id ${botId}`);
  log(state, "system", `Specialised Team: ${bot.name} started`);
  const created = await runNiche(state, botNiche(bot), 1);
  log(state, "system", `Specialised Team: ${bot.name} finished with ${created.length} draft(s)`);
  saveState(state);
  return created;
}

/** One full shift: the next HQ niche, then Pakhi's inbox, then active bots that still have quota today. */
export async function runCycle(): Promise<Draft[]> {
  const state = loadState();
  const niche = pickNiche(state);
  log(state, "system", `${team.teamName} shift started: ${niche.name}`);
  await syncApprovals(state);

  const created: Draft[] = [];
  try {
    created.push(...(await runNiche(state, niche)));
    created.push(...(await runInbox(state)));
    const today = dhakaDay(new Date().toISOString());
    for (const bot of loadBots().filter((b) => b.active)) {
      const doneToday = state.drafts.filter((d) => d.niche === `bot:${bot.id}` && dhakaDay(d.createdAt) === today).length;
      if (doneToday < bot.postsPerDay) created.push(...(await runBot(bot.id, state)));
    }
  } catch (e: any) {
    log(state, "system", `Shift failed: ${e.message}`);
    await notify(`⚠️ ${team.teamName} shift failed: ${e.message}`);
    throw e;
  } finally {
    state.lastRunAt = new Date().toISOString();
    log(state, "system", `Shift finished: ${created.length} new draft(s)`);
    saveState(state);
  }
  return created;
}

/** Applies Telegram button presses, then publishes approved drafts to Instagram. */
export async function syncApprovals(state: State = loadState()) {
  await processTelegramUpdates(state).catch((e) => log(state, "system", `Telegram check failed: ${e.message}`));
  await resendUnsent(state).catch((e) => log(state, "system", `Telegram send failed: ${e.message}`));
  await publishApproved(state).catch((e) => log(state, "system", `Instagram publishing failed: ${e.message}`));
  saveState(state);
}

/** Puts a failed draft back in the publishing queue. */
export function retry(id: string) {
  const state = loadState();
  const d = state.drafts.find((x) => x.id === id);
  if (!d) throw new Error(`No draft with id ${id}`);
  d.status = "approved";
  d.publish = { attempts: 0 };
  log(state, "system", `Owner queued ${id} for publishing again`);
  saveState(state);
  return d;
}

export function decide(id: string, status: "approved" | "rejected" | "published") {
  const state: State = loadState();
  const d = state.drafts.find((x) => x.id === id);
  if (!d) throw new Error(`No draft with id ${id}`);
  d.status = status;
  d.decidedAt = new Date().toISOString();
  log(state, "system", `Owner marked ${id} as ${status}`);
  saveState(state);
  return d;
}
