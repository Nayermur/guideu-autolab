import { Office, LOOKS } from "./office.js";

const $ = (s) => document.querySelector(s);
const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const bn = (n) => String(n).replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[d]);
const ORDER = ["scout", "verifier", "writer", "designer", "critic"];
const STATUS_BN = { working: "কাজ করছে", idle: "বিশ্রামে", error: "সমস্যা" };
const STALE_MS = 40 * 60 * 1000; // a "working" status older than this means the shift ended without cleanup

let team = null;
let state = null;
let tab = "missions";
try { tab = localStorage.getItem("autolab-tab") || tab; } catch {}

function ago(iso) {
  if (!iso) return "কখনো না";
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (m < 1) return "এইমাত্র";
  if (m < 60) return `${bn(m)} মিনিট আগে`;
  const h = Math.round(m / 60);
  if (h < 48) return `${bn(h)} ঘণ্টা আগে`;
  return `${bn(Math.round(h / 24))} দিন আগে`;
}
const clock = (iso) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dhaka" });
const dhakaHour = () => Number(new Date().toLocaleString("en-US", { timeZone: "Asia/Dhaka", hour: "numeric", hour12: false })) % 24;

// ---------- demo data (shown until the team has run at least once) ----------
function demoState() {
  const now = Date.now();
  const t = (min) => new Date(now - min * 60000).toISOString();
  return {
    demo: true,
    lastRunAt: t(12),
    agents: {
      scout: { status: "idle", activity: "২টি খবর বাছাই করেছে", updatedAt: t(10) },
      verifier: { status: "working", activity: "যাচাই করছে: মেট্রো রেল শুক্রবারও চলবে", updatedAt: t(1) },
      writer: { status: "working", activity: "লিখছে: এইচএসসির ফল প্রকাশ", updatedAt: t(1) },
      designer: { status: "idle", activity: "ডিজাইন শেষ", updatedAt: t(8) },
      critic: { status: "idle", activity: "স্কোর দিয়েছে ৯/১০", updatedAt: t(6) },
    },
    drafts: [
      { id: "demo-1", status: "pending", createdAt: t(9), headline: "শুক্রবারও চলবে মেট্রো রেল", subline: "১ ডিসেম্বর থেকে বিকেল ৩টা থেকে রাত ৯টা পর্যন্ত", caption: "এটি ডেমো ড্রাফট। টিম প্রথমবার চলার পর এখানে আসল ড্রাফট দেখাবে।", hashtags: ["#News", "#Dhaka"], facts: ["ডেমো তথ্য"], source: { title: "Demo", link: "#", feed: "Demo" }, critic: { score: 10, notes: "", revisions: 0 } },
      { id: "demo-2", status: "approved", createdAt: t(200), headline: "এইচএসসির ফল প্রকাশ ২০ নভেম্বর", subline: "দুপুর ২টা থেকে ওয়েবসাইট ও এসএমএসে", caption: "ডেমো ড্রাফট।", hashtags: ["#HSC"], facts: [], source: { title: "Demo", link: "#", feed: "Demo" }, critic: { score: 9, notes: "", revisions: 1 } },
    ],
    logs: [
      { at: t(12), agent: "system", message: "Pulse shift started" },
      { at: t(11), agent: "scout", message: "Rafi picked 2 stories" },
      { at: t(9), agent: "critic", message: "Arif scored 10/10" },
    ],
  };
}

// ---------- data ----------
async function load() {
  const bust = `?t=${Date.now()}`;
  if (!team) team = await fetch(`team.json${bust}`).then((r) => r.json()).catch(() => null);
  let s = await fetch(`data/state.json${bust}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!s || !s.lastRunAt) s = demoState();
  // treat leftover "working" flags from an old shift as idle
  for (const a of Object.values(s.agents ?? {})) {
    if (a.status === "working" && Date.now() - Date.parse(a.updatedAt) > STALE_MS) a.status = "idle";
  }
  state = s;
  render();
}

const nicheName = (id) => team?.niches?.find((n) => n.id === id)?.name ?? (id ? id : "News");
const agentInfo = (key) => team?.agents?.[key] ?? { name: key, role: key };

// ---------- rendering ----------
function render() {
  const fresh = state.lastRunAt && Date.now() - Date.parse(state.lastRunAt) < 9 * 3600_000;
  const anyWorking = Object.values(state.agents).some((a) => a.status === "working");
  $("#teamName").textContent = (team?.brand?.name ?? "AutoLab").toUpperCase();
  $("#officeTitle").textContent = `${(team?.teamName ?? "Pulse").toUpperCase()} HQ`;
  $("#demoBadge").hidden = !state.demo;
  $("#liveDot").classList.toggle("on", anyWorking || fresh);
  $("#liveLabel").textContent = anyWorking ? "● শিফট চলছে" : fresh ? "● LIVE" : "● অফলাইন";
  $("#liveLabel").classList.toggle("stale", !anyWorking && !fresh);
  $("#lastRun").textContent = `শেষ শিফট: ${ago(state.lastRunAt)}`;

  const drafts = state.drafts ?? [];
  const pending = drafts.filter((d) => d.status === "pending");
  const today = new Date().toISOString().slice(0, 10);
  const todayCount = drafts.filter((d) => d.createdAt?.startsWith(today)).length;
  const approved = drafts.filter((d) => d.status === "approved" || d.status === "published").length;
  const scores = drafts.map((d) => d.critic?.score).filter(Boolean);
  const avg = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : "–";
  $("#pendingCount").textContent = bn(pending.length);
  $("#stats").innerHTML = [
    [bn(pending.length), "অনুমোদনের অপেক্ষায়"],
    [bn(todayCount), "আজকের ড্রাফট"],
    [bn(approved), "অনুমোদিত"],
    [bn(avg), "গড় Critic স্কোর"],
  ].map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join("");
  $("#board").innerHTML = `TODAY<br><b>${pending.length}</b> PENDING<br><b>${todayCount}</b> DRAFTS`;

  office.setAgents(state.agents, dhakaHour());
  renderTab();
}

function draftCard(d) {
  const img = d.imagePath ? `<img src="${esc(d.imagePath)}" alt="" loading="lazy">` : `<div class="noimg"></div>`;
  return `<button class="draft" data-id="${esc(d.id)}">${img}<div>
    <h3>${esc(d.headline)}</h3>
    <div class="sub">${esc(d.subline)}</div>
    <div class="chips"><span class="chip niche">${esc(nicheName(d.niche))}</span><span class="chip ${esc(d.status)}">${esc(d.status)}</span><span class="chip score">Critic ${bn(d.critic?.score ?? "–")}/১০</span><span class="chip">${ago(d.createdAt)}</span></div>
  </div></button>`;
}

function renderTab() {
  document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
  const body = $("#tabBody");
  const drafts = [...(state.drafts ?? [])].reverse();
  if (tab === "missions") {
    const list = drafts.filter((d) => d.status === "pending");
    body.innerHTML = list.length ? list.map(draftCard).join("") : `<div class="empty">এখন কোনো ড্রাফট অপেক্ষায় নেই। পরের শিফটে নতুন খবর আসবে।</div>`;
  } else if (tab === "archive") {
    const list = drafts.filter((d) => d.status !== "pending");
    body.innerHTML = list.length ? list.map(draftCard).join("") : `<div class="empty">আর্কাইভ খালি।</div>`;
  } else if (tab === "team") {
    body.innerHTML = ORDER.map((k) => {
      const a = state.agents[k] ?? { status: "idle", activity: "" };
      const info = agentInfo(k);
      return `<div class="agent">
        <div class="avatar" style="background:${LOOKS[k].shirt}">${esc(info.name[0])}</div>
        <div><h3>${esc(info.name)}</h3><p>${esc(info.role)}</p><p>${esc(a.activity || "")}</p></div>
        <div class="state ${esc(a.status)}">${STATUS_BN[a.status] ?? a.status}<br>${a.updatedAt ? ago(a.updatedAt) : ""}</div>
      </div>`;
    }).join("");
  } else {
    const logs = [...(state.logs ?? [])].reverse().slice(0, 80);
    body.innerHTML = logs.length
      ? logs.map((l) => `<div class="log"><time>${clock(l.at)}</time><span class="who">${esc(l.agent === "system" ? "system" : agentInfo(l.agent).name)}</span><span>${esc(l.message)}</span></div>`).join("")
      : `<div class="empty">লগ খালি।</div>`;
  }
}

function openDraft(id) {
  const d = state.drafts.find((x) => x.id === id);
  if (!d) return;
  const full = `${d.caption}\n\n${(d.hashtags ?? []).join(" ")}`;
  $("#dialogBody").innerHTML = `<div class="detail">
    <div>${d.imagePath ? `<img src="${esc(d.imagePath)}" alt="${esc(d.headline)}">` : ""}</div>
    <div>
      <div class="chips"><span class="chip niche">${esc(nicheName(d.niche))}</span><span class="chip ${esc(d.status)}">${esc(d.status)}</span><span class="chip score">Critic ${bn(d.critic?.score ?? "–")}/১০</span><span class="chip">রিভিশন ${bn(d.critic?.revisions ?? 0)}</span></div>
      <h2>${esc(d.headline)}</h2>
      ${d.status === "pending" ? `<p class="hint">Approve বা Reject করতে Telegram-এ বোতাম চাপুন।</p>` : ""}
      ${d.status === "approved" ? `<p class="hint">অনুমোদিত। পরের সিঙ্কে (৩০ মিনিটের মধ্যে) Instagram-এ যাবে।${d.publish?.lastError ? ` শেষ চেষ্টায় সমস্যা: ${esc(d.publish.lastError)}` : ""}</p>` : ""}
      ${d.instagram ? `<p class="hint">📢 Instagram-এ পোস্ট হয়েছে ${ago(d.instagram.publishedAt)}${d.instagram.permalink ? `: <a href="${esc(d.instagram.permalink)}" target="_blank" rel="noopener">পোস্ট দেখুন</a>` : ""}</p>` : ""}
      ${d.status === "failed" ? `<p class="hint" style="color:var(--err)">Instagram-এ পোস্ট করা যায়নি: ${esc(d.publish?.lastError ?? "")}</p>` : ""}
      <div class="caption">${esc(full)}</div>
      <button class="copy" id="copyBtn">ক্যাপশন কপি করুন</button>
      <p class="hint">সূত্র: <a href="${esc(d.source?.link)}" target="_blank" rel="noopener">${esc(d.source?.title)}</a> (${esc(d.source?.feed)})</p>
      ${d.facts?.length ? `<p class="hint">Nila-র যাচাই করা তথ্য:</p><ul class="facts">${d.facts.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : ""}
      ${d.critic?.notes ? `<p class="hint">Arif-এর নোট: ${esc(d.critic.notes)}</p>` : ""}
    </div>
  </div>`;
  $("#copyBtn").onclick = async () => {
    try { await navigator.clipboard.writeText(full); $("#copyBtn").textContent = "কপি হয়েছে ✓"; } catch { $("#copyBtn").textContent = "কপি করা যায়নি"; }
  };
  $("#draftDialog").showModal();
}

// ---------- name tags positioned over the canvas ----------
const tagEls = {};
function layoutTags(tags, boardPos) {
  const stage = $("#stage");
  const w = stage.clientWidth, h = stage.clientHeight;
  for (const t of tags) {
    let el = tagEls[t.key];
    if (!el) {
      el = document.createElement("button");
      el.className = "tag";
      el.innerHTML = `<span class="bubble"></span><span class="name"><i></i><span></span></span>`;
      el.onclick = () => { tab = "team"; renderTab(); };
      $("#tags").appendChild(el);
      tagEls[t.key] = el;
    }
    const a = state?.agents?.[t.key] ?? { status: "idle" };
    const info = agentInfo(t.key);
    el.dataset.status = a.status;
    el.querySelector(".name span").textContent = info.name;
    el.querySelector(".bubble").textContent = a.activity || STATUS_BN[a.status];
    el.setAttribute("aria-label", `${info.name}: ${STATUS_BN[a.status] ?? a.status}. ${a.activity ?? ""}`);
    el.style.left = `${t.x * w}px`;
    el.style.top = `${t.y * h}px`;
    el.style.zIndex = String(Math.round(t.y * 1000));
  }
  const board = $("#board");
  board.style.left = `${boardPos[0] * w}px`;
  board.style.top = `${boardPos[1] * h}px`;
}

// ---------- wiring ----------
const office = new Office($("#office"), layoutTags);
document.querySelector(".tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]");
  if (!b) return;
  tab = b.dataset.tab;
  try { localStorage.setItem("autolab-tab", tab); } catch {}
  renderTab();
});
$("#tabBody").addEventListener("click", (e) => {
  const card = e.target.closest(".draft");
  if (card) openDraft(card.dataset.id);
});
load();
setInterval(load, 60_000);
