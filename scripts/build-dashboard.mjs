// Builds the static dashboard into public/: the dashboard files and team.json (shared by all customers),
// and for every customer in tenants/: their state, bots, request index and post images under public/t/<id>/.
// Secrets (tenants/<id>/secrets.json) and private config are never copied.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "public");
const tenantsDir = resolve(root, "tenants");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(resolve(root, "dashboard"), out, { recursive: true });
copyFileSync(resolve(root, "team.json"), resolve(out, "team.json"));

const readJson = (file, fallback) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : fallback);
const tenants = readJson(resolve(tenantsDir, "index.json"), { tenants: [] }).tenants;

for (const t of tenants) {
  if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(t.id)) continue;
  const src = resolve(tenantsDir, t.id);
  const dst = resolve(out, "t", t.id);
  mkdirSync(resolve(dst, "data"), { recursive: true });
  mkdirSync(resolve(dst, "output"), { recursive: true });

  // Page name, handle and niches (no keys in this file)
  writeFileSync(resolve(dst, "settings.json"), JSON.stringify({ id: t.id, name: t.name, ...readJson(resolve(src, "settings.json"), {}) }));

  for (const f of ["state.json", "bots.json"]) {
    const file = resolve(src, "data", f);
    if (existsSync(file)) copyFileSync(file, resolve(dst, "data", f));
  }

  // A light index of Pakhi's requests (status only; photos stay private)
  const inboxDir = resolve(src, "data/inbox");
  const requests = existsSync(inboxDir)
    ? readdirSync(inboxDir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => JSON.parse(readFileSync(resolve(inboxDir, f), "utf8")))
        .map(({ id, title, status, createdAt, draftId, error }) => ({ id, title, status, createdAt, draftId, error }))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    : [];
  writeFileSync(resolve(dst, "data/inbox-index.json"), JSON.stringify({ requests }));

  let images = 0;
  const outputDir = resolve(src, "output");
  if (existsSync(outputDir)) {
    for (const f of readdirSync(outputDir)) {
      if (f.endsWith(".png")) {
        copyFileSync(resolve(outputDir, f), resolve(dst, "output", f));
        images++;
      }
    }
  }
  console.log(`Customer ${t.id}: ${images} images`);
}
console.log(`Dashboard built in public/ for ${tenants.length} customer(s)`);
