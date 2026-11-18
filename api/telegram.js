// Telegram webhook: the ✅ Approve / ❌ Reject buttons under each draft.
// Telegram calls this directly (no login), so the request must carry the secret we registered.

import { send, recordDecision } from "./_lib.js";

const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || "";
const BOT = process.env.TELEGRAM_BOT_TOKEN || ""; // optional: lets the button react instantly

async function telegram(method, body) {
  if (!BOT) return;
  await fetch(`https://api.telegram.org/bot${BOT}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  }).catch(() => {});
}

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "POST only" });
  if (!SECRET || req.headers["x-telegram-bot-api-secret-token"] !== SECRET) return send(res, 401, { error: "Unauthorized" });

  const cq = req.body?.callback_query;
  const [action, draftId] = String(cq?.data ?? "").split(":");
  if (!cq || !["approve", "reject"].includes(action)) return send(res, 200, { ok: true });

  const decision = action === "approve" ? "approved" : "rejected";
  try {
    await recordDecision({ draftId, decision, via: "telegram", chatId: cq.message?.chat?.id });
    await telegram("answerCallbackQuery", { callback_query_id: cq.id, text: decision === "approved" ? "Approved ✅ Instagram-এ যাচ্ছে…" : "Rejected ❌" });
    if (cq.message?.message_id) {
      await telegram("editMessageReplyMarkup", {
        chat_id: cq.message.chat.id,
        message_id: cq.message.message_id,
        reply_markup: { inline_keyboard: [[{ text: decision === "approved" ? "Approved ✅" : "Rejected ❌", callback_data: "noop:0" }]] },
      });
    }
  } catch (e) {
    await telegram("answerCallbackQuery", { callback_query_id: cq.id, text: `সমস্যা: ${e.message}`.slice(0, 190), show_alert: true });
  }
  // Always 200 so Telegram does not keep retrying.
  return send(res, 200, { ok: true });
}
