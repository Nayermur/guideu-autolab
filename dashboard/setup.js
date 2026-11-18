// The Setup page: page details, niches and the customer's own keys. Talks to api/setup.js.
const $ = (s) => document.querySelector(s);
const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const KEYS = ["geminiKey", "igToken", "igUserId", "telegramToken", "telegramChatId"];
const PLAIN = new Set(["igUserId", "telegramChatId"]);
const GROUPS = { gemini: ["geminiKey"], instagram: ["igToken", "igUserId"], telegram: ["telegramToken", "telegramChatId"] };
let view = null;

async function call(body) {
  const r = await fetch("/api/setup", { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) location.replace("/login");
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

/** Key fields that were typed in (empty ones keep the saved value). */
function typedKeys() {
  return Object.fromEntries(KEYS.map((k) => [k, $(`#${k}`).value.trim()]).filter(([k, v]) => v && !(PLAIN.has(k) && v === view?.keys?.[k])));
}

function show(el, text, ok) {
  el.textContent = text;
  el.className = `msg ${ok ? "ok" : "err"}`;
}

async function busy(btn, fn) {
  btn.disabled = true;
  try { await fn(); } finally { btn.disabled = false; }
}

function render() {
  $("#brandName").value = view.brand.name;
  $("#brandHandle").value = view.brand.handle;
  for (const k of KEYS) {
    const el = $(`#${k}`);
    if (PLAIN.has(k)) el.value = view.keys[k] ?? "";
    else { el.value = ""; el.placeholder = view.keys[k] ? `সেভ করা আছে (${view.keys[k]}) — বদলাতে নতুনটা দিন` : el.getAttribute("placeholder") || ""; }
  }
  for (const [g, keys] of Object.entries(GROUPS)) {
    const done = keys.every((k) => view.keys[k]);
    const pill = $(`[data-pill="${g}"]`);
    pill.textContent = done ? "সেভ করা আছে" : view.owner ? "আপনার মূল কী ব্যবহার হচ্ছে" : "বাকি";
    pill.className = `pill ${done ? "ok" : view.owner ? "" : "warn"}`;
  }
  const m = $("#statusMsg");
  if (view.status === "active" && view.ready) show(m, "সব ঠিক আছে। আপনার টিম কাজ করছে ✓", true);
  else if (view.status === "paused") show(m, "আপনার অ্যাকাউন্ট এখন বন্ধ আছে। চালু করতে আমাদের সাথে যোগাযোগ করুন।", false);
  else show(m, "সেটআপ বাকি আছে। সব ঘর পূরণ করে সেভ করলেই আপনার টিম কাজ শুরু করবে।", false);
}

async function renderNiches() {
  const team = await fetch("/team.json").then((r) => r.json());
  const list = team.niches.filter((n) => n.enabled);
  const chosen = new Set(view.niches ?? list.map((n) => n.id));
  $("#niches").innerHTML = list
    .map((n) => `<label><input type="checkbox" value="${esc(n.id)}"${chosen.has(n.id) ? " checked" : ""}> ${esc(n.name)}</label>`)
    .join("");
}

async function init() {
  view = await call();
  render();
  await renderNiches();
}

// Test buttons
document.querySelectorAll("[data-test]").forEach((btn) => {
  btn.onclick = () => busy(btn, async () => {
    const kind = btn.dataset.test;
    const out = $(`[data-out="${kind}"]`);
    out.textContent = "পরীক্ষা চলছে…";
    out.className = "msg";
    try { show(out, (await call({ action: "test", kind, keys: typedKeys() })).message, true); }
    catch (e) { show(out, e.message, false); }
  });
});

// "Find it for me" buttons
$("#findIg").onclick = () => busy($("#findIg"), async () => {
  const out = $('[data-out="instagram"]');
  try {
    const { accounts } = await call({ action: "find-ig", keys: typedKeys() });
    $("#igPick").innerHTML = accounts.map((a) => `<button type="button" data-id="${esc(a.id)}">@${esc(a.username ?? a.id)}${a.page ? ` · ${esc(a.page)}` : ""}</button>`).join("");
    $("#igPick").querySelectorAll("button").forEach((b) => (b.onclick = () => { $("#igUserId").value = b.dataset.id; $("#igPick").innerHTML = ""; }));
    if (accounts.length === 1) { $("#igUserId").value = accounts[0].id; $("#igPick").innerHTML = ""; show(out, `পাওয়া গেছে: @${accounts[0].username}`, true); }
  } catch (e) { show(out, e.message, false); }
});

$("#findChat").onclick = () => busy($("#findChat"), async () => {
  const out = $('[data-out="telegram"]');
  try {
    const { chats } = await call({ action: "find-chat", keys: typedKeys() });
    $("#chatPick").innerHTML = chats.map((c) => `<button type="button" data-id="${esc(c.id)}">${esc(c.name || c.id)}</button>`).join("");
    $("#chatPick").querySelectorAll("button").forEach((b) => (b.onclick = () => { $("#telegramChatId").value = b.dataset.id; $("#chatPick").innerHTML = ""; }));
    if (chats.length === 1) { $("#telegramChatId").value = chats[0].id; $("#chatPick").innerHTML = ""; show(out, `পাওয়া গেছে: ${chats[0].name || chats[0].id}`, true); }
  } catch (e) { show(out, e.message, false); }
});

// Save
$("#save").onclick = () => busy($("#save"), async () => {
  const out = $("#saveMsg");
  try {
    const niches = [...document.querySelectorAll("#niches input:checked")].map((i) => i.value);
    const wasActive = view.status === "active";
    view = await call({ action: "save", brand: { name: $("#brandName").value, handle: $("#brandHandle").value }, niches, keys: typedKeys() });
    render();
    if (view.warning) show(out, `সেভ হয়েছে, তবে: ${view.warning}`, false);
    else show(out, !wasActive && view.status === "active" ? "সেভ হয়েছে। আপনার টিম এখন থেকে কাজ শুরু করবে 🎉" : "সেভ হয়েছে ✓", true);
  } catch (e) { show(out, e.message, false); }
});

init().catch((e) => show($("#statusMsg"), e.message, false));
