import { env } from "./config.js";

export interface GenerateOptions {
  system: string;
  prompt: string;
  json?: boolean;
  temperature?: number;
  timeoutMs?: number;
  /** Optional images the model should look at (base64, without the data: prefix). */
  images?: { mimeType: string; data: string }[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastCall = 0;

/** Space calls out so we stay inside free-tier rate limits. */
async function throttle() {
  const wait = lastCall + env.llmDelayMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
}

async function geminiOnce(model: string, o: GenerateOptions): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-goog-api-key": env.geminiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: o.system }] },
        contents: [
          {
            role: "user",
            parts: [
              ...(o.images ?? []).map((img) => ({ inline_data: { mime_type: img.mimeType, data: img.data } })),
              { text: o.prompt },
            ],
          },
        ],
        generationConfig: {
          temperature: o.temperature ?? 0.7,
          ...(o.json ? { responseMimeType: "application/json" } : {}),
        },
      }),
      signal: AbortSignal.timeout(o.timeoutMs ?? 60_000),
    },
  );
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Gemini ${model} HTTP ${res.status}: ${body?.error?.message ?? "unknown error"}`);
    (err as any).status = res.status;
    throw err;
  }
  const text = body?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
  if (!text) throw new Error(`Gemini ${model} returned no text (finishReason: ${body?.candidates?.[0]?.finishReason})`);
  return text;
}

async function gemini(o: GenerateOptions): Promise<string> {
  if (!env.geminiKey) throw new Error("GEMINI_API_KEY is not set");
  const errors: string[] = [];
  for (const model of env.geminiModels) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await throttle();
        return await geminiOnce(model, o);
      } catch (e: any) {
        errors.push(e.message);
        // 429 (rate limit) and 503 (busy) are usually short spikes on the free tier:
        // wait and retry the same model. Anything else (timeout, 404, ...) moves to the next model.
        if ((e.status === 429 || e.status === 503) && attempt < 2) {
          await sleep(e.status === 429 ? 20_000 : 8_000 * (attempt + 1));
          continue;
        }
        break;
      }
    }
  }
  throw new Error(`All Gemini models failed:\n- ${errors.join("\n- ")}`);
}

export async function generate(o: GenerateOptions): Promise<string> {
  return gemini(o);
}

function parseJson<T>(text: string): T {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(cleaned) as T;
}

/** Ask for JSON and parse it; retries once if the model returns broken JSON. */
export async function generateJson<T>(o: Omit<GenerateOptions, "json">): Promise<T> {
  const first = await generate({ ...o, json: true });
  try {
    return parseJson<T>(first);
  } catch {
    const second = await generate({
      ...o,
      json: true,
      prompt: `${o.prompt}\n\nIMPORTANT: Your previous answer was not valid JSON. Return ONLY valid JSON.`,
    });
    return parseJson<T>(second);
  }
}
