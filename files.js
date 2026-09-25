// Project documents, read from and written to each customer's SharePoint library through Microsoft Graph.
// One flat list per customer. The file name carries the organization:
//   ##_CODE_CUSTOMER_Description_vN_YYYYMMDD.ext   e.g. 03_INT_BALL_Epic ADT interface spec_v2_20260925.pdf
// The server signs in to Graph as the Hub's own app registration, so customers and partners never need SharePoint access;
// the Hub decides which documents each person can see.
"use strict";
const express = require("express");
const crypto = require("crypto");

const TYPES = [
  ["01", "CON", "Contracts, quotes, POs"],
  ["02", "DES", "Design, mockups, floor plans"],
  ["03", "INT", "Integration specs"],
  ["04", "NET", "Network, VPN, site readiness"],
  ["05", "INS", "Install photos, screenshots, punch lists"],
  ["06", "TRN", "Training"],
  ["07", "APK", "App builds and release notes"],
  ["08", "GOL", "Go live and handoff"]
];
const BY_NUM = Object.fromEntries(TYPES.map(t => [t[0], t]));
// Which document types each role sees. Files that do not follow the naming convention ("unsorted") are HCI and customer only.
const ROLE_TYPES = {
  hci: null,
  customer: null,
  dealer: new Set(["02", "03", "04", "05", "06", "07", "08"]),
  partner: new Set(["03"])
};
const NAME_RE = /^(\d{2})_([A-Z]{3})_([A-Za-z0-9]+)_(.+?)_v(\d+(?:\.\d+)*)_(\d{8})(\.[^.]+)?$/;

function parseName(name) {
  const m = NAME_RE.exec(name);
  if (!m || !BY_NUM[m[1]] || BY_NUM[m[1]][1] !== m[2]) return { type: "unsorted", code: "", customer: "", desc: name, version: "", date: "" };
  return { type: m[1], code: m[2], customer: m[3], desc: m[4], version: m[5], date: m[6] };
}
function cleanDesc(s) { return String(s || "").replace(/[\\/:*?"<>|#%_]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 90); }
function fileCodeOf(p) {
  const c = String(p.fileCode || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (c) return c.slice(0, 10);
  return String(p.customer || p.name || "PROJECT").toUpperCase().replace(/[^A-Z0-9 ]/g, "").split(/\s+/)[0].slice(0, 10) || "PROJECT";
}
function today() { const d = new Date(); return d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0"); }
function canSeeType(me, t) { const s = ROLE_TYPES[me.role]; return s === null || (s && s.has(t)); }
function canUploadType(me, t) { if (me.role === "hci") return true; if (me.role === "customer") return true; return canSeeType(me, t) && t !== "unsorted"; }

module.exports = function filesRouter({ store, bump }) {
  const TENANT = process.env.GRAPH_TENANT_ID || "";
  const CLIENT = process.env.GRAPH_CLIENT_ID || "";
  const SECRET = process.env.GRAPH_CLIENT_SECRET || "";
  const configured = !!(TENANT && CLIENT && SECRET);
  let token = null, tokenExp = 0;
  const folderCache = {};   // sharepointUrl -> { driveId, itemId }

  async function graphToken() {
    if (token && Date.now() < tokenExp - 60000) return token;
    const r = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: CLIENT, client_secret: SECRET, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" })
    });
    const j = await r.json();
    if (!r.ok) throw Object.assign(new Error("Graph sign in failed: " + (j.error_description || j.error || r.status)), { status: 502 });
    token = j.access_token; tokenExp = Date.now() + (j.expires_in || 3600) * 1000;
    return token;
  }
  async function graph(method, pathOrUrl, body, headers) {
    const url = pathOrUrl.startsWith("https://") ? pathOrUrl : "https://graph.microsoft.com/v1.0" + pathOrUrl;
    const r = await fetch(url, { method, headers: Object.assign({ Authorization: "Bearer " + await graphToken() }, body && !Buffer.isBuffer(body) ? { "Content-Type": "application/json" } : {}, headers || {}), body: body ? (Buffer.isBuffer(body) ? body : JSON.stringify(body)) : undefined, redirect: "manual" });
    if (r.status === 302) return { location: r.headers.get("location") };
    const text = await r.text(); let j = {}; try { j = text ? JSON.parse(text) : {}; } catch (e) {}
    if (!r.ok) {
      const msg = (j.error && j.error.message) || r.statusText;
      const e = new Error(r.status === 403 ? "The Hub does not have permission to this SharePoint library yet (" + msg + ")" : "SharePoint said: " + msg);
      e.status = r.status === 404 ? 404 : 502; throw e;
    }
    return j;
  }
  // The project stores the library's web link; Graph turns a sharing or web link into the folder it points at.
  async function folderFor(p) {
    const url = String(p.sharepointUrl || "").trim().replace(/\/+$/, "");
    if (!url) throw Object.assign(new Error("No SharePoint library linked to this project yet"), { status: 404 });
    if (folderCache[url]) return folderCache[url];
    const enc = "u!" + Buffer.from(url).toString("base64").replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-");
    let f;
    try {
      const it = await graph("GET", `/shares/${enc}/driveItem?$select=id,parentReference,name,folder,root`);
      f = { driveId: it.parentReference.driveId, itemId: it.id };
    } catch (e) {
      // Fallback for a plain library link: https://tenant.sharepoint.com/sites/NAME/Shared Documents
      const m = /^https:\/\/([^/]+)\/(sites|teams)\/([^/]+)/i.exec(decodeURI(url));
      if (!m) throw e;
      const site = await graph("GET", `/sites/${m[1]}:/${m[2]}/${encodeURIComponent(m[3])}?$select=id`);
      const root = await graph("GET", `/sites/${site.id}/drive/root?$select=id,parentReference`);
      f = { driveId: root.parentReference.driveId, itemId: root.id };
    }
    folderCache[url] = f; return f;
  }
  function projectFor(req, res) {
    const pid = req.params.pid;
    const p = store.projects[pid];
    if (!p) { res.status(404).json({ error: "No such project" }); return null; }
    const me = req.me;
    if (me.role === "none" || (me.role !== "hci" && !(me.projects || []).includes(pid))) { res.status(403).json({ error: "Not your project" }); return null; }
    if (!configured) { res.status(503).json({ error: "SharePoint is not connected to the Hub yet", setup: true }); return null; }
    return p;
  }
  function shape(it) {
    const meta = parseName(it.name);
    return { id: it.id, name: it.name, size: it.size || 0, modified: it.lastModifiedDateTime, by: ((it.lastModifiedBy || {}).user || {}).displayName || "", webUrl: it.webUrl, mime: (it.file || {}).mimeType || "", ...meta };
  }
  async function listAll(f) {
    let url = `/drives/${f.driveId}/items/${f.itemId}/children?$top=999&$select=id,name,size,lastModifiedDateTime,lastModifiedBy,webUrl,file,folder`;
    const out = [];
    while (url) { const j = await graph("GET", url); for (const it of j.value || []) if (it.file) out.push(shape(it)); url = j["@odata.nextLink"] || ""; }
    return out;
  }
  async function itemVisible(req, p, itemId) {
    const f = await folderFor(p);
    const it = await graph("GET", `/drives/${f.driveId}/items/${encodeURIComponent(itemId)}?$select=id,name,size,lastModifiedDateTime,lastModifiedBy,webUrl,file,parentReference`);
    if (!it.parentReference || it.parentReference.id !== f.itemId) throw Object.assign(new Error("That file is not in this project's library"), { status: 404 });
    const s = shape(it);
    if (!canSeeType(req.me, s.type)) throw Object.assign(new Error("Not available to you"), { status: 403 });
    return { f, it: s };
  }
  function logFile(req, p, pid, action, title, changes) {
    store.audit[crypto.randomUUID().replace(/-/g, "").slice(0, 20)] = { projectId: pid, col: "files", docId: "", action, by: String((req.me && req.me.name) || "").slice(0, 120), email: (req.me && req.me.email) || "", at: new Date().toISOString(), title, changes: changes || [], note: "", ip: req.ip };
    bump("audit");
  }
  const wrap = fn => (req, res) => fn(req, res).catch(e => { console.error("files", e.message); res.status(e.status || 500).json({ error: e.message }); });

  const r = express.Router();
  r.get("/types", (req, res) => res.json({ types: TYPES.filter(t => canSeeType(req.me, t[0])).map(([num, code, label]) => ({ num, code, label })), configured }));

  r.get("/:pid", wrap(async (req, res) => {
    const p = projectFor(req, res); if (!p) return;
    const f = await folderFor(p);
    const files = (await listAll(f)).filter(x => canSeeType(req.me, x.type)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    res.json({ files, fileCode: fileCodeOf(p), canUpload: true, canRename: req.me.role === "hci", library: req.me.role === "hci" ? p.sharepointUrl : "" });
  }));

  // An embeddable viewer link for Office documents, PDFs and images. It expires after a short while, so the page asks each time.
  r.post("/:pid/preview/:item", wrap(async (req, res) => {
    const p = projectFor(req, res); if (!p) return;
    const { f, it } = await itemVisible(req, p, req.params.item);
    const j = await graph("POST", `/drives/${f.driveId}/items/${it.id}/preview`, { viewer: "onedrive", allowEdit: false, chromeless: false });
    res.json({ url: j.getUrl || "", name: it.name });
  }));

  r.get("/:pid/download/:item", wrap(async (req, res) => {
    const p = projectFor(req, res); if (!p) return;
    const { f, it } = await itemVisible(req, p, req.params.item);
    const j = await graph("GET", `/drives/${f.driveId}/items/${it.id}?$select=id,@microsoft.graph.downloadUrl`);
    const u = j["@microsoft.graph.downloadUrl"];
    if (!u) return res.status(404).json({ error: "No download link" });
    if (req.query.json) return res.json({ url: u, name: it.name });
    res.redirect(u);
  }));

  // Upload: the body is the raw file. The server builds the name from the type and description and bumps the version.
  r.post("/:pid/upload", express.raw({ type: () => true, limit: "240mb" }), wrap(async (req, res) => {
    const p = projectFor(req, res); if (!p) return;
    const t = BY_NUM[String(req.query.type || "")];
    if (!t) return res.status(400).json({ error: "Pick a document type" });
    if (!canUploadType(req.me, t[0])) return res.status(403).json({ error: "You cannot add that type of document" });
    const desc = cleanDesc(req.query.desc);
    if (!desc) return res.status(400).json({ error: "Add a short description" });
    const orig = String(req.query.filename || "");
    const ext = (/\.[A-Za-z0-9]{1,8}$/.exec(orig) || [""])[0].toLowerCase();
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: "The file is empty" });
    const f = await folderFor(p);
    const code = fileCodeOf(p);
    const existing = await listAll(f);
    const same = existing.filter(x => x.type === t[0] && x.customer === code && x.desc.toLowerCase() === desc.toLowerCase());
    let v = String(req.query.version || "").replace(/[^0-9.]/g, "");
    if (!v) v = String(same.reduce((m, x) => Math.max(m, parseInt(x.version, 10) || 0), 0) + 1);
    const name = `${t[0]}_${t[1]}_${code}_${desc}_v${v}_${today()}${ext}`;
    const it = await graph("PUT", `/drives/${f.driveId}/items/${f.itemId}:/${encodeURIComponent(name)}:/content?@microsoft.graph.conflictBehavior=rename`, req.body, { "Content-Type": "application/octet-stream" });
    logFile(req, p, req.params.pid, "create", "Document · " + it.name, []);
    res.json({ file: shape(it) });
  }));

  // HCI only: give an existing file a name that follows the convention.
  r.post("/:pid/rename/:item", express.json(), wrap(async (req, res) => {
    const p = projectFor(req, res); if (!p) return;
    if (req.me.role !== "hci") return res.status(403).json({ error: "Only HCI can rename documents" });
    const { f, it } = await itemVisible(req, p, req.params.item);
    const t = BY_NUM[String((req.body || {}).type || "")];
    const desc = cleanDesc((req.body || {}).desc);
    if (!t || !desc) return res.status(400).json({ error: "Pick a type and add a description" });
    const v = String((req.body || {}).version || "1").replace(/[^0-9.]/g, "") || "1";
    const date = String((req.body || {}).date || "").replace(/[^0-9]/g, "").slice(0, 8) || (it.modified || "").slice(0, 10).replace(/-/g, "") || today();
    const ext = (/\.[A-Za-z0-9]{1,8}$/.exec(it.name) || [""])[0].toLowerCase();
    const name = `${t[0]}_${t[1]}_${fileCodeOf(p)}_${desc}_v${v}_${date}${ext}`;
    const out = await graph("PATCH", `/drives/${f.driveId}/items/${it.id}?@microsoft.graph.conflictBehavior=rename`, { name });
    logFile(req, p, req.params.pid, "update", "Document · " + out.name, [{ field: "name", from: it.name, to: out.name }]);
    res.json({ file: shape(out) });
  }));

  return r;
};
module.exports.parseName = parseName;
module.exports.TYPES = TYPES;
