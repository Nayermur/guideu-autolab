import { team } from "./config.js";
import { scout, verify, write, critique, designBrief, type Copy } from "./agents.js";
import { fetchAllFeeds, fetchArticleText } from "./sources.js";
import { postHtml, renderPost } from "./render.js";
import { loadState, saveState, log, setAgent, newId, type Draft, type State } from "./store.js";
import { sendDraft, notify, processTelegramUpdates, resendUnsent } from "./telegram.js";
import { publishApproved } from "./instagram.js";

const A = team.agents;

/** One full shift of the team: Scout → Verifier → Writer ⇄ Critic → Designer → owner's approval queue. */
export async function runCycle(): Promise<Draft[]> {
  const state = loadState();
  log(state, "system", `${team.teamName} shift started`);

  await syncApprovals(state);

  const created: Draft[] = [];
  try {
    // ---- Scout ----
    setAgent(state, "scout", "working", "Reading news feeds");
    const { items, errors } = await fetchAllFeeds();
    errors.forEach((e) => log(state, "scout", `Feed error: ${e}`));
    const fresh = items.filter((i) => !state.seenLinks.includes(i.link));
    log(state, "scout", `${A.scout.name} found ${items.length} stories, ${fresh.length} new`);
    if (!fresh.length) {
      setAgent(state, "scout", "idle", "Nothing new");
      return created;
    }
    const recent = state.drafts.slice(-20).map((d) => d.source.title);
    setAgent(state, "scout", "working", `Choosing from ${fresh.length} stories`);
    const picks = await scout(fresh, recent, team.postsPerRun);
    fresh.forEach((i) => state.seenLinks.push(i.link)); // don't re-read the same headlines next run
    log(state, "scout", `${A.scout.name} picked ${picks.length}: ${picks.map((p) => fresh[p.index].title).join(" | ")}`);
    setAgent(state, "scout", "idle", `Picked ${picks.length} stories`);

    for (const pick of picks) {
      const item = fresh[pick.index];
      try {
        // ---- Verifier ----
        setAgent(state, "verifier", "working", `Checking: ${item.title}`);
        const article = await fetchArticleText(item.link);
        const v = await verify(item, article);
        setAgent(state, "verifier", "idle", `${v.verdict}: ${item.title}`);
        if (v.verdict !== "pass" || !v.facts?.length) {
          log(state, "verifier", `${A.verifier.name} rejected "${item.title}": ${v.concerns}`);
          continue;
        }
        log(state, "verifier", `${A.verifier.name} verified ${v.facts.length} facts`);

        // ---- Writer ⇄ Critic loop ----
        setAgent(state, "writer", "working", `Writing: ${item.title}`);
        let copy: Copy = await write(item, pick.angle, v.facts);
        setAgent(state, "writer", "idle", "Draft ready");
        let review = { score: 0, approve: false, feedback: "" };
        let revisions = 0;
        while (true) {
          setAgent(state, "critic", "working", `Reviewing: ${copy.headline}`);
          review = await critique(item, v.facts, copy);
          log(state, "critic", `${A.critic.name} scored ${review.score}/10${review.feedback ? `: ${review.feedback}` : ""}`);
          setAgent(state, "critic", "idle", `Scored ${review.score}/10`);
          if ((review.approve && review.score >= team.minCriticScore) || revisions >= team.maxRevisions) break;
          revisions++;
          setAgent(state, "writer", "working", `Revision ${revisions}: ${copy.headline}`);
          copy = await write(item, pick.angle, v.facts, review.feedback, copy);
          setAgent(state, "writer", "idle", `Revision ${revisions} ready`);
        }
        if (review.score < team.minCriticScore) {
          log(state, "critic", `${A.critic.name} blocked "${copy.headline}" after ${revisions} revisions`);
          continue;
        }

        // ---- Designer ----
        setAgent(state, "designer", "working", `Designing: ${copy.headline}`);
        const brief = await designBrief(copy, pick.angle);
        const id = newId();
        const imagePath = await renderPost(id, postHtml({ headline: copy.headline, subline: copy.subline, source: item.feed, brief }));
        setAgent(state, "designer", "idle", `Designed ${id}`);
        log(state, "designer", `${A.designer.name} designed ${id} (${brief.layout})`);

        const hashtags = [...new Set([...(copy.hashtags ?? []), ...team.baseHashtags])].slice(0, 10);
        const draft: Draft = {
          id,
          createdAt: new Date().toISOString(),
          status: "pending",
          source: { title: item.title, link: item.link, feed: item.feed, published: item.published },
          angle: pick.angle,
          facts: v.facts,
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
        created.push(draft);
        saveState(state);
        log(state, "system", `Draft ${id} is waiting for your approval`);
      } catch (e: any) {
        log(state, "system", `Story "${item.title}" failed, will retry next shift: ${e.message}`);
        state.seenLinks = state.seenLinks.filter((l) => l !== item.link);
        for (const k of ["verifier", "writer", "critic", "designer"] as const) {
          if (state.agents[k]?.status === "working") setAgent(state, k, "error", e.message.slice(0, 120));
        }
      }
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
