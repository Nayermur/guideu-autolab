// Telegram webhook: the ✅ Approve / ❌ Reject buttons under each draft, for every customer.
// Telegram calls this directly (no login), so each request must carry the secret registered for that bot.
//
// /api/telegram?t=<customer>  each customer's own bot (set up from the Setup page); the bot token, chat id
//                             and webhook secret are read from their encrypted keys.
// /api/telegram               the admin's own bot (TELEGRAM_WEBHOOK_SECRET / TELEGRAM_BOT_TOKEN in Vercel).

import { send, env, recordDecision, tenantSecrets, listTenants, TENANT_ID_RE } from "./_lib.js";
import { safeEqual } from "./_session.js";

async function telegram(bot, method, body) {
  if (!bot) return;
  await fetch(`${process.env.TELEGRAM_API_URL || "https://api.telegram.org"}/bot${bot}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  }).catch(() => {});
}

/** Which customer this press is for, with that bot's token and secret. */
async function botFor(req) {
  const t = new URL(req.url, "http://x").searchParams.get("t");
  if (!t) return { tenant: env.tenant, secret: process.env.TELEGRAM_WEBHOOK_SECRET || "", bot: process.env.TELEGRAM_BOT_TOKEN || "" };
  if (!TENANT_ID_RE.test(t)) return null;
  const info = (await listTenants()).find((x) => x.id === t);
  if (!info) return null;
  const s = await tenantSecrets(t);
  return { tenant: t, secret: s.telegramWebhookSecret || "", bot: s.telegramToken || "", chatId: s.telegramChatId };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "POST only" });
  const given = String(req.headers["x-telegram-bot-api-secret-token"] ?? "");
  let who;
  try {
    who = await botFor(req);
  } catch {
    return send(res, 500, { error: "Could not read settings" }); // Telegram retries later
  }
  if (!who?.secret || !given || !(await safeEqual(who.secret, given, who.secret))) return send(res, 401, { error: "Unauthorized" });

  const cq = req.body?.callback_query;
  const [action, draftId] = String(cq?.data ?? "").split(":");
  if (!cq || !["approve", "reject"].includes(action)) return send(res, 200, { ok: true });
  // Only presses in the customer's own chat count.
  if (who.chatId && String(cq.message?.chat?.id) !== String(who.chatId)) {
    await telegram(who.bot, "answerCallbackQuery", { callback_query_id: cq.id, text: "এই চ্যাট থেকে approve করা যাবে না", show_alert: true });
    return send(res, 200, { ok: true });
  }

  const decision = action === "approve" ? "approved" : "rejected";
  try {
    await recordDecision({ draftId, decision, via: "telegram", chatId: cq.message?.chat?.id, tenant: who.tenant });
    await telegram(who.bot, "answerCallbackQuery", { callback_query_id: cq.id, text: decision === "approved" ? "Approved ✅ Instagram-এ যাচ্ছে…" : "Rejected ❌" });
    if (cq.message?.message_id) {
      await telegram(who.bot, "editMessageReplyMarkup", {
        chat_id: cq.message.chat.id,
        message_id: cq.message.message_id,
        reply_markup: { inline_keyboard: [[{ text: decision === "approved" ? "Approved ✅" : "Rejected ❌", callback_data: "noop:0" }]] },
      });
    }
  } catch (e) {
    await telegram(who.bot, "answerCallbackQuery", { callback_query_id: cq.id, text: `সমস্যা: ${e.message}`.slice(0, 190), show_alert: true });
  }
  // Always 200 so Telegram does not keep retrying.
  return send(res, 200, { ok: true });
}
