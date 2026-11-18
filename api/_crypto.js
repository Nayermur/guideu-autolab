// Customers' keys, stored encrypted in the data repo (tenants/<id>/secrets.json).
// Same format as src/secrets.ts: AES-256-GCM with TENANT_SECRETS_KEY (32 bytes, base64).
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function masterKey() {
  const key = Buffer.from(process.env.TENANT_SECRETS_KEY || "", "base64");
  if (key.length !== 32) throw new Error("TENANT_SECRETS_KEY is not set in Vercel");
  return key;
}

export function encryptSecrets(secrets) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(secrets), "utf8"), cipher.final()]);
  return { v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
}

export function decryptSecrets(box) {
  if (box?.v !== 1) throw new Error("Unknown secrets format");
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(box.iv, "base64"));
  decipher.setAuthTag(Buffer.from(box.tag, "base64"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(box.data, "base64")), decipher.final()]).toString("utf8"));
}
