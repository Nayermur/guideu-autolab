import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { TenantSecrets } from "./config.js";

/**
 * A customer's keys (Instagram, Telegram, Gemini) are stored encrypted in tenants/<id>/secrets.json.
 * They are locked with AES-256-GCM using TENANT_SECRETS_KEY (32 random bytes, base64), which lives only
 * in GitHub secrets and Vercel environment variables, never in a repo.
 * The dashboard's server functions (api/_crypto.js) use exactly the same format.
 *
 * File format: { "v": 1, "iv": base64(12 bytes), "tag": base64(16 bytes), "data": base64(ciphertext) }
 */

function masterKey(): Buffer {
  const raw = process.env.TENANT_SECRETS_KEY || "";
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("TENANT_SECRETS_KEY is missing or not 32 bytes (base64)");
  return key;
}

export function encryptSecrets(secrets: TenantSecrets, key = masterKey()) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(secrets), "utf8"), cipher.final()]);
  return { v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
}

export function decryptSecrets(box: { v: number; iv: string; tag: string; data: string }, key = masterKey()): TenantSecrets {
  if (box.v !== 1) throw new Error(`Unknown secrets format v${box.v}`);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(box.iv, "base64"));
  decipher.setAuthTag(Buffer.from(box.tag, "base64"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(box.data, "base64")), decipher.final()]).toString("utf8"));
}

/** Reads a customer's keys; an empty object if they have not saved any yet. */
export function loadTenantSecrets(tenantDir: string): TenantSecrets {
  const file = resolve(tenantDir, "secrets.json");
  if (!existsSync(file)) return {};
  const s = decryptSecrets(JSON.parse(readFileSync(file, "utf8")));
  // Instagram Login tokens (IGAA...) only work on graph.instagram.com.
  if (!s.igGraphHost && s.igToken?.startsWith("IG")) s.igGraphHost = "graph.instagram.com";
  return s;
}

export function saveTenantSecrets(tenantDir: string, secrets: TenantSecrets) {
  mkdirSync(tenantDir, { recursive: true });
  writeFileSync(resolve(tenantDir, "secrets.json"), JSON.stringify(encryptSecrets(secrets), null, 2) + "\n");
}
