// Daily Update inbox for the Hub.
// The 9:15 AM refresh adds new action items from the Granola Daily Update notes to the Supabase tables daily_board_tasks and daily_board_meta.
// This module pulls every card it has not seen yet into the Hub's own task list (the same list as each project's Plan tab),
// so the Hub is the one home for the work. A card is imported once; after that the Hub copy is the only one that counts.
// Cards whose hospital tag matches a Hub project are filed on that project. Everything is HCI only (visibility internal).
"use strict";
const crypto = require("crypto");

const SUPA_URL = (process.env.DAILY_SUPABASE_URL || "https://yiccxfqhctcmepcrdlzi.supabase.co").replace(/\/$/, "") + "/rest/v1/";
// Public anon key (the same one the standalone page carries); row level security limits it to the two board tables.
const SUPA_KEY = process.env.DAILY_SUPABASE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpY2N4ZnFoY3RjbWVwY3JkbHppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE2OTM2ODcsImV4cCI6MjEwNzI2OTY4N30.JCU8DOCq_Z1jNu4FX9lrLu3q3-kydCiPsTqkIIdHzPQ";
const EVERY_MS = 3 * 60 * 1000;
const ALIASES = { "good sam": "good samaritan", "schneider (srmc)": "schneider" };
const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 20);
const clip = (v, n) => String(v == null ? "" : v).slice(0, n || 400);

module.exports = function ({ store, bump, audit }) {
  const fakeReq = { me: { name: "Daily Update sync", email: "" }, get: () => "", ip: "" };
  let running = false, warned = false;

  // ---- customers: one per hospital or organisation; a customer has projects, a project has tasks
  const slug = n => String(n || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || newId();
  function customerNamed(name) {
    const h = String(name || "").toLowerCase().trim();
    if (!h || h === "general") return "";
    const key = ALIASES[h] || h;
    for (const [id, c] of Object.entries(store.customers)) {
      const n = String(c.name || "").toLowerCase();
      if (n === h || n.includes(key) || key.includes(n)) return id;
    }
    return "";
  }
  function ensureCustomer(name) {
    const nm = clip(name, 80).trim();
    if (!nm || nm.toLowerCase() === "general") return "";
    let id = customerNamed(nm);
    if (id) return id;
    id = slug(nm); while (store.customers[id]) id += "-2";
    store.customers[id] = { name: nm, contact: "", notes: "", createdAt: new Date().toISOString() };
    bump("customers");
    return id;
  }
  function migrate() {
    let ch = false;
    for (const [id, p] of Object.entries(store.projects || {})) {
      if (p.customerId && store.customers[p.customerId]) continue;
      const cid = ensureCustomer(p.customer || p.name); if (cid) { p.customerId = cid; ch = true; }
    }
    if (ch) bump("projects");
    let tc = false;
    for (const t of Object.values(store.tasks || {})) {
      if (t.customerId) continue;
      const p = t.projectId && store.projects[t.projectId];
      const cid = p ? p.customerId : (t.source ? ensureCustomer(t.hospital) : "");
      if (cid) { t.customerId = cid; tc = true; }
    }
    if (tc) bump("tasks");
  }
  function projectFor(hospital) {
    const h = String(hospital || "").toLowerCase().trim();
    if (!h || h === "general") return "";
    const key = ALIASES[h] || h;
    for (const [id, p] of Object.entries(store.projects || {})) {
      if ([p.name, p.customer, p.site].join(" ").toLowerCase().includes(key)) return id;
    }
    return "";
  }
  function ownerFor(lane) {
    const l = String(lane || "john").toLowerCase();
    for (const t of Object.values(store.team || {})) if (String(t.name || "").toLowerCase().split(/\s+/)[0] === l) return t.name;
    return l.charAt(0).toUpperCase() + l.slice(1);
  }
  async function supa(path) {
    const r = await fetch(SUPA_URL + path, { headers: { apikey: SUPA_KEY, Authorization: "Bearer " + SUPA_KEY } });
    if (!r.ok) throw new Error("Daily Update inbox " + r.status);
    return r.json();
  }
  function toTask(row) {
    const waiting = String(row.owner || "").toLowerCase() === "waiting";
    let pid = projectFor(row.hospital);
    let cid = pid ? (store.projects[pid].customerId || "") : ensureCustomer(row.hospital);
    if (!pid && cid) { const mine = Object.entries(store.projects).filter(([, p]) => p.customerId === cid); if (mine.length === 1) pid = mine[0][0]; }
    const proj = pid ? store.projects[pid] : null;
    const text = clip(row.text, 500);
    // "Rauland: Crawford care team data" names who the card is waiting on; keep that as the third party.
    const colon = waiting ? text.indexOf(":") : -1;
    const waitName = colon > 0 && colon < 40 ? text.slice(0, colon) : "";
    return {
      projectId: pid, customerId: cid, title: text,
      owner: waiting ? ownerFor("john") : ownerFor(row.owner),
      party: "hci", phase: proj ? Number(proj.phase) || 0 : 0,
      status: row.done ? "done" : waiting ? "waiting" : "open",
      visibility: "internal", due: "", note: "",
      hospital: clip(row.hospital || "General", 80),
      waitingOnId: "", waitingOnName: waitName, waitingSince: waiting ? (row.created_at || new Date().toISOString()) : "",
      source: clip(row.source, 120), sourceDate: clip(row.source_date, 30),
      createdAt: row.created_at || new Date().toISOString(), doneAt: row.done_at || "", updatedAt: new Date().toISOString()
    };
  }
  async function pull() {
    if (running) return; running = true;
    try {
      if (!SUPA_KEY) { if (!warned) { console.warn("daily: DAILY_SUPABASE_KEY is not set, inbox sync is off"); warned = true; } return; }
      const [rows, meta] = await Promise.all([supa("daily_board_tasks?select=*&order=created_at.asc"), supa("daily_board_meta?id=eq.sync&select=*")]);
      const seen = (store.dailyMeta.imported = store.dailyMeta.imported || { ids: {} });
      let added = 0;
      for (const row of rows || []) {
        if (!row.id || seen.ids[row.id] || store.tasks[row.id]) continue;
        const t = toTask(row);
        store.tasks[row.id] = t;
        for (const c of Array.isArray(row.comments) ? row.comments : []) {
          store.comments[newId()] = { projectId: t.projectId, recordType: "tasks", recordId: row.id, text: clip(c.text, 1000), by: clip(c.name || "Someone", 80), at: c.at || t.createdAt, visibility: "internal" };
        }
        seen.ids[row.id] = 1;
        audit(fakeReq, "tasks", row.id, "create", null, t);
        added++;
      }
      const m = meta && meta[0];
      if (m) {
        const cur = store.dailyMeta.sync || {};
        if (cur.lastMeeting !== (m.last_meeting || "") || cur.lastRun !== (m.last_run || "")) { store.dailyMeta.sync = { lastMeeting: m.last_meeting || "", lastRun: m.last_run || "" }; bump("dailyMeta"); }
      }
      if (added) { bump("tasks"); bump("comments"); bump("dailyMeta"); console.log("daily: imported", added, "new cards"); }
    } catch (e) { console.warn("daily:", e.message); }
    finally { running = false; }
  }
  return { start() { try { migrate(); } catch (e) { console.warn('daily migrate:', e.message); } setTimeout(pull, Number(process.env.DAILY_FIRST_PULL_MS || 15000)); setInterval(pull, EVERY_MS); }, pull };
};
