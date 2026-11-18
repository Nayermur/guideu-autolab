// Builds the static dashboard into public/: the dashboard files, team.json, the team's state and post images.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "public");

rmSync(out, { recursive: true, force: true });
mkdirSync(resolve(out, "data"), { recursive: true });
mkdirSync(resolve(out, "output"), { recursive: true });

cpSync(resolve(root, "dashboard"), out, { recursive: true });
copyFileSync(resolve(root, "team.json"), resolve(out, "team.json"));

const state = resolve(root, "data/state.json");
if (existsSync(state)) copyFileSync(state, resolve(out, "data/state.json"));

// Specialised Team bots
const botsFile = resolve(root, "data/bots.json");
if (existsSync(botsFile)) copyFileSync(botsFile, resolve(out, "data/bots.json"));

// A light index of Pakhi's requests (status only; photos stay private)
const inboxDir = resolve(root, "data/inbox");
const requests = existsSync(inboxDir)
  ? readdirSync(inboxDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(resolve(inboxDir, f), "utf8")))
      .map(({ id, title, status, createdAt, draftId, error }) => ({ id, title, status, createdAt, draftId, error }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  : [];
writeFileSync(resolve(out, "data/inbox-index.json"), JSON.stringify({ requests }));

let images = 0;
const outputDir = resolve(root, "output");
if (existsSync(outputDir)) {
  for (const f of readdirSync(outputDir)) {
    if (f.endsWith(".png")) {
      copyFileSync(resolve(outputDir, f), resolve(out, "output", f));
      images++;
    }
  }
}
console.log(`Dashboard built in public/ (${existsSync(state) ? "with" : "without"} team state, ${images} images)`);
