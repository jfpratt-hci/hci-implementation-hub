// HCI ONE Help Desk: tickets and texting inside the Hub.
// Sold as an add on to 24x7 Enterprise Support only. A project has it when
// supportPlan is "enterprise" and helpdesk is on. Only Approved Contacts
// (people records with approvedContact on and a mobile number) can open tickets or text.
"use strict";
const express = require("express");
const crypto = require("crypto");

const TARGET_HOURS = { critical: 1, high: 4, normal: 24 };
const TRIAGE = [
  { key: "roomOrDevice", q: "Which room or device is it?" },
  { key: "screen", q: "Is it powered on, and what is on the screen?" },
  { key: "change", q: "When did it start, and did anything change (moved, unplugged, network work, power)?" },
  { key: "photo", q: "Send a photo of the screen if you can, or reply SKIP." }
];
const NO_PHI = "Please do not text patient names or details. Room numbers are fine.";
const PAGE_EVERY_MS = 15 * 60 * 1000;

const yes = v => v === true || v === "true";
const normPhone = s => { const d = String(s || "").replace(/\D/g, ""); return d.length === 10 ? "1" + d : d; };
const nowIso = () => new Date().toISOString();
const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 20);
const xml = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));

// Strip things that look like an MRN or a date of birth before anything is stored.
function scrub(text) {
  let flagged = false;
  const out = String(text || "")
    .replace(/\b(?:MRN|mrn|Mrn)[:#\s]*\w+/g, () => { flagged = true; return "[removed]"; })
    .replace(/\b\d{1,2}[\/\-.]\d{1,2}[\/\-.](?:19|20)?\d{2}\b/g, () => { flagged = true; return "[removed]"; })
    .replace(/\b\d{7,10}\b/g, () => { flagged = true; return "[removed]"; });
  return { text: out.slice(0, 1600), flagged };
}

module.exports = function ({ store, bump, audit }) {
  const cfg = () => ({
    sid: process.env.TWILIO_ACCOUNT_SID || "",
    token: process.env.TWILIO_AUTH_TOKEN || "",
    service: process.env.TWILIO_MESSAGING_SERVICE_SID || "",
    oncall: String(process.env.ONCALL_NUMBER || "").split(",").map(s => s.trim()).filter(Boolean),
    publicUrl: (process.env.HUB_PUBLIC_URL || "").replace(/\/$/, ""),
    api: (process.env.TWILIO_API_BASE || "https://api.twilio.com").replace(/\/$/, "")
  });
  const texting = () => { const c = cfg(); return !!(c.sid && c.token && c.service); };

  const entitled = p => !!p && p.supportPlan === "enterprise" && yes(p.helpdesk);
  const project = pid => store.projects[pid];
  const approvedFor = (email, pid) => Object.entries(store.people).find(([, x]) => x.projectId === pid && yes(x.approvedContact) && String(x.email || "").toLowerCase() === String(email || "").toLowerCase());
  const label = t => "HD-" + t.number;
  const dueFrom = (sev, from) => new Date(new Date(from).getTime() + (TARGET_HOURS[sev] || 24) * 3600e3).toISOString();

  function nextNumber() {
    let m = 1000;
    for (const t of Object.values(store.tickets)) m = Math.max(m, Number(t.number) || 0);
    return m + 1;
  }
  function save(req, col, id, before, after) {
    store[col][id] = after; bump(col); audit(req, col, id, before ? "update" : "create", before, after);
  }
  function addMessage(req, ticketId, t, m) {
    const id = newId();
    save(req, "ticketMessages", id, null, Object.assign({ ticketId, projectId: t.projectId, at: nowIso(), visibility: "external", channel: "web" }, m));
    return id;
  }
  function updateTicket(req, id, patch) {
    const before = store.tickets[id]; const after = Object.assign({}, before, patch, { updatedAt: nowIso() });
    save(req, "tickets", id, before, after); return after;
  }

  async function sendSms(to, body) {
    const c = cfg(); if (!texting() || !to) return { skipped: true };
    const form = new URLSearchParams({ To: "+" + normPhone(to), MessagingServiceSid: c.service, Body: body });
    const r = await fetch(`${c.api}/2010-04-01/Accounts/${c.sid}/Messages.json`, {
      method: "POST", body: form,
      headers: { Authorization: "Basic " + Buffer.from(c.sid + ":" + c.token).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" }
    });
    if (!r.ok) { const e = await r.text().catch(() => ""); console.error("sms send failed", r.status, e.slice(0, 200)); return { ok: false }; }
    return { ok: true };
  }
  async function page(req, id) {
    const t = store.tickets[id]; if (!t) return;
    const p = project(t.projectId) || {};
    const msg = `HCI ONE Help Desk CRITICAL ${label(t)} ${p.customer || p.name || ""}: ${t.title}. ${t.roomOrDevice ? "Where: " + t.roomOrDevice + ". " : ""}Take it in the Hub.`;
    for (const n of cfg().oncall) await sendSms(n, msg);
    updateTicket(req, id, { lastPagedAt: nowIso() });
  }

  // ---- signed in routes (mounted under /api/helpdesk, after sign in) ----
  const r = express.Router();
  r.get("/status", (req, res) => res.json({ texting: texting(), targets: TARGET_HOURS }));

  r.post("/:pid/tickets", async (req, res) => {
    const pid = req.params.pid, p = project(pid), me = req.me;
    if (!entitled(p)) return res.status(403).json({ error: "This project does not have the Help Desk add on" });
    let person = null;
    if (me.role !== "hci") { const a = approvedFor(me.email, pid); if (!a) return res.status(403).json({ error: "Only Approved Contacts can open tickets. Ask your IT team to add you." }); person = a; }
    const b = req.body || {};
    const title = String(b.title || "").trim().slice(0, 140);
    if (!title) return res.status(400).json({ error: "Add a short title" });
    const sev = TARGET_HOURS[b.severity] ? b.severity : "normal";
    const body = scrub(b.body), room = scrub(b.roomOrDevice);
    const id = newId(), at = nowIso();
    const t = { projectId: pid, number: nextNumber(), title: scrub(title).text, severity: sev, status: "hci", owner: "", roomOrDevice: room.text, channel: "web",
      openedBy: me.name || me.email || "", openedByPerson: person ? person[0] : "", createdAt: at, updatedAt: at, dueAt: dueFrom(sev, at), phiFlag: body.flagged || room.flagged, triage: { done: true } };
    save(req, "tickets", id, null, t);
    if (body.text) addMessage(req, id, t, { from: t.openedBy, fromRole: me.role === "hci" ? "hci" : "customer", body: body.text });
    if (sev === "critical") page(req, id).catch(e => console.error("page", e));
    res.json({ id, number: t.number });
  });

  r.post("/tickets/:id/reply", async (req, res) => {
    const id = req.params.id, t = store.tickets[id], me = req.me;
    if (!t || !entitled(project(t.projectId))) return res.status(404).json({ error: "No such ticket" });
    const hci = me.role === "hci";
    if (!hci && !approvedFor(me.email, t.projectId)) return res.status(403).json({ error: "Only Approved Contacts can reply" });
    const internal = hci && !!(req.body || {}).internal;
    const s = scrub((req.body || {}).body); if (!s.text.trim()) return res.status(400).json({ error: "Write a reply" });
    addMessage(req, id, t, { from: me.name || me.email || "", fromRole: hci ? "hci" : "customer", body: s.text, visibility: internal ? "internal" : "external" });
    const patch = {};
    if (s.flagged) patch.phiFlag = true;
    if (!internal) {
      if (hci) { patch.status = t.status === "closed" ? "closed" : "customer"; if (!t.firstResponseAt) patch.firstResponseAt = nowIso(); if (!t.owner) patch.owner = me.name || me.email || ""; }
      else patch.status = "hci";
    }
    const after = updateTicket(req, id, patch);
    let sms = null;
    if (hci && !internal && t.channel === "sms") {
      const person = store.people[t.openedByPerson];
      sms = await sendSms(person && person.mobile, `${label(after)}: ${s.text}`);
    }
    res.json({ ok: true, sms });
  });

  r.post("/tickets/:id/update", async (req, res) => {
    const id = req.params.id, t = store.tickets[id];
    if (req.me.role !== "hci") return res.status(403).json({ error: "Only HCI can change a ticket" });
    if (!t) return res.status(404).json({ error: "No such ticket" });
    const b = req.body || {}, patch = {};
    if (["new", "hci", "customer", "closed"].includes(b.status)) patch.status = b.status;
    if (TARGET_HOURS[b.severity]) { patch.severity = b.severity; if (b.severity !== t.severity) patch.dueAt = dueFrom(b.severity, t.createdAt); }
    if (typeof b.owner === "string") patch.owner = b.owner.slice(0, 80);
    if (typeof b.title === "string" && b.title.trim()) patch.title = scrub(b.title).text.slice(0, 140);
    if (patch.status === "closed" && t.status !== "closed") patch.closedAt = nowIso();
    if (patch.status && patch.status !== "closed") patch.closedAt = "";
    const after = updateTicket(req, id, patch);
    if (patch.status === "closed" && t.status !== "closed" && t.channel === "sms") {
      const person = store.people[t.openedByPerson];
      await sendSms(person && person.mobile, `${label(after)} is closed. Text this number again if it comes back.`);
    }
    if (patch.severity === "critical" && t.severity !== "critical") page(req, id).catch(e => console.error("page", e));
    res.json({ ok: true });
  });

  // ---- Twilio webhook (no sign in; the Twilio signature proves the sender) ----
  const hooks = express.Router();
  hooks.use(express.urlencoded({ extended: false, limit: "200kb" }));
  function validSignature(req) {
    const c = cfg(); const sig = req.get("x-twilio-signature") || "";
    const base = c.publicUrl || ("https://" + req.get("host"));
    const url = base + req.originalUrl;
    const params = req.body || {};
    const data = url + Object.keys(params).sort().map(k => k + params[k]).join("");
    const want = crypto.createHmac("sha1", c.token).update(Buffer.from(data, "utf8")).digest("base64");
    const a = Buffer.from(sig), b = Buffer.from(want);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  const twiml = (res, text) => res.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?><Response>${text ? `<Message>${xml(text)}</Message>` : ""}</Response>`);

  hooks.post("/sms", async (req, res) => {
    if (!cfg().token) return res.status(503).send("Texting is not set up");
    if (!validSignature(req)) return res.status(403).send("Bad signature");
    const from = normPhone(req.body.From);
    const raw = String(req.body.Body || "").trim();
    if (/^(stop|stopall|unsubscribe|cancel|end|quit|start|unstop|help|info)$/i.test(raw)) return twiml(res, ""); // Twilio handles these keywords
    const contacts = Object.entries(store.people).filter(([, x]) => yes(x.approvedContact) && x.mobile && normPhone(x.mobile) === from && entitled(project(x.projectId)));
    if (!contacts.length) return twiml(res, "This number is not registered with HCI ONE Help Desk. Ask your IT team to add you as an Approved Contact.");
    const media = []; for (let i = 0; i < Math.min(Number(req.body.NumMedia) || 0, 5); i++) if (req.body["MediaUrl" + i]) media.push(req.body["MediaUrl" + i]);
    const s = scrub(raw);
    const urgent = /\burgent\b/i.test(raw);
    const fake = { me: { name: "Text message", email: "" }, get: () => "", ip: req.ip };
    // continue the contact's open text ticket from the last 7 days, otherwise start one
    const week = Date.now() - 7 * 864e5;
    const pids2 = new Set(contacts.map(c => c[0]));
    const open = Object.entries(store.tickets).filter(([, t]) => t.channel === "sms" && t.status !== "closed" && pids2.has(t.openedByPerson) && new Date(t.updatedAt || t.createdAt).getTime() > week)
      .sort((a, b) => String(b[1].updatedAt).localeCompare(String(a[1].updatedAt)))[0];
    if (!open) {
      const [personId, person] = contacts[0];
      const id = newId(), at = nowIso(), sev = urgent ? "critical" : "normal";
      const t = { projectId: person.projectId, number: nextNumber(), title: (s.text || "Text message").slice(0, 80), severity: sev, status: urgent ? "hci" : "new", owner: "", roomOrDevice: "", channel: "sms",
        openedBy: person.name || "", openedByPerson: personId, createdAt: at, updatedAt: at, dueAt: dueFrom(sev, at), phiFlag: s.flagged, triage: { done: urgent, step: 0 } };
      save(fake, "tickets", id, null, t);
      addMessage(fake, id, t, { from: person.name || "", fromRole: "customer", body: s.text, channel: "sms", media });
      if (urgent) { page(fake, id).catch(e => console.error("page", e)); return twiml(res, `HCI ONE Help Desk ${label(t)}: marked URGENT and the on call HCI tech is being paged now. ${NO_PHI}`); }
      return twiml(res, `HCI ONE Help Desk opened ${label(t)}. ${NO_PHI} A few quick questions first. ${TRIAGE[0].q}`);
    }
    const [id, t] = open;
    addMessage(fake, id, t, { from: t.openedBy, fromRole: "customer", body: s.text, channel: "sms", media });
    const patch = {}; if (s.flagged) patch.phiFlag = true;
    if (urgent && t.severity !== "critical") {
      Object.assign(patch, { severity: "critical", status: "hci", dueAt: dueFrom("critical", t.createdAt), triage: Object.assign({}, t.triage, { done: true }) });
      updateTicket(fake, id, patch); page(fake, id).catch(e => console.error("page", e));
      return twiml(res, `${label(t)} is now URGENT. The on call HCI tech is being paged.`);
    }
    const tri = t.triage || { done: true };
    if (!tri.done) {
      const step = Number(tri.step) || 0, q = TRIAGE[step];
      if (q && q.key === "roomOrDevice") patch.roomOrDevice = s.text.slice(0, 80);
      const next = step + 1;
      if (next < TRIAGE.length) { patch.triage = { done: false, step: next }; updateTicket(fake, id, patch); return twiml(res, TRIAGE[next].q); }
      patch.triage = { done: true, step: next }; patch.status = "hci";
      const after = updateTicket(fake, id, patch);
      const hrs = TARGET_HOURS[after.severity] || 24;
      return twiml(res, `Thank you. ${label(after)} is with an HCI tech. Target response: ${hrs === 1 ? "1 hour" : hrs + " hours"}. Text URGENT if patients are affected.`);
    }
    patch.status = "hci"; updateTicket(fake, id, patch);
    return twiml(res, "");
  });

  // ---- page the on call tech again every 15 minutes until someone owns a critical ticket ----
  setInterval(() => {
    const fake = { me: { name: "Help Desk", email: "" }, get: () => "", ip: "" };
    for (const [id, t] of Object.entries(store.tickets)) {
      if (t.severity !== "critical" || t.status === "closed" || t.owner) continue;
      if (Date.now() - new Date(t.lastPagedAt || 0).getTime() < PAGE_EVERY_MS) continue;
      page(fake, id).catch(e => console.error("page", e));
    }
  }, 60 * 1000).unref();

  return { router: r, hooks, entitled };
};
