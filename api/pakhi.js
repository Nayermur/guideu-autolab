// Pakhi, the owner's assistant in "My Office Room".
// POST { messages: [{ role: "owner" | "pakhi", text }], images: ["data:image/jpeg;base64,..."] }
// → { reply, ready, requestId?, error? }
// When the owner's notes are complete, Pakhi saves a request (and the photos) to the data repo
// and starts the team, where Sabbir (Writer) takes over.

import { env, send, gemini, writeDataFile, startWorkflow, newId, tenantPath } from "./_lib.js";

const SYSTEM = `You are Pakhi (পাখি), the friendly female personal assistant of the owner of the Instagram page "GuideU BD" (@guideu.bd).
You always reply in natural, warm Bangla, short and clear.
The owner sends you notes, post ideas or details, sometimes with photos (for example an event flyer). Your job:
1. Understand what post the owner wants.
2. If something essential is missing, ask ONE short message with the specific missing details. Essentials depend on the post:
   - events/programmes/offers: name, date, time, place (venue and area); price or registration if the owner mentioned tickets
   - news/announcements: who, what, when, where
   - anything about a person or brand: the exact name
   Read the photos too: details visible in a flyer count as given.
   Never ask for things that are not needed, and never ask twice for something already answered.
3. When you have enough, organize everything into a clean brief for Sabbir, the Writer, and tell the owner in one or two lines that you are sending it.
Never invent details. Use only what the owner said or what is clearly visible in the photos.

Return JSON only:
{"reply":"<your Bangla message to the owner>","ready":true|false,
 "request": null | {"title":"<short title>","details":"<clean organized summary in Bangla or English>",
   "facts":["<each concrete fact the owner gave, one per item>"],
   "format":"event"|"news"|"explainer",
   "event": null | {"start":"YYYY-MM-DD","end":"YYYY-MM-DD or null","venue":"...","area":"...","organizer":"..."}}}
Set "event" only when the post is about a dated event and the date is known.`;

const MAX_IMAGES = 3;

function parseImages(list) {
  return (Array.isArray(list) ? list : [])
    .slice(0, MAX_IMAGES)
    .map((u) => String(u).match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/))
    .filter(Boolean)
    .map((m) => ({ mimeType: m[1], data: m[2] }));
}

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "POST only" });
  try {
    const messages = (Array.isArray(req.body?.messages) ? req.body.messages : [])
      .slice(-16)
      .map((m) => ({ role: m.role === "pakhi" ? "model" : "user", text: String(m.text ?? "").slice(0, 4000) }))
      .filter((m) => m.text);
    if (!messages.length || messages[messages.length - 1].role !== "user") return send(res, 400, { error: "Send a message first" });
    const images = parseImages(req.body?.images);
    if (images.length) messages[messages.length - 1].text += `\n\n(The owner attached ${images.length} photo(s).)`;

    const out = await gemini({ system: SYSTEM, contents: messages, images });
    const reply = String(out.reply || "বুঝেছি!");
    if (!out.ready || !out.request) return send(res, 200, { reply, ready: false });

    // Hand the organized request to the team.
    if (!env.githubToken || !env.dataRepo || !env.codeRepo) {
      return send(res, 200, {
        reply,
        ready: false,
        error: "Sending to the team is not set up yet: add DASHBOARD_GITHUB_TOKEN, DATA_REPO and CODE_REPO in Vercel.",
      });
    }
    const id = newId("p");
    const imagePaths = [];
    for (const [i, img] of images.entries()) {
      const ext = img.mimeType === "image/png" ? "png" : img.mimeType === "image/webp" ? "webp" : "jpg";
      const path = `inbox/${id}/${i + 1}.${ext}`;
      await writeDataFile(tenantPath(`data/${path}`), Buffer.from(img.data, "base64"), `Pakhi: photo ${i + 1} for ${id}`);
      imagePaths.push(path);
    }
    const r = out.request;
    const ev = r.event && /^\d{4}-\d{2}-\d{2}$/.test(r.event.start || "") ? r.event : null;
    const request = {
      id,
      createdAt: new Date().toISOString(),
      status: "new",
      title: String(r.title || "Owner's post").slice(0, 200),
      details: String(r.details || "").slice(0, 4000),
      facts: (Array.isArray(r.facts) ? r.facts : []).map((f) => String(f).slice(0, 500)).slice(0, 20),
      format: ["event", "news", "explainer"].includes(r.format) ? r.format : "news",
      ...(ev ? { event: { start: ev.start, end: ev.end || undefined, venue: ev.venue || undefined, area: ev.area || undefined, organizer: ev.organizer || undefined } } : {}),
      images: imagePaths,
    };
    if (!request.facts.length) request.facts = [request.details];
    await writeDataFile(tenantPath(`data/inbox/${id}.json`), JSON.stringify(request, null, 2) + "\n", `Pakhi: request ${id}`);
    await startWorkflow({ mode: "inbox" });
    return send(res, 200, { reply, ready: true, requestId: id });
  } catch (e) {
    return send(res, 500, { error: e.message });
  }
}
