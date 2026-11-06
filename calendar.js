// Outlook calendars for the Plan tab. Reads each team member's busy time through Microsoft Graph with the same app sign in as the Files tab.
// Needs the Graph application permission Calendars.Read with admin consent. Until then /api/calendar says so and the Plan tab simply shows no meetings.
// Only meeting titles and times go to HCI staff. Nothing is written back to Outlook.
"use strict";

module.exports = function calendarRouter({ store }) {
  const router = require("express").Router();
  const TENANT = process.env.GRAPH_TENANT_ID || "";
  const CLIENT = process.env.GRAPH_CLIENT_ID || "";
  const SECRET = process.env.GRAPH_CLIENT_SECRET || "";
  const configured = !!(TENANT && CLIENT && SECRET);
  const TZ = process.env.PLAN_TIMEZONE || "Eastern Standard Time"; // Windows zone name; Graph handles daylight saving
  let token = null, tokenExp = 0;
  const cache = new Map(); // email|start|end -> { at, events, error }
  const TTL = 5 * 60 * 1000;

  async function graphToken() {
    if (token && Date.now() < tokenExp - 60000) return token;
    const r = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: CLIENT, client_secret: SECRET, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" })
    });
    const j = await r.json();
    if (!r.ok) throw new Error("Graph sign in failed: " + (j.error_description || j.error || r.status));
    token = j.access_token; tokenExp = Date.now() + (j.expires_in || 3600) * 1000;
    return token;
  }

  async function eventsFor(email, start, end) {
    const key = email + "|" + start + "|" + end;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL) return hit;
    let out = { at: Date.now(), events: [], error: "" };
    try {
      const url = "https://graph.microsoft.com/v1.0/users/" + encodeURIComponent(email) + "/calendarView?startDateTime=" + encodeURIComponent(start + "T00:00:00") +
        "&endDateTime=" + encodeURIComponent(end + "T23:59:59") + "&$select=subject,start,end,isAllDay,showAs,isCancelled&$orderby=start/dateTime&$top=200";
      const r = await fetch(url, { headers: { Authorization: "Bearer " + await graphToken(), Prefer: `outlook.timezone="${TZ}"` } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        const code = (j.error && j.error.code) || r.status;
        out.error = r.status === 403 || /AccessDenied/i.test(String(code)) ? "permission" : r.status === 404 || /MailboxNotEnabled|ResourceNotFound|InvalidUser/i.test(String(code)) ? "nomailbox" : "error";
      } else {
        out.events = (j.value || []).filter(e => !e.isCancelled && !e.isAllDay && e.showAs !== "free").map(e => ({
          title: String(e.subject || "Busy").slice(0, 120), start: String(e.start.dateTime).slice(0, 16), end: String(e.end.dateTime).slice(0, 16), tentative: e.showAs === "tentative"
        }));
      }
    } catch (e) { out.error = "error"; }
    cache.set(key, out);
    return out;
  }

  // GET /api/calendar?start=2026-11-09&end=2026-11-13  ->  { configured, people: { <teamId>: { events:[{title,start,end}], error } } }
  router.get("/", async (req, res) => {
    if (req.me.role !== "hci") return res.status(403).json({ error: "Staff only" });
    const ok = s => /^\d{4}-\d\d-\d\d$/.test(String(s || ""));
    const { start, end } = req.query;
    if (!ok(start) || !ok(end)) return res.status(400).json({ error: "start and end are required as YYYY-MM-DD" });
    if (!configured) return res.json({ configured: false, people: {} });
    const out = {};
    await Promise.all(Object.entries(store.team || {}).map(async ([id, m]) => {
      const email = String(m.email || "").trim();
      if (!email) { out[id] = { events: [], error: "noemail" }; return; }
      const r = await eventsFor(email, start, end);
      out[id] = { events: r.events, error: r.error };
    }));
    res.json({ configured: true, people: out });
  });
  return router;
};
