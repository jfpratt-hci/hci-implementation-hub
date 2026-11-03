// Daily Update board for the Hub.
// Step 2: the board's tasks stay in the Supabase tables the standalone page uses, and the Hub reads and writes them
// through this module, so the Hub and the standalone page always show the same cards.
// Step 3: set DAILY_BACKEND=local and the tasks live in the Hub's own store (collection dailyTasks) with no Supabase.
// Either way the Hub server records who did what in the audit trail, taken from the Microsoft sign in.
"use strict";
const express = require("express");
const crypto = require("crypto");

const SUPA_URL = (process.env.DAILY_SUPABASE_URL || "https://yiccxfqhctcmepcrdlzi.supabase.co").replace(/\/$/, "") + "/rest/v1/";
// The anon key is the same public key the standalone page already carries; row level security limits it to the two board tables.
const SUPA_KEY = process.env.DAILY_SUPABASE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpY2N4ZnFoY3RjbWVwY3JkbHppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE2OTM2ODcsImV4cCI6MjEwNzI2OTY4N30.JCU8DOCq_Z1jNu4FX9lrLu3q3-kydCiPsTqkIIdHzPQ";
const BACKEND = () => (process.env.DAILY_BACKEND || "supabase").toLowerCase();
const LANES = ["john", "greg", "arpan", "li", "waiting"];

const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 20);
const clean = (v, n) => String(v == null ? "" : v).slice(0, n || 400);
const iso = () => new Date().toISOString();

module.exports = function ({ store, bump, audit }) {
  // ---- storage backends. Every task leaves here as {id,text,owner,hospital,done,doneAt,source,sourceDate,createdAt,comments} ----
  function fromRow(r) {
    return { id: r.id, text: r.text || "", owner: r.owner || "john", hospital: r.hospital || "General", done: !!r.done, doneAt: r.done_at || "", source: r.source || "", sourceDate: r.source_date || "", createdAt: r.created_at || "", comments: Array.isArray(r.comments) ? r.comments : [] };
  }
  function toRow(t) {
    const o = {};
    if ("text" in t) o.text = t.text;
    if ("owner" in t) o.owner = t.owner;
    if ("hospital" in t) o.hospital = t.hospital;
    if ("done" in t) o.done = !!t.done;
    if ("doneAt" in t) o.done_at = t.doneAt || null;
    if ("source" in t) o.source = t.source;
    if ("sourceDate" in t) o.source_date = t.sourceDate;
    if ("createdAt" in t) o.created_at = t.createdAt;
    if ("comments" in t) o.comments = t.comments;
    return o;
  }
  async function supa(method, path, body, prefer) {
    const key = SUPA_KEY || process.env.DAILY_SUPABASE_ANON || "";
    if (!key) { const e = new Error("The Daily Update database key is not set (DAILY_SUPABASE_KEY)"); e.status = 503; throw e; }
    const h = { apikey: key, Authorization: "Bearer " + key };
    if (body !== undefined) h["Content-Type"] = "application/json";
    if (prefer) h.Prefer = prefer;
    const r = await fetch(SUPA_URL + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!r.ok) { const e = new Error("Database " + r.status + " " + (await r.text()).slice(0, 200)); e.status = 502; throw e; }
    const txt = await r.text();
    return txt ? JSON.parse(txt) : null;
  }
  const supabaseBackend = {
    async list() {
      const [rows, meta] = await Promise.all([supa("GET", "daily_board_tasks?select=*&order=created_at.asc"), supa("GET", "daily_board_meta?id=eq.sync&select=*")]);
      const m = (meta && meta[0]) || {};
      return { tasks: (rows || []).map(fromRow), meta: { lastMeeting: m.last_meeting || "", lastRun: m.last_run || "" } };
    },
    async get(id) { const r = await supa("GET", "daily_board_tasks?id=eq." + encodeURIComponent(id) + "&select=*"); return r && r[0] ? fromRow(r[0]) : null; },
    async create(t) { const r = await supa("POST", "daily_board_tasks", [Object.assign({ id: t.id }, toRow(t))], "return=representation"); return fromRow(r[0]); },
    async update(id, patch) { await supa("PATCH", "daily_board_tasks?id=eq." + encodeURIComponent(id), toRow(patch)); },
    async remove(id) { await supa("DELETE", "daily_board_tasks?id=eq." + encodeURIComponent(id)); },
    async setMeta(m) { await supa("PATCH", "daily_board_meta?id=eq.sync", { last_meeting: m.lastMeeting, last_run: m.lastRun }); }
  };
  function localCol() { return (store.dailyTasks = store.dailyTasks || {}); }
  function localMeta() { return (store.dailyMeta = store.dailyMeta || {}); }
  const localBackend = {
    async list() { const c = localCol(); const m = localMeta().sync || {}; return { tasks: Object.entries(c).map(([id, t]) => Object.assign({ id }, t)), meta: { lastMeeting: m.lastMeeting || "", lastRun: m.lastRun || "" } }; },
    async get(id) { const t = localCol()[id]; return t ? Object.assign({ id }, t) : null; },
    async create(t) { const id = t.id; const d = Object.assign({}, t); delete d.id; localCol()[id] = d; bump("dailyTasks"); return Object.assign({ id }, d); },
    async update(id, patch) { Object.assign(localCol()[id], patch); bump("dailyTasks"); },
    async remove(id) { delete localCol()[id]; bump("dailyTasks"); },
    async setMeta(m) { localMeta().sync = { lastMeeting: m.lastMeeting, lastRun: m.lastRun }; bump("dailyMeta"); }
  };
  const be = () => (BACKEND() === "local" ? localBackend : supabaseBackend);

  // A hospital tag that matches a Hub project ties the card to that project, so the card's changes show in the project's History.
  const ALIASES = { "good sam": "good samaritan", "schneider (srmc)": "schneider", "ball health": "ball health" };
  function projectFor(hospital) {
    const h = String(hospital || "").toLowerCase().trim();
    if (!h || h === "general") return "";
    const key = ALIASES[h] || h;
    for (const [id, p] of Object.entries(store.projects || {})) {
      const hay = [p.name, p.customer, p.site].join(" ").toLowerCase();
      if (hay.includes(key)) return id;
    }
    return "";
  }
  function note(req, action, before, after, extra) {
    const doc = after || before || {};
    const pid = projectFor(doc.hospital);
    const changes = [];
    if (action === "update") for (const k of Object.keys(after || {})) {
      if (["comments", "createdAt", "doneAt"].includes(k)) continue;
      if (JSON.stringify((before || {})[k] ?? "") !== JSON.stringify(after[k] ?? "")) changes.push({ field: k, from: (before || {})[k] ?? "", to: after[k] ?? "" });
    }
    if (action === "update" && !changes.length && !extra) return;
    const me = req.me || {};
    store.audit[newId()] = { projectId: pid, col: "daily", docId: doc.id || "", action, by: clean(me.dev ? req.get("x-hub-user") : me.name, 120), email: me.email || "", at: iso(), title: "Daily Update: " + clean(doc.text, 90), changes: changes.slice(0, 20), note: extra || "", ip: req.ip };
    bump("audit");
  }
  function guard(req, res, next) {
    if (!req.me || req.me.role !== "hci") return res.status(403).json({ error: "The Daily Update board is for the HCI team" });
    next();
  }
  const wrap = fn => (req, res) => fn(req, res).catch(e => res.status(e.status || 500).json({ error: e.message }));

  const r = express.Router();
  r.use(guard);
  r.get("/", wrap(async (req, res) => {
    const out = await be().list();
    out.tasks.forEach(t => { t.projectId = projectFor(t.hospital); });
    out.backend = BACKEND();
    out.me = { name: req.me.dev ? clean(req.get("x-hub-user"), 80) : req.me.name };
    out.projects = Object.entries(store.projects || {}).map(([id, p]) => ({ id, name: p.name, customer: p.customer || "" }));
    res.json(out);
  }));
  r.post("/tasks", wrap(async (req, res) => {
    const b = req.body || {};
    const text = clean(b.text, 500).trim();
    if (!text) return res.status(400).json({ error: "Write the task first" });
    const t = { id: newId(), text, owner: clean(b.owner || "john", 40).toLowerCase(), hospital: clean(b.hospital || "General", 80), done: false, doneAt: "", source: "Added in the Hub", sourceDate: iso().slice(0, 10), createdAt: iso(), comments: [] };
    const made = await be().create(t);
    note(req, "create", null, made);
    res.json(made);
  }));
  r.patch("/tasks/:id", wrap(async (req, res) => {
    const before = await be().get(req.params.id);
    if (!before) return res.status(404).json({ error: "No such task" });
    const b = req.body || {}, patch = {};
    if ("text" in b) patch.text = clean(b.text, 500);
    if ("owner" in b) patch.owner = clean(b.owner, 40).toLowerCase();
    if ("hospital" in b) patch.hospital = clean(b.hospital, 80) || "General";
    if ("done" in b) { patch.done = !!b.done; patch.doneAt = b.done ? iso() : ""; }
    if (!Object.keys(patch).length) return res.status(400).json({ error: "Nothing to change" });
    await be().update(req.params.id, patch);
    const after = Object.assign({}, before, patch);
    note(req, "update", before, after);
    res.json(after);
  }));
  r.post("/tasks/:id/comments", wrap(async (req, res) => {
    const before = await be().get(req.params.id);
    if (!before) return res.status(404).json({ error: "No such task" });
    const text = clean((req.body || {}).text, 1000).trim();
    if (!text) return res.status(400).json({ error: "Write a comment first" });
    const name = req.me.dev ? clean(req.get("x-hub-user"), 80) || "Someone" : req.me.name;
    const comments = (before.comments || []).concat([{ id: newId(), name, text, at: iso() }]);
    await be().update(req.params.id, { comments });
    note(req, "update", before, Object.assign({}, before, { comments }), "Comment: " + clean(text, 120));
    res.json({ comments });
  }));
  r.delete("/tasks/:id", wrap(async (req, res) => {
    const before = await be().get(req.params.id);
    if (!before) return res.json({ ok: true });
    await be().remove(req.params.id);
    note(req, "delete", before, null);
    res.json({ ok: true });
  }));
  // Step 3 cutover: copy every card from Supabase into the Hub's own store, once. Run it, then set DAILY_BACKEND=local.
  r.post("/import-from-supabase", wrap(async (req, res) => {
    const { tasks, meta } = await supabaseBackend.list();
    let n = 0;
    for (const t of tasks) { if (!localCol()[t.id]) { const d = Object.assign({}, t); delete d.id; localCol()[t.id] = d; n++; } }
    localMeta().sync = { lastMeeting: meta.lastMeeting, lastRun: meta.lastRun };
    bump("dailyTasks"); bump("dailyMeta");
    res.json({ imported: n, total: Object.keys(localCol()).length });
  }));

  // The morning refresh adds new cards here once the Hub is the only home. A shared token proves the caller, as there is no browser sign in.
  const hooks = express.Router();
  hooks.use(express.json({ limit: "1mb" }));
  hooks.post("/daily", wrap(async (req, res) => {
    const token = process.env.DAILY_INGEST_TOKEN || "";
    const got = String(req.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const ok = token && got.length === token.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(token));
    if (!ok) return res.status(401).json({ error: "Not allowed" });
    const b = req.body || {};
    let added = 0;
    for (const x of Array.isArray(b.tasks) ? b.tasks.slice(0, 100) : []) {
      const id = clean(x.id, 60) || newId();
      if (await be().get(id)) continue;
      await be().create({ id, text: clean(x.text, 500), owner: LANES.includes(String(x.owner).toLowerCase()) ? String(x.owner).toLowerCase() : "john", hospital: clean(x.hospital || "General", 80), done: false, doneAt: "", source: clean(x.source, 120), sourceDate: clean(x.sourceDate, 20), createdAt: iso(), comments: [] });
      added++;
    }
    if (b.lastMeeting) await be().setMeta({ lastMeeting: clean(b.lastMeeting, 40), lastRun: iso() });
    res.json({ added });
  }));

  return { router: r, hooks };
};
