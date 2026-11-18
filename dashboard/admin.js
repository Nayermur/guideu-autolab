// The admin page: customers and invitation links. Talks to api/admin.js.
const $ = (s) => document.querySelector(s);
const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const date = (iso) => (iso ? new Date(iso).toLocaleDateString("bn-BD", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Dhaka" }) : "");
const STATUS = { active: ["চালু", "ok"], setup: ["সেটআপ বাকি", "warn"], paused: ["বন্ধ", ""] };

async function call(body) {
  const r = await fetch("/api/admin", { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) location.replace("/login");
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
const show = (el, text, ok) => { el.textContent = text; el.className = `msg ${ok ? "ok" : "err"}`; };

function copyButton(link) {
  return `<button class="ghost" data-copy="${esc(link)}">কপি</button>`;
}

async function load() {
  const { tenants, invites } = await call();
  $("#tenants").innerHTML = tenants.map((t) => {
    const [label, cls] = STATUS[t.status] ?? [t.status, ""];
    const toggle = t.owner ? '<span class="hint">আপনার পেজ</span>'
      : t.status === "paused" ? `<button class="ghost" data-status="active" data-id="${esc(t.id)}">চালু করো</button>`
      : `<button class="ghost" data-status="paused" data-id="${esc(t.id)}">বন্ধ করো</button>`;
    return `<tr><td><b>${esc(t.name)}</b><br><span class="hint">${esc(t.id)}</span></td><td><span class="pill ${cls}">${label}</span></td>
      <td>${t.accounts.map(esc).join("<br>") || '<span class="hint">—</span>'}</td><td>${date(t.createdAt)}</td><td>${toggle}</td></tr>`;
  }).join("");

  $("#invites").innerHTML = invites.map((i) => {
    const expired = Date.parse(i.expiresAt) < Date.now();
    const state = i.usedBy ? `<span class="pill ok">ব্যবহার হয়েছে</span><br><span class="hint">${esc(i.usedBy)} · ${date(i.usedAt)}</span>`
      : expired ? '<span class="pill">মেয়াদ শেষ</span>'
      : `<span class="pill warn">অপেক্ষায়</span><br><span class="hint">${date(i.expiresAt)} পর্যন্ত</span>`;
    const link = i.usedBy || expired ? '<span class="hint">—</span>' : `<span class="link">${esc(i.link)}</span>`;
    return `<tr><td>${esc(i.note) || '<span class="hint">—</span>'}</td><td>${state}</td><td>${link}</td>
      <td class="actions">${!i.usedBy && !expired ? copyButton(i.link) : ""}<button class="ghost" data-del="${esc(i.code)}">মুছে দাও</button></td></tr>`;
  }).join("") || '<tr><td colspan="4" class="hint">এখনো কোনো ইনভাইট নেই</td></tr>';
}

document.addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  try {
    if (b.dataset.copy) {
      await navigator.clipboard.writeText(b.dataset.copy);
      b.textContent = "কপি হয়েছে ✓";
    } else if (b.dataset.del) {
      if (!confirm("এই ইনভাইট মুছে দেবেন? লিংকটা আর কাজ করবে না।")) return;
      b.disabled = true;
      await call({ action: "delete-invite", code: b.dataset.del });
      await load();
    } else if (b.dataset.status) {
      if (b.dataset.status === "paused" && !confirm("এই কাস্টমারের টিম বন্ধ করবেন? সে লগইন করতে পারবে, কিন্তু নতুন পোস্ট হবে না।")) return;
      b.disabled = true;
      await call({ action: "status", tenant: b.dataset.id, status: b.dataset.status });
      await load();
    }
  } catch (err) {
    show($("#tenantMsg"), err.message, false);
    b.disabled = false;
  }
});

$("#create").onclick = async () => {
  const btn = $("#create");
  btn.disabled = true;
  try {
    const { invite } = await call({ action: "invite", note: $("#note").value, days: $("#days").value });
    $("#createMsg").className = "msg ok";
    $("#createMsg").innerHTML = `লিংক তৈরি হয়েছে: <span class="link">${esc(invite.link)}</span> ${copyButton(invite.link)}`;
    $("#note").value = "";
    await load();
  } catch (e) {
    show($("#createMsg"), e.message, false);
  } finally {
    btn.disabled = false;
  }
};

load().catch((e) => show($("#tenantMsg"), e.message, false));
