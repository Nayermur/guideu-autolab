import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { env, ROOT, findNiche } from "./config.js";
import { log, saveState, type Draft, type State } from "./store.js";

/**
 * Telegram approval without a server: drafts are sent with Approve/Reject buttons,
 * and every run polls getUpdates to pick up the button presses.
 */

export const telegramEnabled = () => Boolean(env.telegramToken && env.telegramChatId);

async function api(method: string, body: Record<string, unknown> | FormData) {
  const isForm = body instanceof FormData;
  const res = await fetch(`https://api.telegram.org/bot${env.telegramToken}/${method}`, {
    method: "POST",
    headers: isForm ? undefined : { "Content-Type": "application/json" },
    body: isForm ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const json: any = await res.json();
  if (!json.ok) {
    const hint = /can't send messages to the bot/i.test(json.description)
      ? " (TELEGRAM_CHAT_ID is a bot's ID; use your own user ID from @userinfobot or @getmyid_bot)"
      : /chat not found/i.test(json.description)
        ? " (wrong TELEGRAM_CHAT_ID, or you have not pressed Start in your bot yet)"
        : /not found|unauthorized/i.test(json.description)
          ? " (TELEGRAM_BOT_TOKEN is wrong: paste the full token from @BotFather, like 123456789:AAH..., with no spaces)"
          : "";
    throw new Error(`Telegram ${method}: ${json.description}${hint}`);
  }
  return json.result;
}

const buttons = (id: string) => ({
  inline_keyboard: [[
    { text: "✅ Approve", callback_data: `approve:${id}` },
    { text: "❌ Reject", callback_data: `reject:${id}` },
  ]],
});

export async function sendDraft(d: Draft): Promise<number | undefined> {
  if (!telegramEnabled()) return;
  const niche = d.niche ? findNiche(d.niche)?.name ?? d.niche : "News";
  const header = `🆕 ${niche} · Draft ${d.id} · Critic ${d.critic.score}/10\n📰 ${d.source.title}\n🔗 ${d.source.link}\n\n`;
  const body = `${d.caption}\n\n${d.hashtags.join(" ")}`;
  // Photo captions are limited to 1024 chars, so the full caption goes in a second message if needed.
  const shortCaption = (header + body).length <= 1024 ? header + body : header + "(caption below)";
  let messageId: number | undefined;
  if (d.imagePath?.endsWith(".png")) {
    const form = new FormData();
    form.append("chat_id", env.telegramChatId);
    form.append("caption", shortCaption);
    form.append("reply_markup", JSON.stringify(buttons(d.id)));
    form.append("photo", new Blob([readFileSync(d.imagePath)]), basename(d.imagePath));
    messageId = (await api("sendPhoto", form)).message_id;
    if (shortCaption !== header + body) await api("sendMessage", { chat_id: env.telegramChatId, text: body });
  } else {
    messageId = (await api("sendMessage", {
      chat_id: env.telegramChatId,
      text: (header + body).slice(0, 4000),
      reply_markup: buttons(d.id),
    })).message_id;
  }
  return messageId;
}

export async function notify(text: string) {
  if (!telegramEnabled()) return;
  await api("sendMessage", { chat_id: env.telegramChatId, text: text.slice(0, 4000) }).catch(() => {});
}

/** Applies Approve/Reject button presses made since the last run. */
export async function processTelegramUpdates(state: State) {
  if (!telegramEnabled()) return;
  let updates: any[];
  try {
    updates = await api("getUpdates", { offset: state.telegramOffset, timeout: 0, allowed_updates: ["callback_query"] });
  } catch (e: any) {
    // With the instant webhook on, button presses arrive through the dashboard instead.
    if (/webhook is active/i.test(e.message)) return;
    throw e;
  }
  for (const u of updates) {
    state.telegramOffset = u.update_id + 1;
    const cq = u.callback_query;
    if (!cq || String(cq.message?.chat?.id) !== String(env.telegramChatId)) continue;
    const [action, id] = String(cq.data).split(":");
    const draft = state.drafts.find((d) => d.id === id);
    let reply = "Draft not found";
    if (draft && draft.status === "pending") {
      draft.status = action === "approve" ? "approved" : "rejected";
      draft.decidedAt = new Date().toISOString();
      reply = action === "approve" ? "Approved ✅" : "Rejected ❌";
      log(state, "system", `Owner ${draft.status} draft ${id} via Telegram`);
    } else if (draft) {
      reply = `Already ${draft.status}`;
    }
    await api("answerCallbackQuery", { callback_query_id: cq.id, text: reply }).catch(() => {});
    if (draft && cq.message?.message_id) {
      await api("editMessageReplyMarkup", {
        chat_id: env.telegramChatId,
        message_id: cq.message.message_id,
        reply_markup: { inline_keyboard: [[{ text: reply, callback_data: "noop:0" }]] },
      }).catch(() => {});
    }
  }
  saveState(state);
}

/** Sends pending drafts that never reached Telegram (e.g. the chat ID was wrong at the time). */
export async function resendUnsent(state: State) {
  if (!telegramEnabled()) return;
  for (const d of state.drafts.filter((x) => x.status === "pending" && !x.telegramMessageId)) {
    const imagePath = d.imagePath ? resolve(ROOT, d.imagePath) : undefined;
    d.telegramMessageId = await sendDraft({ ...d, imagePath });
    log(state, "system", `Sent draft ${d.id} to Telegram`);
    saveState(state);
  }
}

/** Checks the bot token and chat ID by sending a test message. */
export async function testTelegram(): Promise<string> {
  if (!env.telegramToken) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  if (!env.telegramChatId) throw new Error("TELEGRAM_CHAT_ID is not set");
  const me = await api("getMe", {});
  await api("sendMessage", {
    chat_id: env.telegramChatId,
    text: "✅ AutoLab সংযুক্ত হয়েছে! এখন থেকে নতুন ড্রাফট এখানে Approve/Reject বোতামসহ আসবে।",
  });
  return `Token OK (bot @${me.username}), test message sent to chat ${String(env.telegramChatId).slice(0, 3)}…`;
}

/** Read-only look at the bot's update queue, to find out why button presses are not arriving. */
export async function telegramDebug(offset: number): Promise<string[]> {
  const out: string[] = [];
  const hook = await api("getWebhookInfo", {});
  out.push(`webhook: ${hook.url ? `SET to ${hook.url}` : "none"} · pending updates: ${hook.pending_update_count ?? "?"}${hook.last_error_message ? ` · last error: ${hook.last_error_message}` : ""}`);
  // Peek at pending updates without confirming them (no offset beyond what was already processed).
  const updates: any[] = await api("getUpdates", { offset, timeout: 0, limit: 20 });
  out.push(`updates waiting (from offset ${offset}): ${updates.length}`);
  for (const u of updates) {
    const kind = Object.keys(u).filter((k) => k !== "update_id").join(",");
    const chat = u.callback_query?.message?.chat?.id ?? u.message?.chat?.id;
    const same = chat !== undefined ? (String(chat) === String(env.telegramChatId) ? "your chat" : "OTHER chat") : "?";
    out.push(`  #${u.update_id} ${kind} · ${same}${u.callback_query ? ` · data=${u.callback_query.data}` : ""}${u.message?.text ? ` · text=${String(u.message.text).slice(0, 20)}` : ""}`);
  }
  return out;
}

/** Replaces a draft message's buttons with a single status label (e.g. "Approved ✅"). */
export async function markDraftMessage(messageId: number | undefined, label: string) {
  if (!telegramEnabled() || !messageId) return;
  await api("editMessageReplyMarkup", {
    chat_id: env.telegramChatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: [[{ text: label, callback_data: "noop:0" }]] },
  }).catch(() => {});
}

/** Points the bot's button presses at the dashboard, so approvals are applied right away. */
export async function setTelegramWebhook(url: string, secret: string) {
  if (!telegramEnabled()) throw new Error("Telegram is not configured");
  await api("setWebhook", { url, secret_token: secret, allowed_updates: ["callback_query"] });
  const info = await api("getWebhookInfo", {});
  return `Webhook set to ${info.url} (pending updates: ${info.pending_update_count ?? 0})`;
}
