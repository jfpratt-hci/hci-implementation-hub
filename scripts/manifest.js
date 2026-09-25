// Writes manifest/manifest.json for the host you deploy to and zips the Teams app package.
// Usage: HOST=hub.hci-tv.com npm run manifest   (or: node scripts/manifest.js hub.hci-tv.com)
"use strict";
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const crypto = require("crypto");
const root = path.join(__dirname, "..");
const host = (process.argv[2] || process.env.HOST || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
if (!host) { console.error("Give the host name the Hub is served from, for example: node scripts/manifest.js hub.hci-tv.com"); process.exit(1); }
const idFile = path.join(root, "manifest", ".appid");
const appId = fs.existsSync(idFile) ? fs.readFileSync(idFile, "utf8").trim() : crypto.randomUUID();
fs.writeFileSync(idFile, appId);
const entra = (process.env.ENTRA_APP_ID || "").trim();
const tpl = JSON.parse(fs.readFileSync(path.join(root, "manifest", "manifest.template.json"), "utf8"));
if (!entra) delete tpl.webApplicationInfo;   // no Entra app registration yet: the tab works without single sign on
let text = JSON.stringify(tpl, null, 2).replace(/__APP_ID__/g, appId).replace(/__HOST__/g, host).replace(/__ENTRA_APP_ID__/g, entra);
fs.writeFileSync(path.join(root, "manifest", "manifest.json"), text);
fs.mkdirSync(path.join(root, "dist"), { recursive: true });
const out = path.join(root, "dist", "hci-implementation-hub-teams-app.zip");
try { fs.unlinkSync(out); } catch (e) {}
try {
  execSync(`cd "${path.join(root, "manifest")}" && zip -q "${out}" manifest.json color.png outline.png`);
  console.log(`Teams app package for ${host}: ${out}`);
} catch (e) {
  console.log(`manifest/manifest.json written for ${host}. Zip manifest.json, color.png and outline.png together to sideload (the zip command was not available).`);
}
