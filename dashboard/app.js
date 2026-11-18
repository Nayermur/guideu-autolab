import { Office, LOOKS, botLook, makeScene } from "./office.js";

const $ = (s) => document.querySelector(s);
const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const bn = (n) => String(n).replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[d]);
const ORDER = ["scout", "verifier", "writer", "designer", "critic"];
const STATUS_BN = { working: "কাজ করছে", idle: "বিশ্রামে", error: "সমস্যা" };
const STALE_MS = 40 * 60 * 1000; // a "working" status older than this means the shift ended without cleanup
const ROOM_TITLE = { hq: "HEADQUARTER", office: "MY OFFICE ROOM", team: "SPECIALISED TEAM" };

let team = null;
let state = null;
let bots = [];
let inbox = [];
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
let tab = store.get("autolab-tab", "missions");
let room = store.get("autolab-room", "hq");
const botRunning = {}; // bot id -> time the owner pressed Run (shown as working for a few minutes)

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
      verifier: { status: "working", activity: "যাচাই করছে", updatedAt: t(1) },
      writer: { status: "working", activity: "লিখছে", updatedAt: t(1) },
      designer: { status: "idle", activity: "ডিজাইন শেষ", updatedAt: t(8) },
      critic: { status: "idle", activity: "স্কোর দিয়েছে ৯/১০", updatedAt: t(6) },
    },
    drafts: [],
    logs: [{ at: t(12), agent: "system", message: "Demo data" }],
  };
}

// ---------- data ----------
const getJson = (url) => fetch(`${url}?t=${Date.now()}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);

async function load() {
  if (!team) team = await getJson("team.json");
  let s = await getJson("data/state.json");
  if (!s || !s.lastRunAt) s = demoState();
  for (const a of Object.values(s.agents ?? {})) {
    if (a.status === "working" && Date.now() - Date.parse(a.updatedAt) > STALE_MS) a.status = "idle";
  }
  state = s;
  bots = (await getJson("data/bots.json"))?.bots ?? bots;
  inbox = (await getJson("data/inbox-index.json"))?.requests ?? inbox;
  render();
}

const nicheName = (id) => {
  if (id === "office") return "My Office";
  if (id?.startsWith("bot:")) return bots.find((b) => `bot:${b.id}` === id)?.name ?? "Bot";
  return team?.niches?.find((n) => n.id === id)?.name ?? (id ? id : "News");
};
const agentInfo = (key) => team?.agents?.[key] ?? { name: key, role: key };

/** API call to the dashboard's server functions. */
async function api(path, body) {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => null);
  if (!j) throw new Error("লগইনের মেয়াদ শেষ হতে পারে। পেজটা রিফ্রেশ করে আবার লগইন করুন।");
  if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

// ---------- rooms ----------
function setRoom(next) {
  room = next;
  store.set("autolab-room", room);
  $("#roomBtn").firstChild.textContent = `${ROOM_TITLE[room]} `;
  $("#roomMenu").hidden = true;
  $("#roomBtn").setAttribute("aria-expanded", "false");
  $("#hqPanel").hidden = room !== "hq";
  $("#officePanel").hidden = room !== "office";
  $("#teamPanel").hidden = room !== "team";
  for (const el of Object.values(tagEls)) el.remove();
  for (const k of Object.keys(tagEls)) delete tagEls[k];
  office.setScene(makeScene(room, bots));
  render();
}

/** The people shown in the current room, with their status and name. */
function roomPeople() {
  if (room === "office") {
    return { pakhi: { status: pakhiBusy ? "working" : "idle", activity: pakhiBusy ? "আপনার লেখা গোছাচ্ছে" : "আপনার মেসেজের অপেক্ষায়", name: "পাখি" } };
  }
  if (room === "team") {
    const people = {};
    for (const b of bots.slice(0, 8)) {
      const last = [...(state.drafts ?? [])].reverse().find((d) => d.niche === `bot:${b.id}`);
      const running = botRunning[b.id] && Date.now() - botRunning[b.id] < 6 * 60_000;
      people[b.id] = {
        status: running ? "working" : "idle",
        activity: running ? "কাজ চলছে…" : last ? `শেষ: ${last.headline}` : b.active ? "চালু · পরের শিফটের অপেক্ষায়" : "বন্ধ",
        name: b.name,
      };
    }
    return people;
  }
  const people = {};
  for (const k of ORDER) people[k] = { ...(state.agents[k] ?? { status: "idle", activity: "" }), name: agentInfo(k).name };
  return people;
}

// ---------- rendering ----------
function render() {
  if (!state) return;
  const fresh = state.lastRunAt && Date.now() - Date.parse(state.lastRunAt) < 9 * 3600_000;
  const anyWorking = Object.values(state.agents).some((a) => a.status === "working");
  $("#teamName").textContent = (team?.brand?.name ?? "AutoLab").toUpperCase();
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

  let stats;
  if (room === "office") {
    const mine = drafts.filter((d) => d.niche === "office");
    stats = [[bn(inbox.length), "পাখিকে পাঠানো"], [bn(inbox.filter((r) => r.status === "new").length), "কাজ চলছে"], [bn(mine.length), "তৈরি পোস্ট"], [bn(mine.filter((d) => d.status === "published").length), "প্রকাশিত"]];
    $("#board").innerHTML = `PAKHI'S DESK<br><b>${inbox.filter((r) => r.status === "new").length}</b> IN PROGRESS`;
  } else if (room === "team") {
    const botDrafts = drafts.filter((d) => d.niche?.startsWith("bot:"));
    const bs = botDrafts.map((d) => d.critic?.score).filter(Boolean);
    stats = [[bn(bots.length), "বট"], [bn(bots.filter((b) => b.active).length), "চালু"], [bn(botDrafts.length), "বটের ড্রাফট"], [bn(bs.length ? (bs.reduce((a, b) => a + b, 0) / bs.length).toFixed(1) : "–"), "গড় স্কোর"]];
    $("#board").innerHTML = `SPECIALISTS<br><b>${bots.length}</b> BOTS · <b>${bots.filter((b) => b.active).length}</b> ON`;
  } else {
    stats = [[bn(pending.length), "অনুমোদনের অপেক্ষায়"], [bn(todayCount), "আজকের ড্রাফট"], [bn(approved), "অনুমোদিত"], [bn(avg), "গড় Critic স্কোর"]];
    $("#board").innerHTML = `TODAY<br><b>${pending.length}</b> PENDING<br><b>${todayCount}</b> DRAFTS`;
  }
  $("#stats").innerHTML = stats.map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join("");

  office.setAgents(roomPeople(), dhakaHour());
  if (room === "hq") renderTab();
  if (room === "office") renderRequests();
  if (room === "team") renderBots();
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
  const own = d.niche === "office";
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
      ${own ? `<p class="hint">পাখির মাধ্যমে আপনার পাঠানো পোস্ট।</p>` : `<p class="hint">সূত্র: <a href="${esc(d.source?.link)}" target="_blank" rel="noopener">${esc(d.source?.title)}</a> (${esc(d.source?.feed)})</p>`}
      ${d.facts?.length ? `<p class="hint">${own ? "আপনার দেওয়া তথ্য" : "যাচাই করা তথ্য"}:</p><ul class="facts">${d.facts.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : ""}
      ${d.critic?.notes ? `<p class="hint">Arif-এর নোট: ${esc(d.critic.notes)}</p>` : ""}
    </div>
  </div>`;
  $("#copyBtn").onclick = async () => {
    try { await navigator.clipboard.writeText(full); $("#copyBtn").textContent = "কপি হয়েছে ✓"; } catch { $("#copyBtn").textContent = "কপি করা যায়নি"; }
  };
  $("#draftDialog").showModal();
}

// ---------- My Office Room: Pakhi ----------
const GREETING = { role: "pakhi", text: "আসসালামু আলাইকুম! আমি পাখি 🐦 কী পোস্ট করতে চান লিখুন, চাইলে ছবিও দিন। কিছু তথ্য বাদ থাকলে আমি জিজ্ঞেস করে নেব, তারপর গুছিয়ে সাব্বিরের কাছে পাঠাব।" };
let chat = store.get("pakhi-chat", [GREETING]);
let pendingImages = []; // data URLs kept until Pakhi hands the request over
let imagesShown = false; // whether the pending photos already appear in the conversation
let pakhiBusy = false;

function renderChat() {
  $("#chatLog").innerHTML = chat.map((m) => `<div class="msg ${m.role}">${m.images?.length ? `<div class="msg-imgs">${m.images.map((src) => `<img src="${esc(src)}" alt="">`).join("")}</div>` : ""}${esc(m.text)}</div>`).join("")
    + (pakhiBusy ? `<div class="msg pakhi typing"><span></span><span></span><span></span></div>` : "");
  $("#chatLog").scrollTop = $("#chatLog").scrollHeight;
  $("#thumbs").innerHTML = pendingImages.map((src, i) => `<span class="thumb"><img src="${esc(src)}" alt=""><button type="button" data-rm="${i}" aria-label="ছবি সরান">✕</button></span>`).join("");
  $("#chatSend").disabled = pakhiBusy;
}

function saveChat() {
  // Keep text history only (images can be large), last 40 messages.
  store.set("pakhi-chat", chat.slice(-40).map(({ role, text, sent }) => ({ role, text, sent })));
}

/** Shrinks a photo to at most 1280px as JPEG so it uploads fast. */
function shrink(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

async function sendToPakhi(e) {
  e.preventDefault();
  const text = $("#chatInput").value.trim();
  if ((!text && !pendingImages.length) || pakhiBusy) return;
  chat.push({ role: "owner", text: text || "(ছবি)", images: imagesShown ? [] : pendingImages.slice() });
  imagesShown = true;
  $("#chatInput").value = "";
  pakhiBusy = true;
  renderChat();
  render();
  // Only the conversation since the last hand-over is sent.
  const lastSent = chat.map((m) => m.sent).lastIndexOf(true);
  const convo = chat.slice(lastSent + 1).filter((m) => m !== GREETING).map(({ role, text }) => ({ role, text }));
  try {
    const out = await api("/api/pakhi", { messages: convo, images: pendingImages });
    chat.push({ role: "pakhi", text: out.reply, sent: out.ready });
    if (out.error) chat.push({ role: "system", text: `⚠️ ${out.error}` });
    if (out.ready) {
      chat.push({ role: "system", text: "✅ সাব্বিরের কাছে পাঠানো হয়েছে। কয়েক মিনিটের মধ্যে ড্রাফট Telegram-এ আসবে।", sent: true });
      pendingImages = [];
      imagesShown = false;
      inbox.push({ id: out.requestId, title: text.slice(0, 60) || "নতুন অনুরোধ", status: "new", createdAt: new Date().toISOString() });
    }
  } catch (err) {
    chat.push({ role: "system", text: `⚠️ ${err.message}` });
  } finally {
    pakhiBusy = false;
    saveChat();
    renderChat();
    render();
  }
}

function renderRequests() {
  const list = [...inbox].reverse().slice(0, 6);
  $("#requests").innerHTML = list.length
    ? `<h4>সাম্প্রতিক অনুরোধ</h4>` + list.map((r) => {
        const d = r.draftId && state.drafts?.find((x) => x.id === r.draftId);
        const status = r.status === "new" ? "⏳ সাব্বির কাজ করছে" : r.status === "done" ? "✅ ড্রাফট তৈরি" : `⚠️ ${r.error ?? "সমস্যা"}`;
        return `<div class="req">${d ? `<button class="linkish" data-id="${esc(d.id)}">${esc(r.title)}</button>` : `<span>${esc(r.title)}</span>`}<small>${esc(status)} · ${ago(r.createdAt)}</small></div>`;
      }).join("")
    : "";
}

// ---------- Specialised Team ----------
function renderBots() {
  const drafts = [...(state.drafts ?? [])].reverse();
  $("#botList").innerHTML = bots.length
    ? bots.map((b) => {
        const mine = drafts.filter((d) => d.niche === `bot:${b.id}`);
        const look = botLook(b.name);
        const running = botRunning[b.id] && Date.now() - botRunning[b.id] < 6 * 60_000;
        const scores = mine.map((d) => d.critic?.score).filter(Boolean);
        return `<div class="bot-card">
          <div class="agent">
            <div class="avatar" style="background:${look.shirt}">${esc(b.name[0])}</div>
            <div><h3>${esc(b.name)}</h3><p>${esc(b.topic)}</p>
              <p>দিনে ${bn(b.postsPerDay)}টা · ${bn(mine.length)} ড্রাফট${scores.length ? ` · গড় ${bn((scores.reduce((x, y) => x + y, 0) / scores.length).toFixed(1))}/১০` : ""} · ${b.sources.length ? b.sources.map((s) => esc(s.name)).join(", ") : "Google News"}</p></div>
            <div class="state ${b.active ? "working" : ""}">${b.active ? "চালু" : "বন্ধ"}</div>
          </div>
          <div class="bot-actions">
            <button class="send small" data-run="${esc(b.id)}" ${running ? "disabled" : ""}>${running ? "চলছে…" : "▶ এখনই চালান"}</button>
            <button class="ghost small" data-toggle="${esc(b.id)}">${b.active ? "বন্ধ করুন" : "চালু করুন"}</button>
            <button class="ghost small" data-edit="${esc(b.id)}">এডিট</button>
          </div>
          ${mine.length ? `<div class="bot-drafts">${mine.slice(0, 3).map(draftCard).join("")}</div>` : `<p class="hint">এখনো কোনো ড্রাফট নেই। "এখনই চালান" চেপে কাজ পরীক্ষা করুন।</p>`}
        </div>`;
      }).join("")
    : `<div class="empty">এখনো কোনো বট নেই।<br>"+ নতুন বট" চেপে প্রথম স্পেশালিস্ট যোগ করুন।</div>`;
}

function openBotForm(bot) {
  const f = $("#botForm");
  f.reset();
  $("#botError").textContent = "";
  $("#botFormTitle").textContent = bot ? `${bot.name} এডিট` : "নতুন বট";
  f.id.value = bot?.id ?? "";
  f.name.value = bot?.name ?? "";
  f.topic.value = bot?.topic ?? "";
  f.rss.value = (bot?.sources ?? []).filter((s) => s.type === "rss").map((s) => s.url).join("\n");
  f.localoy.checked = (bot?.sources ?? []).some((s) => s.type === "localoy-events");
  f.onthisday.checked = (bot?.sources ?? []).some((s) => s.type === "wikipedia-onthisday");
  f.postsPerDay.value = String(bot?.postsPerDay ?? 1);
  f.active.checked = bot ? bot.active : true;
  $("#deleteBot").hidden = !bot;
  $("#botDialog").showModal();
}

async function saveBot(e) {
  e.preventDefault();
  const f = e.target;
  const bot = {
    id: f.id.value || undefined,
    name: f.name.value,
    topic: f.topic.value,
    rss: f.rss.value.split("\n").map((s) => s.trim()).filter(Boolean),
    localoy: f.localoy.checked,
    onthisday: f.onthisday.checked,
    postsPerDay: Number(f.postsPerDay.value),
    active: f.active.checked,
  };
  try {
    const out = await api("/api/bots", { action: "save", bot });
    bots = out.bots;
    $("#botDialog").close();
    office.setScene(makeScene("team", bots));
    render();
  } catch (err) {
    $("#botError").textContent = err.message;
  }
}

async function botAction(action, id, extra = {}) {
  try {
    const out = await api("/api/bots", { action, id, ...extra });
    bots = out.bots;
    if (action === "run") botRunning[id] = Date.now();
    office.setScene(makeScene("team", bots));
    render();
  } catch (err) {
    alert(err.message);
  }
}

// ---------- name tags positioned over the canvas ----------
const tagEls = {};
function layoutTags(tags, boardPos) {
  const stage = $("#stage");
  const w = stage.clientWidth, h = stage.clientHeight;
  const people = state ? roomPeople() : {};
  for (const t of tags) {
    let el = tagEls[t.key];
    if (!el) {
      el = document.createElement("button");
      el.className = "tag";
      el.innerHTML = `<span class="bubble"></span><span class="name"><i></i><span></span></span>`;
      el.onclick = () => {
        if (room === "hq") { tab = "team"; renderTab(); }
        if (room === "office") $("#chatInput").focus();
      };
      $("#tags").appendChild(el);
      tagEls[t.key] = el;
    }
    const a = people[t.key] ?? { status: "idle", name: t.key };
    el.dataset.status = a.status;
    el.querySelector(".name span").textContent = a.name;
    el.querySelector(".bubble").textContent = a.activity || STATUS_BN[a.status];
    el.setAttribute("aria-label", `${a.name}: ${STATUS_BN[a.status] ?? a.status}. ${a.activity ?? ""}`);
    el.style.left = `${t.x * w}px`;
    el.style.top = `${t.y * h}px`;
    el.style.zIndex = String(Math.round(t.y * 1000));
  }
  const board = $("#board");
  board.style.left = `${boardPos[0] * w}px`;
  board.style.top = `${boardPos[1] * h}px`;
}

// ---------- wiring ----------
const office = new Office($("#office"), layoutTags, makeScene(room, bots));

$("#roomBtn").addEventListener("click", () => {
  const open = $("#roomMenu").hidden;
  $("#roomMenu").hidden = !open;
  $("#roomBtn").setAttribute("aria-expanded", String(open));
});
$("#roomMenu").addEventListener("click", (e) => {
  const b = e.target.closest("[data-room]");
  if (b) setRoom(b.dataset.room);
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".room-switch")) $("#roomMenu").hidden = true;
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") $("#roomMenu").hidden = true;
});

document.querySelector(".tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]");
  if (!b) return;
  tab = b.dataset.tab;
  store.set("autolab-tab", tab);
  renderTab();
});
for (const sel of ["#tabBody", "#botList", "#requests"]) {
  $(sel).addEventListener("click", (e) => {
    const card = e.target.closest("[data-id]");
    if (card) openDraft(card.dataset.id);
  });
}

// Pakhi's chat
$("#chatForm").addEventListener("submit", sendToPakhi);
$("#chatInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("#chatForm").requestSubmit(); }
});
$("#chatFiles").addEventListener("change", async (e) => {
  const files = [...e.target.files].slice(0, 3 - pendingImages.length);
  for (const f of files) {
    try { pendingImages.push(await shrink(f)); } catch {}
  }
  imagesShown = false;
  e.target.value = "";
  renderChat();
});
$("#thumbs").addEventListener("click", (e) => {
  const i = e.target.closest("[data-rm]")?.dataset.rm;
  if (i !== undefined) { pendingImages.splice(Number(i), 1); renderChat(); }
});
$("#newChat").addEventListener("click", () => {
  chat = [GREETING];
  pendingImages = [];
  saveChat();
  renderChat();
});

// Specialised Team
$("#addBot").addEventListener("click", () => openBotForm(null));
$("#botForm").addEventListener("submit", saveBot);
$("#deleteBot").addEventListener("click", async () => {
  const id = $("#botForm").id.value;
  if (id && confirm("এই বটটা মুছে ফেলবেন?")) {
    await botAction("delete", id);
    $("#botDialog").close();
  }
});
$("#botList").addEventListener("click", (e) => {
  const run = e.target.closest("[data-run]")?.dataset.run;
  const toggle = e.target.closest("[data-toggle]")?.dataset.toggle;
  const edit = e.target.closest("[data-edit]")?.dataset.edit;
  if (run) { e.stopPropagation(); botAction("run", run); }
  if (toggle) {
    e.stopPropagation();
    const b = bots.find((x) => x.id === toggle);
    if (b) api("/api/bots", { action: "save", bot: { ...b, rss: b.sources.filter((s) => s.type === "rss").map((s) => s.url), localoy: b.sources.some((s) => s.type === "localoy-events"), onthisday: b.sources.some((s) => s.type === "wikipedia-onthisday"), active: !b.active } })
      .then((out) => { bots = out.bots; render(); }).catch((err) => alert(err.message));
  }
  if (edit) { e.stopPropagation(); openBotForm(bots.find((x) => x.id === edit)); }
});

renderChat();
setRoom(room);
load();
setInterval(load, 60_000);
