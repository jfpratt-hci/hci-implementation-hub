// HCI Implementation Hub, Teams app server
// One process serves the Hub page, the Teams tab configuration page, a small JSON API
// and uploaded screenshots. Data lives in ./data as one JSON file per collection.
"use strict";
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.HUB_DATA_DIR || path.join(__dirname, "data");
const UPLOAD_DIR = process.env.HUB_UPLOAD_DIR || path.join(__dirname, "uploads");
const COLS = ["projects","tasks","decisions","meetings","interfaces","people","devices","releases","deployments","components","catalog","access","network","template","team","shots","comments","audit"];
const MIME = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif" };
// Identity. With REQUIRE_AUTH on, every /api call needs a signed in user from App Service Authentication (Entra ID).
const REQUIRE_AUTH = /^(1|true|yes)$/i.test(process.env.REQUIRE_AUTH || "");
const HCI_DOMAINS = (process.env.HCI_DOMAINS || "hci-tv.com,hcic.com").toLowerCase().split(",").map(x => x.trim()).filter(Boolean);
const LOGIN_PATH = process.env.LOGIN_PATH || "/.auth/login/aad";
const LOGOUT_PATH = process.env.LOGOUT_PATH || "/.auth/logout";

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
// First run on a fresh host: seed the data directory from the copy shipped with the code.
const SEED_DIR = path.join(__dirname, "data");
if (path.resolve(SEED_DIR) !== path.resolve(DATA_DIR) && !fs.existsSync(path.join(DATA_DIR, "projects.json")) && fs.existsSync(SEED_DIR)) {
  for (const f of fs.readdirSync(SEED_DIR)) if (f.endsWith(".json")) fs.copyFileSync(path.join(SEED_DIR, f), path.join(DATA_DIR, f));
  console.log("seeded", DATA_DIR, "from", SEED_DIR);
}

// ---- store ----
const store = {};      // col -> { id -> doc }
const versions = {};   // col -> integer, bumps on every change
let version = 0;       // global, bumps on every change
for (const col of COLS) {
  const file = path.join(DATA_DIR, col + ".json");
  try { store[col] = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { store[col] = {}; }
  versions[col] = 1;
}
const dirty = new Set();
let flushTimer = null;
function persist(col) {
  dirty.add(col);
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    for (const c of dirty) {
      const file = path.join(DATA_DIR, c + ".json");
      fs.writeFile(file + ".tmp", JSON.stringify(store[c], null, 1), err => {
        if (err) return console.error("persist", c, err);
        fs.rename(file + ".tmp", file, e => e && console.error("persist", c, e));
      });
    }
    dirty.clear();
  }, 250);
}
function bump(col) { versions[col]++; version++; persist(col); }

// ---- audit: every create, change and delete, recorded by the server ----
const AUDIT_SKIP = new Set(["audit", "comments"]);
const SKIPF = new Set(["updatedAt", "createdAt", "history", "order"]);
const DEVTYPES = { "Door Sign": "Door sign", "Whiteboard": "Whiteboard", "Patient TV": "Patient TV", "Unit Status Board": "Unit status board", "Camera": "Camera", "Server": "Server", "Workstation": "Workstation" };
function titleOf(col, d) {
  d = d || {};
  if (col === "tasks" || col === "meetings" || col === "template") return d.title || "";
  if (col === "decisions") return d.question || "";
  if (col === "interfaces") return d.system || "";
  if (col === "devices") return "Room " + (d.room || "") + " " + (DEVTYPES[d.type] || d.type || "");
  if (col === "components") return ((store.catalog || {})[d.catalogId] || {}).name || d.catalogId || "Component";
  if (col === "releases" || col === "deployments") return (d.app || "") + " " + (d.version || "");
  if (col === "shots") return "Screenshot" + (d.caption ? " · " + d.caption : "");
  return d.name || col;
}
function diffDocs(a, b) {
  const out = []; const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const k of keys) {
    if (SKIPF.has(k)) continue;
    const x = a ? a[k] : undefined, y = b ? b[k] : undefined;
    if (JSON.stringify(x ?? "") !== JSON.stringify(y ?? "")) out.push({ field: k, from: x ?? "", to: y ?? "" });
  }
  return out;
}
function audit(req, col, id, action, before, after) {
  if (AUDIT_SKIP.has(col)) return;
  const doc = after || before || {};
  const changes = action === "update" ? diffDocs(before, after) : [];
  if (action === "update" && !changes.length) return;
  const entry = { projectId: doc.projectId || (col === "projects" ? id : ""), col, docId: id, action, by: String((req.me && !req.me.dev && req.me.name) || req.get("x-hub-user") || "").slice(0, 120), email: (req.me && req.me.email) || "", at: new Date().toISOString(), title: titleOf(col, doc), changes: changes.slice(0, 40), note: String(req.get("x-hub-note") || "").slice(0, 200), ip: req.ip };
  store.audit[crypto.randomUUID().replace(/-/g, "").slice(0, 20)] = entry;
  bump("audit");
}
function okCol(col) { return COLS.includes(col); }
function isObj(v) { return v && typeof v === "object" && !Array.isArray(v); }

// ---- app ----
const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  // Teams loads tabs in an iframe; allow framing by Teams and by nothing else.
  res.setHeader("Content-Security-Policy", "frame-ancestors 'self' https://teams.microsoft.com https://*.teams.microsoft.com https://*.office.com https://*.microsoft365.com https://*.cloud.microsoft https://*.skype.com https://*.sharepoint.com");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});
app.use(express.json({ limit: "2mb" }));

// ---- who is calling ----
// App Service Authentication validates the Entra session cookie or a bearer token (Teams single sign on)
// and passes the result in these headers. Nothing else can set them from outside.
function principal(req) {
  // Browser sign in puts the email here; a Teams token puts the display name here instead, so fall back to the claims.
  let email = String(req.get("x-ms-client-principal-name") || "").toLowerCase();
  let display = "";
  const raw = req.get("x-ms-client-principal");
  if (raw) {
    try {
      const claims = (JSON.parse(Buffer.from(raw, "base64").toString("utf8")).claims || []);
      const get = t => (claims.find(c => c.typ === t) || {}).val;
      if (!email.includes("@")) {
        if (email && !display) display = String(req.get("x-ms-client-principal-name") || "");
        email = String(get("preferred_username") || get("upn") || get("email") ||
          get("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn") ||
          get("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress") || "").toLowerCase();
      }
      display = get("name") || [get("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname"), get("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname")].filter(Boolean).join(" ") || "";
    } catch (e) {}
  }
  if (!email.includes("@")) email = "";
  if (!email) {
    if (REQUIRE_AUTH) return null;
    // Local development without authentication: trust the name the page sends.
    return { email: "", name: String(req.get("x-hub-user") || ""), role: "hci", projects: null, dev: true };
  }
  const domain = email.split("@")[1] || "";
  const onTeam = Object.values(store.team || {}).some(t => String(t.email || "").toLowerCase() === email);
  if (onTeam || HCI_DOMAINS.includes(domain)) return { email, name: display || email, role: "hci", projects: null };
  const people = Object.values(store.people || {}).filter(p => String(p.email || "").toLowerCase() === email);
  if (!people.length) return { email, name: display || email, role: "none", projects: [] };
  return { email, name: display || people[0].name || email, role: people[0].party || "customer", projects: [...new Set(people.map(p => p.projectId))] };
}
const NET_FIELDS = ["mac", "ip", "vlan", "hostname"];
function commentVisible(me, c) {
  if (c.visibility === "internal") return false;
  if (c.recordType === "projects") return me.role !== "partner";
  const rec = (store[c.recordType] || {})[c.recordId];
  if (!rec) return false;
  if (me.role === "partner") return (c.recordType === "tasks" && rec.party === "partner") || c.recordType === "interfaces";
  if (rec.visibility === "internal") return false;
  if (me.role === "dealer" && (c.recordType === "access" || c.recordType === "network")) return false;
  return true;
}
// The same visibility rules the page shows in "Preview as", enforced where it counts.
function canSee(me, col, doc) {
  if (me.role === "hci") return true;
  if (me.role === "none") return false;
  if (col === "catalog") return true;
  if (col === "audit" || col === "template" || col === "team") return false;
  if (col === "releases") return me.role !== "partner";
  if (!me.projects.includes(col === "projects" ? doc.__id : doc.projectId)) return false;
  if (doc.visibility === "internal") return false;
  if (col === "comments") return commentVisible(me, doc);
  if (me.role === "partner") return col === "projects" || col === "interfaces" || col === "people" || (col === "tasks" && doc.party === "partner");
  if (col === "access" || col === "network") return me.role === "customer";
  if (col === "shots" || col === "deployments") return me.role !== "partner";
  return true;
}
function viewFor(me) {
  if (me.role === "hci") return store;
  const out = {};
  for (const col of COLS) {
    out[col] = {};
    for (const [id, doc] of Object.entries(store[col])) {
      if (!canSee(me, col, Object.assign({ __id: id }, doc))) continue;
      let d = doc;
      if (col === "devices" && me.role !== "customer") { d = Object.assign({}, doc); for (const k of NET_FIELDS) delete d[k]; }
      if (col === "projects") { d = Object.assign({}, doc); delete d.hubspot; }
      out[col][id] = d;
    }
  }
  return out;
}
function canWrite(me, col, id, body) {
  if (col === "audit") return false;
  if (me.role === "hci") return true;
  if (me.role === "none") return false;
  const existing = store[col][id];
  const pid = body ? body.projectId : existing && existing.projectId;
  if (!pid || !me.projects.includes(pid) || (existing && existing.projectId !== pid)) return false;
  if (col === "comments") return true;
  if (me.role === "partner") return (col === "tasks" && (body || existing || {}).party === "partner") || col === "interfaces";
  return col === "tasks" || col === "decisions" || col === "shots";
}
app.use("/api", (req, res, next) => {
  const me = principal(req);
  if (!me) return res.status(401).json({ error: "Sign in to use the Hub", login: LOGIN_PATH + "?post_login_redirect_uri=" + encodeURIComponent(req.get("referer") || "/") });
  req.me = me;
  next();
});
app.get("/api/me", (req, res) => {
  const me = req.me;
  res.json({ email: me.email, name: me.name, role: me.role, projects: me.projects, dev: !!me.dev, logout: me.dev ? "" : LOGOUT_PATH });
});
// SharePoint documents for each project (see files.js)
app.use("/api/files", require("./files")({ store, bump }));
app.use("/api/:col", (req, res, next) => {
  if (req.method === "GET" || req.params.col === "all" || req.params.col === "me" || req.params.col === "upload") return next();
  if (!okCol(req.params.col)) return res.status(404).json({ error: "unknown collection" });
  const id = req.path.split("/")[1] ? decodeURIComponent(req.path.split("/")[1]) : null;
  if (!canWrite(req.me, req.params.col, id, isObj(req.body) ? req.body : null)) return res.status(403).json({ error: "You cannot change that" });
  if (!req.me.dev && isObj(req.body) && req.params.col === "comments") req.body.by = req.me.name;
  next();
});

// Snapshot of every collection. ?since=<version> returns only {version} when nothing changed.
app.get("/api/all", (req, res) => {
  const since = Number(req.query.since || 0);
  if (since && since === version) return res.json({ version, unchanged: true });
  res.json({ version, versions, cols: viewFor(req.me) });
});

app.get("/api/:col", (req, res) => {
  const { col } = req.params;
  if (!okCol(col)) return res.status(404).json({ error: "unknown collection" });
  res.json({ version: versions[col], docs: viewFor(req.me)[col] });
});

app.post("/api/:col", (req, res) => {
  const { col } = req.params;
  if (!okCol(col)) return res.status(404).json({ error: "unknown collection" });
  if (!isObj(req.body)) return res.status(400).json({ error: "body must be an object" });
  if (col === "audit") return res.status(403).json({ error: "the server writes the audit trail" });
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  store[col][id] = req.body;
  bump(col);
  audit(req, col, id, "create", null, req.body);
  res.json({ id, version: versions[col] });
});

app.put("/api/:col/:id", (req, res) => {
  const { col, id } = req.params;
  if (!okCol(col)) return res.status(404).json({ error: "unknown collection" });
  if (!isObj(req.body)) return res.status(400).json({ error: "body must be an object" });
  if (col === "audit") return res.status(403).json({ error: "the audit trail is read only" });
  const before = store[col][id] ? JSON.parse(JSON.stringify(store[col][id])) : null;
  store[col][id] = req.body;
  bump(col);
  audit(req, col, id, before ? "update" : "create", before, req.body);
  res.json({ id, version: versions[col] });
});

app.patch("/api/:col/:id", (req, res) => {
  const { col, id } = req.params;
  if (!okCol(col)) return res.status(404).json({ error: "unknown collection" });
  if (!store[col][id]) return res.status(404).json({ error: "no such document" });
  if (!isObj(req.body)) return res.status(400).json({ error: "body must be an object" });
  if (col === "audit") return res.status(403).json({ error: "the audit trail is read only" });
  const before = JSON.parse(JSON.stringify(store[col][id]));
  Object.assign(store[col][id], req.body);
  bump(col);
  audit(req, col, id, "update", before, store[col][id]);
  res.json({ id, version: versions[col] });
});

app.delete("/api/:col/:id", (req, res) => {
  const { col, id } = req.params;
  if (!okCol(col)) return res.status(404).json({ error: "unknown collection" });
  if (col === "audit") return res.status(403).json({ error: "the audit trail is read only" });
  const before = store[col][id] ? JSON.parse(JSON.stringify(store[col][id])) : null;
  delete store[col][id];
  bump(col);
  if (before) audit(req, col, id, "delete", before, null);
  res.json({ ok: true });
});

// Screenshots. Body is the raw image; served back at /_blob/<id> like the Claude version.
app.post("/api/upload", express.raw({ type: ["image/*"], limit: "20mb" }), (req, res) => {
  if (req.me.role === "none" || req.me.role === "partner") return res.status(403).json({ error: "You cannot upload here" });
  const type = (req.headers["content-type"] || "").split(";")[0].trim();
  const ext = MIME[type];
  if (!ext || !Buffer.isBuffer(req.body) || !req.body.length) return res.status(415).json({ error: "send a PNG, JPEG, WebP or GIF" });
  const id = crypto.randomBytes(16).toString("hex");
  fs.writeFileSync(path.join(UPLOAD_DIR, id + ext), req.body);
  res.json({ id, url: "/_blob/" + id, sizeBytes: req.body.length, contentType: type });
});
app.delete("/api/upload/:id", (req, res) => {
  if (req.me.role !== "hci") return res.status(403).json({ error: "Only HCI can remove screenshots" });
  const id = String(req.params.id).replace(/[^a-f0-9]/g, "");
  for (const ext of Object.values(MIME)) { try { fs.unlinkSync(path.join(UPLOAD_DIR, id + ext)); } catch (e) {} }
  res.json({ ok: true });
});
app.get("/_blob/:id", (req, res) => {
  const id = String(req.params.id).replace(/[^a-f0-9]/g, "");
  for (const ext of Object.values(MIME)) {
    const f = path.join(UPLOAD_DIR, id + ext);
    if (fs.existsSync(f)) return res.sendFile(f, { maxAge: "365d", immutable: true });
  }
  res.status(404).end();
});

app.use("/teams-js", express.static(path.join(__dirname, "node_modules/@microsoft/teams-js/dist/umd"), { maxAge: "7d" }));
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));
app.get("/healthz", (req, res) => res.json({ ok: true, version }));

app.listen(PORT, () => console.log(`HCI Implementation Hub listening on http://localhost:${PORT}`));
