// The Setup page: a customer's page details, niches and their own keys (Instagram, Telegram, Gemini).
// Keys are stored encrypted (tenants/<id>/secrets.json) and are never sent back to the browser in full.
// GET → { status, brand, niches, keys: { name: "…last4" | null }, ready }
// POST { action: "save", brand?, niches?, keys? }      (empty key fields keep the saved value)
// POST { action: "test", kind: "gemini" | "instagram" | "telegram", keys? }   (typed values, else the saved ones)
// POST { action: "find-ig", keys? }      → the Instagram accounts this token can post to
// POST { action: "find-chat", keys? }    → chats that recently wrote to the Telegram bot

import { send, fail, requireSession, readDataFile, writeDataFile, updateDataJson, tenantPath, tenantProfile, randomCode } from "./_lib.js";
import { encryptSecrets, decryptSecrets } from "./_crypto.js";

const KEYS = ["geminiKey", "igToken", "igUserId", "telegramToken", "telegramChatId"];
const PLAIN = new Set(["igUserId", "telegramChatId"]); // not secret: shown in full
const GRAPH_VERSION = "v23.0";
const bad = (message, status = 400) => Object.assign(new Error(message), { status });

const mask = (k, v) => (!v ? null : PLAIN.has(k) ? v : `…${String(v).slice(-4)}`);
const required = (s) => Boolean(s.geminiKey && s.igToken && s.igUserId && s.telegramToken && s.telegramChatId);
const graphHost = (token) => (String(token).startsWith("IG") ? "graph.instagram.com" : "graph.facebook.com");

async function getJson(url, init) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, j };
}

// ---------- connection tests ----------
async function testGemini({ geminiKey }) {
  if (!geminiKey) throw bad("Gemini API key দিন।");
  const { ok, j } = await getJson("https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-goog-api-key": geminiKey },
    body: JSON.stringify({ contents: [{ parts: [{ text: "Reply with the single word OK" }] }] }),
  });
  if (!ok) throw bad(`Gemini কী কাজ করছে না: ${j?.error?.message ?? "unknown error"}`);
  return "Gemini কী ঠিক আছে ✓";
}

async function testInstagram({ igToken, igUserId }) {
  if (!igToken || !igUserId) throw bad("Instagram টোকেন আর IG User ID দুটোই দিন।");
  const url = `https://${graphHost(igToken)}/${GRAPH_VERSION}/${encodeURIComponent(igUserId)}?fields=username&access_token=${encodeURIComponent(igToken)}`;
  const { ok, j } = await getJson(url);
  if (!ok) throw bad(`Instagram সংযোগ হচ্ছে না: ${j?.error?.message ?? "unknown error"}`);
  return `Instagram ঠিক আছে ✓ (@${j.username ?? igUserId})`;
}

async function telegram(token, method, body) {
  if (!/^\d{5,12}:[A-Za-z0-9_-]{30,}$/.test(String(token))) throw bad("Telegram বট টোকেনটা ঠিক নেই (দেখতে 123456789:AAH... এর মতো)।");
  const { j } = await getJson(`${process.env.TELEGRAM_API_URL || "https://api.telegram.org"}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!j.ok) throw bad(`Telegram: ${j.description ?? "error"}`);
  return j.result;
}

async function testTelegram({ telegramToken, telegramChatId }) {
  if (!telegramToken || !telegramChatId) throw bad("বট টোকেন আর Chat ID দুটোই দিন।");
  const me = await telegram(telegramToken, "getMe");
  await telegram(telegramToken, "sendMessage", { chat_id: telegramChatId, text: "✅ AutoLab-এর সাথে সংযোগ ঠিক আছে। নতুন পোস্টের ড্রাফট এখানে আসবে।" });
  return `Telegram ঠিক আছে ✓ (@${me.username}), পরীক্ষার মেসেজ পাঠানো হয়েছে`;
}

async function findInstagram({ igToken }) {
  if (!igToken) throw bad("আগে Instagram টোকেন দিন।");
  if (graphHost(igToken) === "graph.instagram.com") {
    const { ok, j } = await getJson(`https://graph.instagram.com/${GRAPH_VERSION}/me?fields=user_id,username&access_token=${encodeURIComponent(igToken)}`);
    if (!ok) throw bad(`Instagram: ${j?.error?.message ?? "error"}`);
    return [{ id: String(j.user_id), username: j.username }];
  }
  const { ok, j } = await getJson(`https://graph.facebook.com/${GRAPH_VERSION}/me/accounts?fields=name,instagram_business_account{id,username}&limit=50&access_token=${encodeURIComponent(igToken)}`);
  if (!ok) throw bad(`Instagram: ${j?.error?.message ?? "error"}`);
  const list = (j.data ?? []).filter((p) => p.instagram_business_account).map((p) => ({ id: p.instagram_business_account.id, username: p.instagram_business_account.username, page: p.name }));
  if (!list.length) throw bad("এই টোকেন দিয়ে কোনো Instagram বিজনেস অ্যাকাউন্ট পাওয়া যায়নি। টোকেন বানানোর সময় Facebook পেজ আর Instagram অ্যাকাউন্ট দুটোই যোগ করা হয়েছে কিনা দেখুন।");
  return list;
}

/** Turns on instant Approve / Reject: Telegram sends button presses straight to this customer's webhook. */
async function setWebhook(origin, tenant, keys) {
  await telegram(keys.telegramToken, "setWebhook", {
    url: `${origin}/api/telegram?t=${tenant}`,
    secret_token: keys.telegramWebhookSecret,
    allowed_updates: ["callback_query"],
  });
}

async function findChats({ telegramToken }) {
  if (!telegramToken) throw bad("আগে বট টোকেন দিন।");
  const updates = await telegram(telegramToken, "getUpdates", { limit: 100, timeout: 0 }).catch(async (e) => {
    if (!/webhook/i.test(e.message)) throw e;
    // The instant-approval webhook hides new messages; switch it off until the next Save turns it on again.
    await telegram(telegramToken, "deleteWebhook", { drop_pending_updates: false });
    throw bad("বটে আবার একটা মেসেজ পাঠান, তারপর আবার “খুঁজে দাও” চাপুন। শেষে সেভ করতে ভুলবেন না।");
  });
  const chats = new Map();
  for (const u of updates) {
    const c = (u.message ?? u.channel_post ?? u.my_chat_member ?? u.callback_query?.message)?.chat;
    if (c) chats.set(String(c.id), { id: String(c.id), name: c.title || [c.first_name, c.last_name].filter(Boolean).join(" ") || c.username || "" });
  }
  if (!chats.size) throw bad("কোনো চ্যাট পাওয়া যায়নি। Telegram-এ আপনার বটটা খুলে Start চাপুন, একটা মেসেজ পাঠান, তারপর আবার চেষ্টা করুন।");
  return [...chats.values()];
}

// ---------- handler ----------
export default async function handler(req, res) {
  try {
    const { tenant } = await requireSession(req);
    const profile = await tenantProfile(tenant);
    const secretsPath = tenantPath("secrets.json", tenant);
    const settingsPath = tenantPath("settings.json", tenant);
    const secretsFile = await readDataFile(secretsPath);
    const saved = secretsFile ? decryptSecrets(secretsFile.json) : {};

    const view = async (secrets = saved, status = profile.status) => {
      const settings = (await readDataFile(settingsPath))?.json ?? {};
      return {
        status,
        owner: Boolean(profile.owner),
        brand: { name: settings.brand?.name ?? profile.name, handle: settings.brand?.handle ?? "" },
        niches: settings.niches ?? null,
        keys: Object.fromEntries(KEYS.map((k) => [k, mask(k, secrets[k])])),
        ready: profile.owner || required(secrets),
      };
    };
    if (req.method === "GET") return send(res, 200, await view());
    if (req.method !== "POST") return send(res, 405, { error: "GET or POST" });

    const { action } = req.body ?? {};
    // Typed values win over saved ones, so a key can be tested before saving it.
    const typed = Object.fromEntries(KEYS.map((k) => [k, String(req.body?.keys?.[k] ?? "").trim()]).filter(([, v]) => v));
    const keys = { ...saved, ...typed };

    if (action === "test") {
      const run = { gemini: testGemini, instagram: testInstagram, telegram: testTelegram }[req.body.kind];
      if (!run) throw bad("Unknown test");
      return send(res, 200, { ok: true, message: await run(keys) });
    }
    if (action === "find-ig") return send(res, 200, { ok: true, accounts: await findInstagram(keys) });
    if (action === "find-chat") return send(res, 200, { ok: true, chats: await findChats(keys) });
    if (action !== "save") throw bad("Unknown action");

    // Page details and niches
    const b = req.body;
    if (b.brand || b.niches) {
      await updateDataJson(settingsPath, {}, (s) => {
        if (b.brand) {
          const name = String(b.brand.name ?? "").trim().slice(0, 80);
          const handle = String(b.brand.handle ?? "").trim().replace(/^@?/, "@").slice(0, 40);
          if (!name) throw bad("পেজের নাম দিন।");
          if (!/^@[A-Za-z0-9._]{1,30}$/.test(handle)) throw bad("Instagram হ্যান্ডেলটা ঠিক নেই (যেমন @yourpage)।");
          s.brand = { ...s.brand, name, handle };
        }
        if (b.niches) {
          const ids = (Array.isArray(b.niches) ? b.niches : []).map(String).filter((x) => /^[a-z0-9-]{1,30}$/.test(x)).slice(0, 20);
          if (!ids.length) throw bad("অন্তত একটা বিষয় (নিশ) বেছে নিন।");
          s.niches = ids;
        }
      }, `Setup: settings for ${tenant}`);
    }

    // Keys
    if (typed.igUserId && !/^\d{5,25}$/.test(typed.igUserId)) throw bad("IG User ID শুধু সংখ্যা হয়।");
    if (typed.telegramChatId && !/^-?\d{3,20}$/.test(typed.telegramChatId)) throw bad("Telegram Chat ID শুধু সংখ্যা হয় (গ্রুপের হলে শুরুতে -)।");
    const telegramReady = Boolean(keys.telegramToken && keys.telegramChatId);
    if (telegramReady && !keys.telegramWebhookSecret) keys.telegramWebhookSecret = randomCode(32);
    if (Object.keys(typed).length || keys.telegramWebhookSecret !== saved.telegramWebhookSecret) {
      await writeDataFile(secretsPath, JSON.stringify(encryptSecrets(keys), null, 2) + "\n", `Setup: keys for ${tenant}`, secretsFile?.sha);
    }
    // Instant Approve / Reject buttons (re-registered on every Save, so a changed bot or chat is picked up).
    let telegramNote = "";
    if (telegramReady) {
      const origin = `https://${req.headers["x-forwarded-host"] || req.headers.host}`;
      telegramNote = await setWebhook(origin, tenant, keys).then(
        () => "",
        (e) => `Telegram-এর তাৎক্ষণিক বাটন চালু করা যায়নি (${e.message}); approve ৩০ মিনিটের মধ্যে ধরা পড়বে।`,
      );
    }

    // Everything there? Then the team starts working for this customer.
    let status = profile.status;
    if (status === "setup" && required(keys)) {
      await updateDataJson("tenants/index.json", { tenants: [] }, (j) => {
        const t = j.tenants.find((x) => x.id === tenant);
        if (t && t.status === "setup") t.status = "active";
      }, `${tenant} finished setup`);
      status = "active";
    }
    return send(res, 200, { ok: true, ...(await view(keys, status)), ...(telegramNote ? { warning: telegramNote } : {}) });
  } catch (e) {
    return fail(res, e);
  }
}
