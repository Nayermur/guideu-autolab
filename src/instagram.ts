import { env, team, tenantBaseUrl } from "./config.js";
import { log, saveState, type Draft, type State } from "./store.js";
import { notify } from "./telegram.js";

/**
 * Phase 3: publishes approved drafts to Instagram with the Graph API content-publishing flow:
 *   1. POST /{ig-user-id}/media          (image_url + caption)  -> container id
 *   2. GET  /{container-id}?fields=status_code  until FINISHED
 *   3. POST /{ig-user-id}/media_publish  (creation_id)          -> media id
 *   4. GET  /{media-id}?fields=permalink
 * Instagram downloads the image itself, so it must be live on the public dashboard URL first.
 */

const MAX_ATTEMPTS = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const instagramEnabled = () => Boolean(team.autoPublish && env.igUserId && env.igToken);

class GraphError extends Error {
  constructor(message: string, public code?: number, public retryable = true) {
    super(message);
  }
}

async function graph(method: "GET" | "POST", path: string, params: Record<string, string> = {}): Promise<any> {
  const body = new URLSearchParams({ ...params, access_token: env.igToken });
  const url = `${env.igGraphBase}/${path}`;
  const res = await fetch(method === "GET" ? `${url}?${body}` : url, {
    method,
    body: method === "POST" ? body : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const e = json.error ?? {};
    // 190 = invalid/expired token, 10/200 = missing permission: retrying will not help.
    const fatal = [190, 10, 200].includes(e.code);
    throw new GraphError(`Instagram API: ${e.message ?? `HTTP ${res.status}`}${e.code ? ` (code ${e.code})` : ""}`, e.code, !fatal);
  }
  return json;
}

export function publicImageUrl(d: Draft): string {
  if (!d.imagePath?.endsWith(".png")) throw new GraphError("Draft has no PNG image", undefined, false);
  return new URL(d.imagePath, tenantBaseUrl()).href;
}

export function fullCaption(d: Draft): string {
  const tags = d.hashtags.slice(0, 30).join(" "); // Instagram allows at most 30 hashtags
  return `${d.caption}\n\n${tags}`.slice(0, 2200); // and 2,200 characters
}

export async function publishDraft(d: Draft): Promise<{ mediaId: string; permalink?: string }> {
  const imageUrl = publicImageUrl(d);

  // The image is committed by GitHub Actions and then deployed by Vercel; make sure it is live.
  const head = await fetch(imageUrl, { method: "HEAD", signal: AbortSignal.timeout(20_000) }).catch(() => null);
  if (!head?.ok || !head.headers.get("content-type")?.startsWith("image/")) {
    throw new GraphError(`Image is not public yet (${head?.status ?? "no response"}): ${imageUrl}`);
  }

  const container = await graph("POST", `${env.igUserId}/media`, { image_url: imageUrl, caption: fullCaption(d) });

  for (let i = 0; i < 12; i++) {
    const { status_code } = await graph("GET", container.id, { fields: "status_code" });
    if (status_code === "FINISHED") break;
    if (status_code === "ERROR" || status_code === "EXPIRED") throw new GraphError(`Instagram could not process the image (${status_code})`);
    if (i === 11) throw new GraphError("Instagram took too long to process the image");
    await sleep(5_000);
  }

  const published = await graph("POST", `${env.igUserId}/media_publish`, { creation_id: container.id });
  const info = await graph("GET", published.id, { fields: "permalink" }).catch(() => ({}));
  return { mediaId: published.id, permalink: info.permalink };
}

/** Publishes every approved draft that has not been published yet. Safe to run often. */
export async function publishApproved(state: State): Promise<number> {
  if (!instagramEnabled()) return 0;
  let count = 0;
  for (const d of state.drafts.filter((x) => x.status === "approved")) {
    d.publish = { attempts: (d.publish?.attempts ?? 0) + 1, lastTriedAt: new Date().toISOString() };
    try {
      const { mediaId, permalink } = await publishDraft(d);
      d.status = "published";
      d.instagram = { mediaId, permalink, publishedAt: new Date().toISOString() };
      count++;
      log(state, "system", `Published ${d.id} to Instagram ${permalink ?? mediaId}`);
      await notify(`📢 Instagram-এ পোস্ট হয়েছে: ${d.headline}\n${permalink ?? ""}`);
    } catch (e: any) {
      d.publish.lastError = e.message;
      log(state, "system", `Publishing ${d.id} failed (attempt ${d.publish.attempts}): ${e.message}`);
      const fatal = e instanceof GraphError && !e.retryable;
      if (fatal || d.publish.attempts >= MAX_ATTEMPTS) {
        d.status = "failed";
        await notify(`⚠️ Instagram-এ পোস্ট করা যায়নি: ${d.headline}\n${e.message}\n\nঠিক করে আবার চেষ্টা করতে: npm run retry -- ${d.id}`);
      }
      // An invalid token will fail for every draft, so stop here.
      if (e instanceof GraphError && e.code === 190) break;
    }
    saveState(state);
  }
  return count;
}
