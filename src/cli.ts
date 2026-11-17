import { team, env, enabledNiches } from "./config.js";
import { generate } from "./llm.js";
import { runCycle, decide, syncApprovals, retry } from "./pipeline.js";
import { instagramEnabled, publishApproved } from "./instagram.js";
import { loadState } from "./store.js";
import { processTelegramUpdates, testTelegram } from "./telegram.js";
import { fetchSource } from "./sources.js";

const [cmd = "help", arg] = process.argv.slice(2);

async function main() {
  switch (cmd) {
    case "run": {
      const drafts = await runCycle();
      console.log(`\n${drafts.length} draft(s) waiting for approval. See: npm run list`);
      break;
    }
    case "status": {
      const s = loadState();
      console.log(`Team ${team.teamName}  ·  last run: ${s.lastRunAt ?? "never"}  ·  AI: Gemini\n`);
      for (const [key, a] of Object.entries(team.agents)) {
        const st = s.agents[key];
        console.log(`${a.name.padEnd(8)} ${(st?.status ?? "idle").padEnd(8)} ${st?.activity ?? ""}`);
      }
      console.log("\nRecent log:");
      s.logs.slice(-12).forEach((l) => console.log(`  ${l.at.slice(5, 16).replace("T", " ")}  ${l.agent.padEnd(8)} ${l.message}`));
      break;
    }
    case "list": {
      const s = loadState();
      const filter = arg ?? "pending";
      const drafts = s.drafts.filter((d) => filter === "all" || d.status === filter);
      if (!drafts.length) console.log(`No ${filter} drafts.`);
      for (const d of drafts) {
        console.log(`\n━━ ${d.id}  [${d.status}]  critic ${d.critic.score}/10  ·  ${d.imagePath ?? "no image"}`);
        console.log(`Source: ${d.source.title} (${d.source.link})`);
        console.log(`Headline: ${d.headline}\nSubline: ${d.subline}\n\n${d.caption}\n\n${d.hashtags.join(" ")}`);
      }
      break;
    }
    case "approve":
    case "reject":
    case "published": {
      if (!arg) throw new Error(`Usage: npm run ${cmd} -- <draft-id>`);
      const d = decide(arg, cmd === "approve" ? "approved" : cmd === "reject" ? "rejected" : "published");
      console.log(`${d.id} → ${d.status}`);
      break;
    }
    case "telegram": {
      await processTelegramUpdates(loadState());
      console.log("Telegram approvals synced.");
      break;
    }
    case "test-telegram": {
      console.log(await testTelegram());
      break;
    }
    case "sync": {
      await syncApprovals();
      console.log(`Approvals synced. Instagram publishing: ${instagramEnabled() ? "on" : "off (IG_USER_ID / IG_ACCESS_TOKEN not set)"}`);
      break;
    }
    case "publish": {
      if (!instagramEnabled()) throw new Error("Instagram is not configured: set IG_USER_ID and IG_ACCESS_TOKEN (and autoPublish in team.json)");
      const state = loadState();
      const n = await publishApproved(state);
      console.log(`${n} post(s) published.`);
      break;
    }
    case "retry": {
      if (!arg) throw new Error("Usage: npm run retry -- <draft-id>");
      console.log(`${retry(arg).id} → queued for publishing`);
      break;
    }
    case "check-feeds": {
      // Tests every source of every niche (or only NICHE), so broken sources are easy to spot.
      for (const n of team.niches.filter((x) => !env.niche || x.id === env.niche)) {
        console.log(`\n== ${n.name} (${n.id})${n.enabled ? "" : " [disabled]"}`);
        for (const src of n.sources) {
          try {
            const items = await fetchSource(src, new Set());
            const e = items[0];
            const sample = e ? `, e.g. "${e.title.slice(0, 70)}"${e.event ? ` on ${e.event.start} at ${e.event.venue ?? "?"}` : ""}` : "";
            console.log(`${items.length ? "OK  " : "FAIL"} ${src.name} [${src.type}]: ${items.length} items${sample}`);
          } catch (err: any) {
            console.log(`FAIL ${src.name} [${src.type}]: ${err.message}`);
          }
        }
      }
      break;
    }
    case "niches": {
      const s = loadState();
      const list = enabledNiches();
      const next = env.niche || list[(s.nicheCursor ?? 0) % Math.max(list.length, 1)]?.id;
      for (const n of team.niches) {
        console.log(`${n.enabled ? "✓" : " "} ${n.id.padEnd(8)} ${n.name.padEnd(18)} ${n.format.padEnd(9)} ${n.postsPerRun}/shift${n.id === next ? "   ← next shift" : ""}`);
      }
      break;
    }
    case "test-llm": {
      const out = await generate({ system: "You are a helpful assistant.", prompt: `Say hello in ${team.language} in one short sentence.` });
      console.log(`[gemini] ${out}`);
      break;
    }
    default:
      console.log(`AutoLab commands:
  npm run run                    run one shift of the team
  npm run status                 show what each agent is doing
  npm run list [-- all|approved] show drafts (default: pending)
  npm run approve -- <id>        approve a draft
  npm run reject -- <id>         reject a draft
  npm run telegram               sync Telegram button presses
  npm run test-telegram          send a test message to check the Telegram setup
  npm run sync                   sync Telegram + publish approved posts to Instagram
  npm run publish                publish approved posts to Instagram now
  npm run retry -- <id>          try publishing a failed post again
  npm run check-feeds            test every source of every niche (NICHE=id for one)
  npm run niches                 list niches and which one runs next
  NICHE=events npm run run       run a shift for one specific niche
  npm run test:llm               check the AI key works`);
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
