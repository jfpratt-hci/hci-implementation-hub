// Daily Update views for the Hub: the front Dashboard and the Board.
// Both read and write the same task list as each project's Plan tab. The page hands in a ctx object (see dailyCtx in the page).
(function () {
  "use strict";
  var state = { filter: "all", showDone: true, open: {}, drafts: {}, armed: null, editing: null };
  try { var s = localStorage.getItem("hub.daily.showDone"); if (s !== null) state.showDone = s === "1"; } catch (e) {}
  var mount = null, view = "", ctx = null, armTimer = null;

  function css() {
    if (document.getElementById("dailyCss")) return;
    var st = document.createElement("style"); st.id = "dailyCss";
    st.textContent = [
      "#dailyRoot{display:flex;flex-direction:column;gap:12px;height:100%;min-height:0}",
      "#dailyRoot .dtop{display:flex;flex-wrap:wrap;gap:8px 18px;align-items:center;justify-content:space-between}",
      "#dailyRoot .dsync{color:var(--muted);font-size:12.5px;font-weight:600}",
      "#dailyRoot .dstats{display:flex;gap:14px;align-items:center;font-size:13px;color:var(--muted);font-weight:700;flex-wrap:wrap}",
      "#dailyRoot .dstats b{color:var(--ink)} #dailyRoot .dstats .bad b{color:var(--bad)} #dailyRoot .dstats .warn b{color:var(--chip-caution-ink)}",
      "#dailyRoot .dchips{display:flex;flex-wrap:wrap;gap:6px}",
      "#dailyRoot .dboard{flex:1;min-height:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px}",
      "#dailyRoot .dlane,#dailyRoot .dtile,#dailyRoot .dstuck{background:var(--card);border-radius:var(--r);box-shadow:var(--shadow);padding:14px;display:flex;flex-direction:column;gap:8px;min-width:0;min-height:0;overflow:auto}",
      "#dailyRoot .dlane.stuck,#dailyRoot .dstuck{background:var(--chip-caution)}",
      "#dailyRoot .dlane.stuck .dtask{background:var(--card)}",
      "#dailyRoot h2{margin:0 0 2px;font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;display:flex;justify-content:space-between;gap:8px}",
      "#dailyRoot h2 span{color:var(--muted);letter-spacing:0}",
      "#dailyRoot .dtask{background:var(--card2);border:1px solid var(--card-brd);border-radius:var(--r-sm);padding:10px 11px;display:flex;flex-direction:column;gap:7px;min-width:0}",
      "#dailyRoot .dtask.done .dtxt{color:var(--muted);text-decoration:line-through}",
      "#dailyRoot .drow{display:flex;gap:9px;align-items:flex-start;min-width:0}",
      "#dailyRoot .drow input[type=checkbox]{margin:3px 0 0;width:17px;height:17px;accent-color:var(--hero-fill);flex:none;cursor:pointer}",
      "#dailyRoot .dtxt{flex:1;min-width:0;overflow-wrap:anywhere;font-weight:600}",
      "#dailyRoot .dmeta{display:flex;flex-wrap:wrap;gap:5px 10px;align-items:center;padding-left:26px;font-size:11.5px;color:var(--muted);font-weight:600}",
      "#dailyRoot .dtag{padding:1px 8px;border-radius:var(--r-pill);background:var(--pill)}",
      "#dailyRoot .dtag.old{background:var(--chip-caution);color:var(--chip-caution-ink)}",
      "#dailyRoot .dtag.wait{background:var(--chip-caution);color:var(--chip-caution-ink)}",
      "#dailyRoot .dlane.stuck .dtag.wait{background:var(--pill);color:var(--ink)}",
      "#dailyRoot .dlink{color:var(--hero-deep);font-weight:800;font-size:11.5px;background:none;border:0;padding:0;cursor:pointer;text-decoration:none}",
      "#dailyRoot .dlink:hover{text-decoration:underline}",
      "#dailyRoot .ddel{margin-left:auto;color:var(--muted);background:none;border:0;padding:0;font-size:11.5px;font-weight:700;cursor:pointer}",
      "#dailyRoot .ddel:hover,#dailyRoot .ddel.arm{color:var(--bad)}",
      "#dailyRoot select,#dailyRoot input[type=text]{border:1px solid var(--card-brd);background:var(--card);border-radius:10px;padding:6px 9px;min-width:0;font-weight:600;font-size:13px;max-width:100%}",
      "#dailyRoot input[type=text]{width:100%} #dailyRoot .dassign{font-size:11.5px;padding:1px 6px;border-radius:8px}",
      "#dailyRoot .dadd input{background:transparent;border-style:dashed}",
      "#dailyRoot .dcom{padding-left:26px;display:flex;flex-direction:column;gap:6px}",
      "#dailyRoot .dc{border-left:3px solid var(--card-brd);padding-left:9px;font-size:13px;overflow-wrap:anywhere}",
      "#dailyRoot .dc small{display:block;color:var(--muted);font-size:11px;font-weight:700}",
      "#dailyRoot .ddiv{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);border-top:1px solid var(--card-brd);padding-top:8px;margin-top:4px;font-weight:800}",
      "#dailyRoot .dempty{color:var(--muted);font-size:13px;padding:4px 2px}",
      "#dailyRoot .dnote{font-size:13px;font-weight:700;color:var(--bad)}",
      /* dashboard */
      "#dailyRoot .dgrid{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,2fr) minmax(280px,1fr);gap:12px}",
      "#dailyRoot .dtiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;min-height:0;grid-auto-rows:minmax(0,1fr)}",
      "#dailyRoot .dtile .big{font-size:34px;font-weight:800;line-height:1}",
      "#dailyRoot .dtile .head{display:flex;justify-content:space-between;align-items:flex-end;gap:8px}",
      "#dailyRoot .dtile .nm{font-weight:800;font-size:15px}",
      "#dailyRoot .dchipline{display:flex;gap:6px;flex-wrap:wrap}",
      "#dailyRoot .dpill{font-size:11px;font-weight:800;padding:2px 9px;border-radius:var(--r-pill);background:var(--pill);color:var(--muted)}",
      "#dailyRoot .dpill.bad{background:var(--chip-blocked);color:var(--chip-blocked-ink)} #dailyRoot .dpill.warn{background:var(--chip-caution);color:var(--chip-caution-ink)}",
      "#dailyRoot .dli{display:flex;flex-direction:column;gap:2px;padding:7px 0;border-top:1px solid var(--card-brd);font-size:13px}",
      "#dailyRoot .dli:first-of-type{border-top:0}",
      "#dailyRoot .dli .tt{font-weight:600;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;cursor:pointer}",
      "#dailyRoot .dli .tt:hover{color:var(--hero-deep)}",
      "#dailyRoot .dli .sub{font-size:11.5px;color:var(--muted);font-weight:600}",
      "#dailyRoot .dwho{font-weight:800;font-size:13px;margin-top:6px;display:flex;justify-content:space-between;gap:8px}",
      "#dailyRoot .dstuck .dli{border-top-color:rgba(0,0,0,.12)}",
      "@media(max-width:1000px){#dailyRoot .dgrid{grid-template-columns:minmax(0,1fr);overflow:auto}}"
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
  function daysSince(iso) { var d = new Date(iso); if (isNaN(d)) return 0; var t = new Date(); t.setHours(0, 0, 0, 0); d.setHours(0, 0, 0, 0); return Math.max(0, Math.round((t - d) / 86400000)); }
  var PARTY = { hci: "HCI", customer: "Customer", dealer: "Dealer", partner: "Partner" };

  /* ---- data helpers ---- */
  function proj(id) { var l = ctx.projects.all; for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i]; return null; }
  function tagOf(t) { var p = t.projectId && proj(t.projectId); return p ? (p.customer || p.name) : (t.hospital || "General"); }
  function ageIso(t) { return t.sourceDate || t.createdAt || ""; }
  function isDone(t) { return t.status === "done"; }
  function isWait(t) { return t.status === "waiting"; }
  function isOver(t) { return !isDone(t) && t.due && t.due < ctx.today(); }
  function owners() {
    var names = [], seen = {};
    ctx.team.forEach(function (m) { if (m.name && !seen[m.name]) { seen[m.name] = 1; names.push(m.name); } });
    return names;
  }
  function teamName(o) { for (var i = 0; i < ctx.team.length; i++) if (ctx.team[i].name === o) return o; return ""; }
  // The daily work list: anything stuck on someone else, plus HCI tasks that are assigned to a person, came from the Daily Update, or have no project.
  function workTasks() {
    var team = {}; ctx.team.forEach(function (m) { team[m.name] = 1; });
    return ctx.tasks.filter(function (t) {
      if (isWait(t)) return true;
      if ((t.party || "hci") !== "hci") return false;
      return !!t.source || !t.projectId || !!(t.owner && team[t.owner]);
    });
  }
  function peopleFor(pid) { return ctx.people.filter(function (p) { return p.projectId === pid && p.party !== "hci"; }); }
  function waitLabel(t) {
    var p = t.waitingOnId && ctx.people.filter(function (x) { return x.id === t.waitingOnId; })[0];
    if (p) return { name: p.name, org: [p.org, PARTY[p.party] || ""].filter(Boolean).join(" · ") };
    return { name: t.waitingOnName || "", org: "" };
  }
  function save(t, fields) {
    Object.keys(fields).forEach(function (k) { t[k] = fields[k]; });
    redraw();
    return ctx.save(t.id, fields).catch(function (e) { fail(e); });
  }
  var noteMsg = "";
  function fail(e) { noteMsg = "That change was not saved (" + ((e && (e.message || e.code)) || "error") + ")."; redraw(); setTimeout(function () { noteMsg = ""; redraw(); }, 6000); }

  /* ---- edit window ---- */
  function openEdit(t) {
    var root = document.getElementById("modalRoot"); if (!root) return;
    var isNew = !t;
    var cur = t || { title: "", owner: ctx.me || (ctx.team[0] || {}).name || "", projectId: "", hospital: "General", status: "open", due: "" };
    function opts(list, sel, blank) { return (blank ? '<option value="">' + blank + "</option>" : "") + list.map(function (o) { return '<option value="' + ctx.esc(o[0]) + '"' + (String(o[0]) === String(sel) ? " selected" : "") + ">" + ctx.esc(o[1]) + "</option>"; }).join(""); }
    var ownerList = owners().map(function (n) { return [n, n]; });
    var projList = ctx.projects.all.map(function (p) { return [p.id, p.name]; });
    function waitList(pid) { return peopleFor(pid).map(function (p) { return [p.id, p.name + " · " + [p.org, PARTY[p.party]].filter(Boolean).join(", ")]; }); }
    root.innerHTML = '<div class="scrim" data-close="1"><form class="modal" id="mform" novalidate><h2>' + (isNew ? "New task" : "Edit task") + '</h2><div class="fgrid">' +
      '<div class="field full"><label for="e_title">Task</label><input id="e_title" name="title" value="' + ctx.esc(cur.title) + '"></div>' +
      '<div class="field"><label for="e_owner">HCI person</label><select id="e_owner" name="owner">' + opts(ownerList, cur.owner, "Unassigned") + "</select></div>" +
      '<div class="field"><label for="e_proj">Project</label><select id="e_proj" name="projectId">' + opts(projList, cur.projectId, "No project (HCI general)") + "</select></div>" +
      '<div class="field"><label for="e_status">Status</label><select id="e_status" name="status">' + opts([["open", "Open"], ["waiting", "Stuck, waiting on someone else"], ["done", "Done"]], cur.status) + "</select></div>" +
      '<div class="field"><label for="e_due">Due</label><input id="e_due" type="date" name="due" value="' + ctx.esc(cur.due || "") + '"></div>' +
      '<div class="field full" id="e_waitbox"><label for="e_wait">Waiting on (dealer, vendor or customer on the project)</label><select id="e_wait" name="waitingOnId"></select>' +
      '<input id="e_waitname" name="waitingOnName" placeholder="Or type who, if they are not on the project" value="' + ctx.esc(cur.waitingOnId ? "" : cur.waitingOnName || "") + '" style="margin-top:6px"></div>' +
      '<div class="field full" id="e_hospbox"><label for="e_hosp">Hospital tag (when there is no project yet)</label><input id="e_hosp" name="hospital" value="' + ctx.esc(cur.hospital || "") + '"></div>' +
      '</div><div class="mfoot"><div class="r"><button type="button" class="btn sec" data-close="1">Cancel</button><button type="submit" class="btn">Save</button></div></div></form></div>';
    var f = document.getElementById("mform");
    function sync() {
      var pid = f.projectId.value, st = f.status.value;
      document.getElementById("e_waitbox").hidden = st !== "waiting";
      document.getElementById("e_hospbox").hidden = !!pid;
      var keep = f.waitingOnId.value || cur.waitingOnId || "";
      f.waitingOnId.innerHTML = opts(waitList(pid), keep, pid ? "Not picked, use the name below" : "Pick a project to choose a person");
      f.waitingOnId.value = keep && waitList(pid).some(function (x) { return x[0] === keep; }) ? keep : "";
    }
    f.projectId.onchange = function () { f.waitingOnId.value = ""; sync(); }; f.status.onchange = sync; sync();
    f.title.focus();
    f.onsubmit = function (ev) {
      ev.preventDefault();
      var title = f.title.value.trim(); if (!title) return;
      var pid = f.projectId.value, st = f.status.value, wid = st === "waiting" ? f.waitingOnId.value : "";
      var person = wid && ctx.people.filter(function (x) { return x.id === wid; })[0];
      var fields = {
        title: title, owner: f.owner.value, projectId: pid, status: st, due: f.due.value,
        hospital: pid ? (proj(pid) ? (proj(pid).customer || proj(pid).name) : f.hospital.value) : (f.hospital.value.trim() || "General"),
        waitingOnId: wid, waitingOnName: st === "waiting" ? (person ? person.name : f.waitingOnName.value.trim()) : "",
        waitingSince: st === "waiting" ? (cur.status === "waiting" && cur.waitingSince ? cur.waitingSince : new Date().toISOString()) : "",
        doneAt: st === "done" ? (cur.doneAt || new Date().toISOString()) : ""
      };
      var p = proj(pid); fields.phase = p ? Number(p.phase) || 0 : (cur.phase || 0);
      root.innerHTML = "";
      if (isNew) {
        ctx.add(Object.assign({ party: "hci", visibility: "internal", note: "", source: "Added in the Hub", sourceDate: ctx.today(), createdAt: new Date().toISOString() }, fields)).then(function () { ctx.refresh(); }).catch(fail);
      } else save(t, fields);
    };
  }

  /* ---- cards ---- */
  function taskEl(t) {
    var cb = el("input", { type: "checkbox", "aria-label": "Mark done" }); cb.checked = isDone(t);
    cb.addEventListener("change", function () { save(t, cb.checked ? { status: "done", doneAt: new Date().toISOString() } : { status: "open", doneAt: "", waitingOnId: "", waitingOnName: "", waitingSince: "" }); });
    var meta = el("div", { class: "dmeta" });
    var a = ageIso(t);
    if (a) { var n = daysSince(a); meta.appendChild(el("span", { class: "dtag" + (!isDone(t) && n >= 3 ? " old" : ""), text: fmtDay(a) + (n > 0 ? " · " + n + "d" : " · new"), title: t.source || "" })); }
    if (t.projectId && proj(t.projectId)) {
      var pl = el("button", { type: "button", class: "dtag dlink", title: "Open the project: " + proj(t.projectId).name, text: tagOf(t) });
      pl.addEventListener("click", function () { ctx.openProject(t.projectId); }); meta.appendChild(pl);
    } else meta.appendChild(el("span", { class: "dtag", text: tagOf(t) }));
    if (isWait(t)) { var w = waitLabel(t); meta.appendChild(el("span", { class: "dtag wait", text: "Waiting on " + (w.name || "someone") + (t.waitingSince ? " · " + daysSince(t.waitingSince) + "d" : ""), title: w.org })); }
    if (t.due) meta.appendChild(el("span", { class: "dtag" + (isOver(t) ? " old" : ""), text: (isOver(t) ? "Overdue · " : "Due ") + fmtDay(t.due) }));
    var as = el("select", { class: "dassign", "aria-label": "HCI person" });
    as.appendChild(el("option", { value: "", text: "Unassigned" }));
    var nm = owners(); if (t.owner && nm.indexOf(t.owner) < 0) nm.push(t.owner);
    nm.forEach(function (n2) { var o = el("option", { value: n2, text: isWait(t) ? "Chasing: " + n2 : n2 }); if (n2 === t.owner) o.selected = true; as.appendChild(o); });
    as.addEventListener("change", function () { save(t, { owner: as.value }); });
    meta.appendChild(as);
    var cs = ctx.comments(t.id);
    var tg = el("button", { class: "dlink", type: "button", text: cs.length ? (state.open[t.id] ? "Hide comments" : "Comments (" + cs.length + ")") : (state.open[t.id] ? "Hide" : "Comment") });
    tg.addEventListener("click", function () { state.open[t.id] = !state.open[t.id]; redraw(); }); meta.appendChild(tg);
    var ed = el("button", { class: "dlink", type: "button", text: "Edit" }); ed.addEventListener("click", function () { openEdit(t); }); meta.appendChild(ed);
    var on = state.armed === t.id;
    var del = el("button", { class: "ddel" + (on ? " arm" : ""), type: "button", text: on ? "Delete?" : "Delete" });
    del.addEventListener("click", function () {
      if (state.armed === t.id) { state.armed = null; clearTimeout(armTimer); ctx.del(t.id).catch(fail); ctx.tasks.splice(ctx.tasks.indexOf(t), 1); redraw(); }
      else { state.armed = t.id; clearTimeout(armTimer); armTimer = setTimeout(function () { state.armed = null; redraw(); }, 3500); redraw(); }
    });
    meta.appendChild(del);
    var kids = [el("div", { class: "drow" }, [cb, (function () { var x = el("div", { class: "dtxt", text: t.title || "", title: "Click to edit", style: "cursor:pointer" }); x.addEventListener("click", function () { openEdit(t); }); return x; })()]), meta];
    if (state.open[t.id]) {
      var box = el("div", { class: "dcom" });
      cs.forEach(function (c) { box.appendChild(el("div", { class: "dc" }, [el("div", { text: c.text || "" }), el("small", { text: (c.by || "Someone") + " · " + fmtStamp(c.at) })])); });
      var inp = el("input", { type: "text", placeholder: "Add a comment, press Enter", "aria-label": "Add a comment" });
      inp.value = state.drafts[t.id] || "";
      inp.addEventListener("input", function () { state.drafts[t.id] = inp.value; });
      inp.addEventListener("keydown", function (e) { if (e.key === "Enter" && inp.value.trim()) { var tx = inp.value.trim(); state.drafts[t.id] = ""; ctx.addComment(t, tx).catch(fail); } });
      box.appendChild(inp); kids.push(box);
    }
    return el("article", { class: "dtask" + (isDone(t) ? " done" : "") }, kids);
  }

  /* ---- board ---- */
  function boardView(root) {
    var all = workTasks();
    var open = all.filter(function (t) { return !isDone(t); }).length, done = all.length - open;
    var chipsCount = {}, total = 0;
    all.forEach(function (t) { if (isDone(t)) return; var g = tagOf(t); chipsCount[g] = (chipsCount[g] || 0) + 1; total++; });
    var sd = el("input", { type: "checkbox" }); sd.checked = state.showDone;
    sd.addEventListener("change", function () { state.showDone = sd.checked; try { localStorage.setItem("hub.daily.showDone", state.showDone ? "1" : "0"); } catch (e) {} redraw(); });
    var addBtn = el("button", { type: "button", class: "btn sm", text: "New task" }); addBtn.addEventListener("click", function () { openEdit(null); });
    root.appendChild(el("div", { class: "dtop" }, [el("span", { class: "dsync", text: syncText() }), el("div", { class: "dstats" }, [
      el("span", null, [el("b", { text: String(open) }), document.createTextNode(" open · "), el("b", { text: String(all.filter(isWait).length) }), document.createTextNode(" stuck on others · "), el("b", { text: String(all.filter(isOver).length) }), document.createTextNode(" overdue · "), el("b", { text: String(done) }), document.createTextNode(" done")]),
      el("label", { style: "display:inline-flex;gap:6px;align-items:center;cursor:pointer" }, [sd, document.createTextNode("Show done")]), addBtn])]));
    var chips = el("div", { class: "dchips", role: "group", "aria-label": "Filter by project or hospital" });
    var mk = function (label, val, n) {
      var b = el("button", { type: "button", class: "fchip" + (state.filter === val ? " on" : ""), "aria-pressed": state.filter === val ? "true" : "false", text: label + " " + n });
      b.addEventListener("click", function () { state.filter = val; redraw(); }); chips.appendChild(b);
    };
    mk("All", "all", total);
    Object.keys(chipsCount).sort().forEach(function (g) { mk(g, g, chipsCount[g]); });
    if (state.filter !== "all" && !chipsCount[state.filter]) mk(state.filter, state.filter, 0);
    root.appendChild(chips);
    if (noteMsg) root.appendChild(el("div", { class: "dnote", text: noteMsg }));
    var board = el("div", { class: "dboard" });
    var pool = all.filter(function (t) { return state.filter === "all" || tagOf(t) === state.filter; });
    if (!state.showDone) pool = pool.filter(function (t) { return !isDone(t); });
    function sortFn(x, y) { return String(ageIso(x)).localeCompare(String(ageIso(y))) || String(x.createdAt || "").localeCompare(String(y.createdAt || "")) || String(x.id).localeCompare(String(y.id)); }
    function lane(name, items, stuck, ownerName) {
      var o = items.filter(function (t) { return !isDone(t); }).sort(sortFn), d = items.filter(isDone).sort(sortFn);
      var le = el("section", { class: "dlane" + (stuck ? " stuck" : ""), "aria-label": name }, [el("h2", null, [el("div", { text: name }), el("span", { text: String(o.length) })])]);
      if (!items.length) le.appendChild(el("div", { class: "dempty", text: "Nothing here." }));
      var one = function (t) { try { le.appendChild(taskEl(t)); } catch (err) { le.appendChild(el("div", { class: "dempty", text: "Could not draw: " + (t.title || t.id) })); } };
      o.forEach(one);
      if (!stuck) {
        var inp = el("input", { type: "text", placeholder: "Add a task, press Enter", "aria-label": "Add a task for " + name });
        inp.value = state.drafts["add_" + name] || "";
        inp.addEventListener("input", function () { state.drafts["add_" + name] = inp.value; });
        inp.addEventListener("keydown", function (e) {
          if (e.key === "Enter" && inp.value.trim()) {
            var v = inp.value.trim(); state.drafts["add_" + name] = "";
            var pj = ctx.projects.all.filter(function (p) { return (p.customer || p.name) === state.filter; })[0];
            ctx.add({ title: v, owner: ownerName || "", party: "hci", visibility: "internal", status: "open", due: "", note: "", projectId: pj ? pj.id : "", hospital: state.filter !== "all" ? state.filter : "General", phase: pj ? Number(pj.phase) || 0 : 0, source: "Added in the Hub", sourceDate: ctx.today(), createdAt: new Date().toISOString() }).then(function () { ctx.refresh(); }).catch(fail);
          }
        });
        le.appendChild(el("div", { class: "dadd" }, [inp]));
      }
      if (d.length) { le.appendChild(el("div", { class: "ddiv", text: "Done · " + d.length })); d.forEach(one); }
      board.appendChild(le);
    }
    var names = owners();
    names.forEach(function (n) { lane(n, pool.filter(function (t) { return t.owner === n && !isWait(t); }), false, n); });
    var un = pool.filter(function (t) { return !teamName(t.owner) && !isWait(t); });
    if (un.length) lane("Unassigned", un, false, "");
    lane("Stuck, waiting on others", pool.filter(isWait).sort(function (x, y) { return waitLabel(x).name.localeCompare(waitLabel(y).name); }), true, "");
    root.appendChild(board);
  }

  function syncText() {
    var m = ctx.meta;
    if (!m || (!m.lastMeeting && !m.lastRun)) return "New items arrive each weekday morning from the Daily Update notes.";
    return ["From the " + (m.lastMeeting || "latest") + " Daily Update", m.lastRun ? "refreshed " + fmtStamp(m.lastRun) : ""].filter(Boolean).join(" · ");
  }

  /* ---- front dashboard ---- */
  function dashView(root) {
    var all = workTasks().filter(function (t) { return !isDone(t); });
    var open = all.filter(function (t) { return !isWait(t); }), stuck = all.filter(isWait);
    var over = all.filter(isOver).length;
    var board = el("button", { type: "button", class: "btn sm", text: "Open the board" }); board.addEventListener("click", function () { ctx.openTab("daily"); });
    root.appendChild(el("div", { class: "dtop" }, [el("span", { class: "dsync", text: syncText() }), el("div", { class: "dstats" }, [
      el("span", null, [el("b", { text: String(open.length) }), document.createTextNode(" open")]),
      el("span", { class: "warn" }, [el("b", { text: String(stuck.length) }), document.createTextNode(" stuck on others")]),
      el("span", { class: "bad" }, [el("b", { text: String(over) }), document.createTextNode(" overdue")]), board])]));
    function oldest(x, y) { return String(ageIso(x)).localeCompare(String(ageIso(y))); }
    var tiles = el("div", { class: "dtiles" });
    function tile(name, ownerKey) {
      var mine = open.filter(function (t) { return teamName(t.owner) === ownerKey; }).sort(oldest);
      var chasing = stuck.filter(function (t) { return teamName(t.owner) === ownerKey; }).length;
      var od = mine.filter(isOver).length;
      var te = el("section", { class: "dtile" }, [
        el("div", { class: "head" }, [el("div", null, [el("div", { class: "nm", text: name }), el("div", { class: "dchipline" }, [
          od ? el("span", { class: "dpill bad", text: od + " overdue" }) : null,
          chasing ? el("span", { class: "dpill warn", text: chasing + " chasing others" }) : null])]), el("div", { class: "big", text: String(mine.length) })])]);
      if (!mine.length) te.appendChild(el("div", { class: "dempty", text: "Nothing open." }));
      mine.slice(0, 8).forEach(function (t) {
        var tt = el("div", { class: "tt", text: t.title }); tt.addEventListener("click", function () { openEdit(t); });
        te.appendChild(el("div", { class: "dli" }, [tt, el("div", { class: "sub", text: [tagOf(t), ageIso(t) ? daysSince(ageIso(t)) + "d old" : "", isOver(t) ? "overdue" : ""].filter(Boolean).join(" · ") })]));
      });
      if (mine.length > 8) { var more = el("button", { type: "button", class: "dlink", text: "+ " + (mine.length - 8) + " more on the board" }); more.addEventListener("click", function () { ctx.openTab("daily"); }); te.appendChild(more); }
      tiles.appendChild(te);
    }
    owners().forEach(function (n) { tile(n, n); });
    if (open.some(function (t) { return !teamName(t.owner); })) tile("Unassigned", "");
    // stuck on third parties, grouped by who we are waiting on
    var groups = {}, order = [];
    stuck.forEach(function (t) { var w = waitLabel(t), key = w.name || "Not named yet"; if (!groups[key]) { groups[key] = { org: w.org, items: [] }; order.push(key); } if (!groups[key].org && w.org) groups[key].org = w.org; groups[key].items.push(t); });
    order.sort(function (a, b) { return groups[b].items.length - groups[a].items.length; });
    var st = el("section", { class: "dstuck" }, [el("h2", null, [el("div", { text: "Stuck, waiting on third parties" }), el("span", { text: String(stuck.length) })])]);
    if (!stuck.length) st.appendChild(el("div", { class: "dempty", text: "Nothing is stuck. Open a task and set its status to stuck to put it here." }));
    order.forEach(function (k) {
      var g = groups[k];
      st.appendChild(el("div", { class: "dwho" }, [el("span", { text: k + (g.org ? " · " + g.org : "") }), el("span", { class: "dpill warn", text: String(g.items.length) })]));
      g.items.sort(function (x, y) { return String(x.waitingSince || "").localeCompare(String(y.waitingSince || "")); }).forEach(function (t) {
        var tt = el("div", { class: "tt", text: t.title }); tt.addEventListener("click", function () { openEdit(t); });
        st.appendChild(el("div", { class: "dli" }, [tt, el("div", { class: "sub", text: [tagOf(t), t.waitingSince ? "waiting " + daysSince(t.waitingSince) + "d" : "", t.owner ? "chasing: " + t.owner : ""].filter(Boolean).join(" · ") })]));
      });
    });
    root.appendChild(el("div", { class: "dgrid" }, [tiles, st]));
    if (noteMsg) root.appendChild(el("div", { class: "dnote", text: noteMsg }));
  }

  function redraw() {
    if (!mount || !document.body.contains(mount)) return;
    mount.textContent = "";
    var root = el("div", { id: "dailyRoot" });
    try { if (view === "board") boardView(root); else dashView(root); }
    catch (err) { root.appendChild(el("div", { class: "dnote", text: "Display error: " + (err && err.message ? err.message : String(err)) })); }
    mount.appendChild(root);
  }

  window.HUB_DAILY = {
    // which: "dash" for the front dashboard, "board" for the board
    mount: function (target, which, c) { css(); mount = target; view = which; ctx = c; redraw(); }
  };
})();
