// Creates the eight demo accounts (docs/design/AUTH.md, "Demo accounts") in the Zitadel organization through Zitadel's
// v2 user API, with verified e-mails, so the Worker links a first login to the seeded person of the same e-mail
// (api/seed/seed.py, EMAILS). Re-running skips accounts that already exist and leaves their passwords alone.
//
// Secrets stay outside the repository:
// - the API token (a personal access token of a Zitadel service user with the right to create users in the
//   organization) is read from ZITADEL_PAT_FILE, by default ~/.config/zitadel/glide-mdt.pat;
// - the generated passwords are written only to ZITADEL_ACCOUNTS_FILE, by default
//   ~/.config/zitadel/glide-mdt-demo-accounts.txt, created with mode 600 and never printed. Move them to the team's
//   password manager, then delete the file.
//
// Usage (api/AGENTS.md, "Login"):
//   node api/scripts/zitadel-demo-accounts.mjs
//   ZITADEL_ISSUER=https://<instance> ZITADEL_ORG_ID=<org id> node api/scripts/zitadel-demo-accounts.mjs
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { randomInt } from "node:crypto";

const issuer = (process.env.ZITADEL_ISSUER ?? "https://glide-mdt--dev-dybk0r.eu1.zitadel.cloud").replace(/\/+$/, "");
const orgId = process.env.ZITADEL_ORG_ID ?? "395715805603533696";
const patFile = process.env.ZITADEL_PAT_FILE ?? path.join(homedir(), ".config/zitadel/glide-mdt.pat");
const outFile = process.env.ZITADEL_ACCOUNTS_FILE ?? path.join(homedir(), ".config/zitadel/glide-mdt-demo-accounts.txt");

// Never inside the repository: a password file there could be committed by accident.
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
for (const f of [patFile, outFile]) {
  if (path.resolve(f).startsWith(repo + path.sep)) {
    console.error(`refusing ${f}: token and password files must live outside the repository`);
    process.exit(1);
  }
}
if (!existsSync(patFile)) {
  console.error(`no API token at ${patFile} (set ZITADEL_PAT_FILE)`);
  process.exit(1);
}
const pat = readFileSync(patFile, "utf8").trim();

// The same e-mails as api/seed/seed.py (EMAILS); the names here are only the IdP's display names, the app shows the
// names of its own directory.
const accounts = [];
for (const [org, label] of [
  ["a", "A"],
  ["b", "B"],
]) {
  accounts.push(
    { email: `lekar1.${org}@codebridge.demo`, given: "Lékař 1", family: `Nemocnice ${label}` },
    { email: `lekar2.${org}@codebridge.demo`, given: "Lékař 2", family: `Nemocnice ${label}` },
    { email: `koordinator.${org}@codebridge.demo`, given: "Koordinátor", family: `Nemocnice ${label}` },
    { email: `admin.${org}@codebridge.demo`, given: "Správce", family: `Nemocnice ${label}` },
  );
}

// 20 characters with every class Zitadel's default password policy asks for (upper, lower, digit, symbol).
function password() {
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!#%+-=?@_"];
  const all = sets.join("");
  const chars = sets.map((s) => s[randomInt(s.length)]);
  while (chars.length < 20) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

const lines = existsSync(outFile)
  ? readFileSync(outFile, "utf8").split("\n").filter(Boolean)
  : [`# GLIDE MDT demo accounts (Zitadel ${issuer}). Move to the password manager, then delete this file.`];
let failed = 0;
for (const a of accounts) {
  const pw = password();
  const r = await fetch(`${issuer}/v2/users/human`, {
    method: "POST",
    headers: { authorization: `Bearer ${pat}`, "content-type": "application/json" },
    body: JSON.stringify({
      username: a.email,
      organization: { orgId },
      profile: { givenName: a.given, familyName: a.family, preferredLanguage: "cs" },
      email: { email: a.email, isVerified: true },
      password: { password: pw, changeRequired: false },
    }),
  });
  const d = await r.json().catch(() => ({}));
  if (r.ok) {
    lines.push(`${a.email}\t${pw}\tuserId=${d.userId}`);
    console.log("created", a.email);
  } else if (r.status === 409 || /already exists/i.test(JSON.stringify(d))) {
    console.log("exists ", a.email, "(password unchanged)");
  } else {
    failed++;
    // The status and Zitadel's message only; the request (with the password) is never printed.
    console.log("FAILED ", a.email, r.status, String(d.message ?? "").slice(0, 200));
  }
}
// Mode 600 from the first byte, and again for a file that existed with wider rights.
writeFileSync(outFile, lines.join("\n") + "\n", { mode: 0o600 });
chmodSync(outFile, 0o600);
console.log("passwords file:", outFile);
process.exit(failed ? 1 : 0);
