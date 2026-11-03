// Daily Update tab for the Hub. Draws the board inside #dailyMount and talks to /api/daily.
// Who did what comes from the Microsoft sign in on the server, so there is no name box.
(function () {
  "use strict";
  var LANES = [{ id: "john", name: "John" }, { id: "greg", name: "Greg" }, { id: "arpan", name: "Arpan" }, { id: "li", name: "Li" }, { id: "waiting", name: "Waiting on others" }];
  var HOSPITALS = ["General", "Good Sam", "Goshen", "Crawford", "Dozier", "Orlando", "Ball Health", "Cherokee", "Hamad", "Schneider (SRMC)", "NIH", "Dosher"];
  var tasks = [], meta = null, projects = [], backend = "", loaded = false, loadError = "";
  var openComments = {}, drafts = {}, armed = null, armTimer = null, editing = null, noteMsg = "";
  var showDone = true, hospFilter = "all";
  try { var s = localStorage.getItem("hub.daily.showDone"); if (s !== null) showDone = s === "1"; } catch (e) {}
  var mount = null, timer = null, loading = false;

  function css() {
    if (document.getElementById("dailyCss")) return;
    var st = document.createElement("style"); st.id = "dailyCss";
    st.textContent = [
      "#dailyRoot{display:flex;flex-direction:column;gap:12px;height:100%;min-height:0}",
      "#dailyRoot .dtop{display:flex;flex-wrap:wrap;gap:8px 18px;align-items:center;justify-content:space-between}",
      "#dailyRoot .dsync{color:var(--muted);font-size:12.5px;font-weight:600}",
      "#dailyRoot .dctl{display:flex;gap:14px;align-items:center;font-size:13px;color:var(--muted);font-weight:700}",
      "#dailyRoot .dctl b{color:var(--ink)}",
      "#dailyRoot .dchips{display:flex;flex-wrap:wrap;gap:6px}",
      "#dailyRoot .dboard{flex:1;min-height:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px}",
      "#dailyRoot .dlane{background:var(--card);border-radius:var(--r);box-shadow:var(--shadow);padding:14px;display:flex;flex-direction:column;gap:8px;min-width:0;min-height:0;overflow:auto}",
      "#dailyRoot .dlane h2{margin:0 0 2px;font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;display:flex;justify-content:space-between;gap:8px}",
      "#dailyRoot .dlane h2 span{color:var(--muted);letter-spacing:0}",
      "#dailyRoot .dtask{background:var(--card2);border:1px solid var(--card-brd);border-radius:var(--r-sm);padding:10px 11px;display:flex;flex-direction:column;gap:7px;min-width:0}",
      "#dailyRoot .dtask.done .dtxt{color:var(--muted);text-decoration:line-through}",
      "#dailyRoot .drow{display:flex;gap:9px;align-items:flex-start;min-width:0}",
      "#dailyRoot .drow input[type=checkbox]{margin:3px 0 0;width:17px;height:17px;accent-color:var(--hero-fill);flex:none;cursor:pointer}",
      "#dailyRoot .dtxt{flex:1;min-width:0;overflow-wrap:anywhere;font-weight:600}",
      "#dailyRoot .dmeta{display:flex;flex-wrap:wrap;gap:5px 10px;align-items:center;padding-left:26px;font-size:11.5px;color:var(--muted);font-weight:600}",
      "#dailyRoot .dtag{padding:1px 8px;border-radius:var(--r-pill);background:var(--pill)}",
      "#dailyRoot .dtag.old{background:var(--chip-caution);color:var(--chip-caution-ink)}",
      "#dailyRoot .dlink{color:var(--hero-deep);font-weight:800;font-size:11.5px;background:none;border:0;padding:0;cursor:pointer;text-decoration:none}",
      "#dailyRoot .dlink:hover{text-decoration:underline}",
      "#dailyRoot .ddel{margin-left:auto;color:var(--muted);background:none;border:0;padding:0;font-size:11.5px;font-weight:700;cursor:pointer}",
      "#dailyRoot .ddel:hover,#dailyRoot .ddel.arm{color:var(--bad)}",
      "#dailyRoot select,#dailyRoot input[type=text]{border:1px solid var(--card-brd);background:var(--card);border-radius:10px;padding:6px 9px;min-width:0;font-weight:600;font-size:13px;max-width:100%}",
      "#dailyRoot input[type=text]{width:100%}",
      "#dailyRoot .dassign{font-size:11.5px;padding:1px 6px;border-radius:8px}",
      "#dailyRoot .dadd input{background:transparent;border-style:dashed}",
      "#dailyRoot .dcom{padding-left:26px;display:flex;flex-direction:column;gap:6px}",
      "#dailyRoot .dc{border-left:3px solid var(--card-brd);padding-left:9px;font-size:13px;overflow-wrap:anywhere}",
      "#dailyRoot .dc small{display:block;color:var(--muted);font-size:11px;font-weight:700}",
      "#dailyRoot .ddiv{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);border-top:1px solid var(--card-brd);padding-top:8px;margin-top:4px;font-weight:800}",
      "#dailyRoot .dedit{display:flex;flex-direction:column;gap:6px}",
      "#dailyRoot .dedit .dpair{display:flex;flex-wrap:wrap;gap:6px}",
      "#dailyRoot .dedit .dpair select{flex:1 1 100px}",
      "#dailyRoot .dedit .dbtns{display:flex;gap:12px;align-items:center}",
      "#dailyRoot .dempty{color:var(--muted);font-size:13px;padding:4px 2px}",
      "#dailyRoot .dnote{font-size:13px;font-weight:700;color:var(--muted)}",
      "#dailyRoot .dnote.err{color:var(--bad)}"
    ].join("\n");
    document.head.appendChild(st);
  }

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) { if (k === "class") n.className = attrs[k]; else if (k === "text") n.textContent = attrs[k]; else n.setAttribute(k, attrs[k]); }
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function fmtDay(iso) { var d = new Date(iso); return isNaN(d) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" }); }
  function fmtStamp(iso) { var d = new Date(iso); return isNaN(d) ? "" : fmtDay(iso) + " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); }
  function daysOld(iso) { var d = new Date(iso); if (isNaN(d)) return 0; var t = new Date(); t.setHours(0, 0, 0, 0); d.setHours(0, 0, 0, 0); return Math.max(0, Math.round((t - d) / 86400000)); }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  function api(method, path, body) {
    var h = { "X-Hub-User": (function () { try { return localStorage.getItem("hub.me") || ""; } catch (e) { return ""; } })() };
    if (body !== undefined) h["Content-Type"] = "application/json";
    // Hub pages send the Teams token through their own fetch wrapper when present.
    var f = window.HUB_FETCH || window.fetch.bind(window);
    return f("/api/daily" + path, { method: method, headers: h, credentials: "same-origin", body: body === undefined ? undefined : JSON.stringify(body) }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || (r.status + " " + r.statusText)); return j; });
    });
  }
  function fail(e) {
    noteMsg = "That change was not saved (" + ((e && e.message) || "error") + ").";
    draw(); setTimeout(function () { noteMsg = ""; draw(); }, 6000); load();
  }

  function lanes() {
    var base = LANES.filter(function (l) { return l.id !== "waiting"; }), ids = {};
    base.forEach(function (l) { ids[l.id] = 1; });
    tasks.forEach(function (t) { var o = t.owner; if (o && o !== "waiting" && !ids[o]) { ids[o] = 1; base.push({ id: o, name: cap(o) }); } });
    base.push(LANES[LANES.length - 1]);
    return base;
  }
  function hospList() {
    var seen = {}, out = [];
    HOSPITALS.concat(tasks.map(function (t) { return t.hospital || "General"; })).forEach(function (h) { if (!seen[h]) { seen[h] = 1; out.push(h); } });
    return out;
  }
  function projectName(id) { for (var i = 0; i < projects.length; i++) if (projects[i].id === id) return projects[i].name; return ""; }

  function update(t, fields) {
    for (var k in fields) t[k] = fields[k];
    draw();
    return api("PATCH", "/tasks/" + encodeURIComponent(t.id), fields).then(function (j) { if (j && j.comments) t.comments = j.comments; }).catch(fail);
  }
  function hospSelect(cur) {
    var s = el("select", { "aria-label": "Hospital" });
    hospList().forEach(function (h) { var o = el("option", { value: h, text: h }); if (h === cur) o.selected = true; s.appendChild(o); });
    s.appendChild(el("option", { value: "__new", text: "New hospital…" }));
    return s;
  }
  function editEl(t) {
    var ti = el("input", { type: "text", "aria-label": "Task text" }); ti.value = t.text || "";
    var os = el("select", { "aria-label": "Owner" });
    lanes().forEach(function (l) { var o = el("option", { value: l.id, text: l.name }); if ((t.owner || "waiting") === l.id) o.selected = true; os.appendChild(o); });
    os.appendChild(el("option", { value: "__new", text: "New person…" }));
    var np = el("input", { type: "text", placeholder: "Person's name", "aria-label": "New person name" }); np.hidden = true;
    os.addEventListener("change", function () { np.hidden = os.value !== "__new"; if (!np.hidden) np.focus(); });
    var hs = hospSelect(t.hospital || "General");
    var nh = el("input", { type: "text", placeholder: "New hospital name", "aria-label": "New hospital name" }); nh.hidden = true;
    hs.addEventListener("change", function () { nh.hidden = hs.value !== "__new"; if (!nh.hidden) nh.focus(); });
    function save() {
      var txt = ti.value.trim(); if (!txt) return;
      var h = hs.value === "__new" ? nh.value.trim() : hs.value;
      var ow = os.value === "__new" ? np.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "") : os.value;
      if (!ow) return;
      editing = null; update(t, { text: txt, owner: ow, hospital: h || "General" });
    }
    function cancel() { editing = null; draw(); }
    [ti, nh, np].forEach(function (i) { i.addEventListener("keydown", function (e) { if (e.key === "Enter") save(); else if (e.key === "Escape") cancel(); }); });
    var sv = el("button", { type: "button", class: "btn sm", text: "Save" }); sv.addEventListener("click", save);
    var cn = el("button", { type: "button", class: "dlink", text: "Cancel" }); cn.addEventListener("click", cancel);
    return el("div", { class: "dedit" }, [ti, el("div", { class: "dpair" }, [os, hs]), np, nh, el("div", { class: "dbtns" }, [sv, cn])]);
  }

  function taskEl(t) {
    var cs = Array.isArray(t.comments) ? t.comments : [];
    var cb = el("input", { type: "checkbox", "aria-label": "Mark done" }); cb.checked = !!t.done;
    cb.addEventListener("change", function () { update(t, { done: cb.checked }); });
    var meta = el("div", { class: "dmeta" });
    if (t.sourceDate) {
      var n = daysOld(t.sourceDate);
      meta.appendChild(el("span", { class: "dtag" + (!t.done && n >= 3 ? " old" : ""), text: fmtDay(t.sourceDate) + (n > 0 ? " · " + n + "d" : " · new"), title: t.source || "Daily Update" }));
    } else if (t.source) meta.appendChild(el("span", { class: "dtag", text: t.source }));
    if (t.projectId) {
      var pl = el("button", { type: "button", class: "dtag dlink", title: "Open the project: " + projectName(t.projectId), text: t.hospital || "General" });
      pl.addEventListener("click", function () { var b = document.createElement("button"); b.setAttribute("data-go", "project:overview:" + t.projectId); document.body.appendChild(b); b.click(); b.remove(); });
      meta.appendChild(pl);
    } else meta.appendChild(el("span", { class: "dtag", text: t.hospital || "General" }));
    var as = el("select", { class: "dassign", "aria-label": "Assigned to" });
    lanes().forEach(function (l) { var o = el("option", { value: l.id, text: l.name }); if ((t.owner || "waiting") === l.id) o.selected = true; as.appendChild(o); });
    as.addEventListener("change", function () { update(t, { owner: as.value }); });
    meta.appendChild(as);
    var tg = el("button", { class: "dlink", type: "button", text: cs.length ? (openComments[t.id] ? "Hide comments" : "Comments (" + cs.length + ")") : (openComments[t.id] ? "Hide" : "Comment") });
    tg.addEventListener("click", function () { openComments[t.id] = !openComments[t.id]; draw(); });
    meta.appendChild(tg);
    var ed = el("button", { class: "dlink", type: "button", text: "Edit" });
    ed.addEventListener("click", function () { editing = t.id; draw(); });
    meta.appendChild(ed);
    var on = armed === t.id;
    var del = el("button", { class: "ddel" + (on ? " arm" : ""), type: "button", text: on ? "Delete?" : "Delete" });
    del.addEventListener("click", function () {
      if (armed === t.id) {
        armed = null; clearTimeout(armTimer);
        tasks = tasks.filter(function (x) { return x.id !== t.id; }); draw();
        api("DELETE", "/tasks/" + encodeURIComponent(t.id)).catch(fail);
      } else { armed = t.id; clearTimeout(armTimer); armTimer = setTimeout(function () { armed = null; draw(); }, 3500); draw(); }
    });
    meta.appendChild(del);
    var kids = editing === t.id ? [editEl(t)] : [el("div", { class: "drow" }, [cb, el("label", { class: "dtxt", text: t.text || "" })]), meta];
    if (openComments[t.id]) {
      var box = el("div", { class: "dcom" });
      cs.forEach(function (c) { box.appendChild(el("div", { class: "dc" }, [el("div", { text: c.text || "" }), el("small", { text: (c.name || "Someone") + " · " + fmtStamp(c.at) })])); });
      var inp = el("input", { type: "text", placeholder: "Add a comment, press Enter", "aria-label": "Add a comment" });
      inp.value = drafts[t.id] || "";
      inp.addEventListener("input", function () { drafts[t.id] = inp.value; });
      inp.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && inp.value.trim()) {
          var text = inp.value.trim(); drafts[t.id] = "";
          api("POST", "/tasks/" + encodeURIComponent(t.id) + "/comments", { text: text }).then(function (j) { t.comments = j.comments; draw(); }).catch(fail);
        }
      });
      box.appendChild(inp);
      kids.push(box);
    }
    return el("article", { class: "dtask" + (t.done ? " done" : "") }, kids);
  }
  function addEl(laneId) {
    var inp = el("input", { type: "text", placeholder: "Add a task, press Enter", "aria-label": "Add a task for " + laneId });
    inp.value = drafts["add_" + laneId] || "";
    inp.addEventListener("input", function () { drafts["add_" + laneId] = inp.value; });
    inp.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && inp.value.trim()) {
        var v = inp.value.trim(); inp.value = ""; drafts["add_" + laneId] = "";
        api("POST", "/tasks", { text: v, owner: laneId, hospital: hospFilter !== "all" ? hospFilter : "General" }).then(function (made) { made.projectId = made.projectId || ""; tasks.push(made); draw(); load(); }).catch(fail);
      }
    });
    return el("div", { class: "dadd" }, [inp]);
  }

  function draw() {
    if (!mount || !document.body.contains(mount)) return;
    // Keep what the person is typing: do not redraw out from under a focused text box.
    var a = document.activeElement;
    if (a && a.tagName === "INPUT" && a.type === "text" && mount.contains(a) && a.value) { return; }
    mount.textContent = "";
    var root = el("div", { id: "dailyRoot" });
    var open = 0, done = 0;
    tasks.forEach(function (t) { if (t.done) done++; else open++; });
    var counts = {}, total = 0;
    tasks.forEach(function (t) { if (t.done) return; var h = t.hospital || "General"; counts[h] = (counts[h] || 0) + 1; total++; });

    var sync = !loaded ? "Loading tasks…" : loadError ? loadError : meta && (meta.lastMeeting || meta.lastRun)
      ? ["From the " + (meta.lastMeeting || "latest") + " Daily Update", meta.lastRun ? "refreshed " + fmtStamp(meta.lastRun) : ""].filter(Boolean).join(" · ") : "No sync yet. The first morning run will fill this in.";
    var sd = el("input", { type: "checkbox" }); sd.checked = showDone;
    sd.addEventListener("change", function () { showDone = sd.checked; try { localStorage.setItem("hub.daily.showDone", showDone ? "1" : "0"); } catch (e) {} draw(); });
    var ctl = el("div", { class: "dctl" }, [
      el("span", null, [el("b", { text: String(open) }), document.createTextNode(" open · "), el("b", { text: String(done) }), document.createTextNode(" done")]),
      el("label", { style: "display:inline-flex;gap:6px;align-items:center;cursor:pointer" }, [sd, document.createTextNode("Show done")])
    ]);
    root.appendChild(el("div", { class: "dtop" }, [el("span", { class: "dsync", text: sync }), ctl]));

    var chips = el("div", { class: "dchips", role: "group", "aria-label": "Filter by hospital" });
    var mk = function (label, val, n) {
      var b = el("button", { type: "button", class: "fchip" + (hospFilter === val ? " on" : ""), "aria-pressed": hospFilter === val ? "true" : "false", text: label + " " + n });
      b.addEventListener("click", function () { hospFilter = val; draw(); });
      chips.appendChild(b);
    };
    mk("All hospitals", "all", total);
    hospList().forEach(function (h) { if (counts[h] || h === hospFilter) mk(h, h, counts[h] || 0); });
    root.appendChild(chips);
    if (noteMsg) root.appendChild(el("div", { class: "dnote err", text: noteMsg }));

    var board = el("div", { class: "dboard" });
    var filtered = hospFilter !== "all";
    lanes().forEach(function (lane) {
      var items = tasks.filter(function (t) { return (t.owner || "waiting") === lane.id; });
      if (!showDone) items = items.filter(function (t) { return !t.done; });
      if (filtered) items = items.filter(function (t) { return (t.hospital || "General") === hospFilter; });
      items.sort(function (x, y) { return String(x.createdAt || "").localeCompare(String(y.createdAt || "")) || String(x.id).localeCompare(String(y.id)); });
      var o = items.filter(function (t) { return !t.done; }), d = items.filter(function (t) { return t.done; });
      var laneEl = el("section", { class: "dlane", "aria-label": lane.name }, [el("h2", null, [el("div", { text: lane.name }), el("span", { text: String(o.length) })])]);
      if (loaded && !items.length) laneEl.appendChild(el("div", { class: "dempty", text: filtered ? "Nothing here for " + hospFilter + "." : "Nothing here." }));
      var one = function (t) { try { laneEl.appendChild(taskEl(t)); } catch (err) { laneEl.appendChild(el("div", { class: "dempty", text: "Could not draw: " + (t.text || t.id) })); } };
      o.forEach(one);
      laneEl.appendChild(addEl(lane.id));
      if (d.length) { laneEl.appendChild(el("div", { class: "ddiv", text: "Done · " + d.length })); d.forEach(one); }
      board.appendChild(laneEl);
    });
    root.appendChild(board);
    mount.appendChild(root);
  }

  function load() {
    if (loading) return; loading = true;
    api("GET", "").then(function (j) {
      loading = false; loaded = true; loadError = "";
      tasks = j.tasks || []; meta = j.meta || null; projects = j.projects || []; backend = j.backend || "";
      draw();
    }).catch(function (e) { loading = false; loaded = true; loadError = "Could not load tasks (" + ((e && e.message) || "error") + ")"; draw(); });
  }
  function tick() {
    clearTimeout(timer);
    if (!mount || !document.body.contains(mount)) { timer = null; return; }
    if (!document.hidden && editing === null) load();
    timer = setTimeout(tick, 20000);
  }

  window.HUB_DAILY = {
    mount: function (target) {
      css(); mount = target; draw();
      load(); clearTimeout(timer); timer = setTimeout(tick, 20000);
    }
  };
})();
