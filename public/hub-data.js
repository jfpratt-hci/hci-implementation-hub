// Data layer for the hosted Hub. Exposes window.claude.use("db" | "downloads" | "assets")
// with the same shape the Hub page was written against, backed by the server's /api.
// Also handles Microsoft Teams: theme, and the project a channel tab was configured for.
(function () {
  "use strict";
  var POLL_MS = 6000;
  var listeners = [];        // {col, next, err}
  var seen = {};             // col -> version last delivered
  var current = null;        // last /api/all payload
  var timer = null, inflight = null;

  function snapshotFor(col) {
    var map = (current && current.cols && current.cols[col]) || {};
    var docs = Object.keys(map).map(function (id) {
      var d = map[id];
      return { id: id, exists: true, data: function () { return d; }, metadata: { fromCache: false, hasPendingWrites: false } };
    });
    return { docs: docs, size: docs.length, empty: !docs.length, docChanges: function () { return []; }, metadata: { fromCache: false, hasPendingWrites: false } };
  }
  function deliver(force) {
    if (!current) return;
    listeners.forEach(function (l) {
      var v = current.versions[l.col];
      if (force || seen[l.col + "|" + l.id] !== v) {
        seen[l.col + "|" + l.id] = v;
        try { l.next(snapshotFor(l.col)); } catch (e) { console.error(e); }
      }
    });
  }
  function refresh() {
    if (inflight) return inflight;
    var since = current ? current.version : 0;
    inflight = fetch("/api/all?since=" + since, { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j.unchanged) { current = j; deliver(false); }
    }).catch(function (e) { console.warn("refresh failed", e); }).then(function () { inflight = null; });
    return inflight;
  }
  function schedulePoll() {
    clearTimeout(timer);
    timer = setTimeout(function () { refresh().then(schedulePoll); }, document.hidden ? POLL_MS * 5 : POLL_MS);
  }
  document.addEventListener("visibilitychange", function () { if (!document.hidden) { refresh(); } schedulePoll(); });

  function who() { try { return localStorage.getItem("hub.me") || ""; } catch (e) { return ""; } }
  var bearer = "";   // Teams single sign on token, when the page runs inside Teams
  function hdrs(extra) { var h = { "X-Hub-User": who() }; if (bearer) h["Authorization"] = "Bearer " + bearer; if (extra) for (var k in extra) h[k] = extra[k]; return h; }
  var _fetch = window.fetch.bind(window);
  function fetch(url, opts) { opts = opts || {}; opts.headers = Object.assign({}, hdrs(), opts.headers || {}); opts.credentials = "same-origin"; return _fetch(url, opts); }
  function req(method, url, body) {
    var headers = body ? { "Content-Type": "application/json" } : {};
    return fetch(url, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) { throw { code: "invalid_argument", message: j.error || (r.status + " " + r.statusText) }; }); return r.json(); })
      .then(function (j) { refresh(); return j; });
  }
  var seq = 0;
  function collection(col) {
    return {
      path: col,
      onSnapshot: function (next, err) {
        var l = { col: col, next: next, err: err, id: ++seq };
        listeners.push(l);
        if (current) { seen[col + "|" + l.id] = current.versions[col]; next(snapshotFor(col)); }
        else if (!inflight) { refresh().then(function () { /* deliver() ran */ }); }
        if (!timer) schedulePoll();
        return function () { listeners = listeners.filter(function (x) { return x !== l; }); };
      },
      add: function (data) { return req("POST", "/api/" + col, data).then(function (j) { return doc(col, j.id); }); },
      doc: function (id) { return doc(col, id); },
      where: function () { return collection(col); }, orderBy: function () { return collection(col); }, limit: function () { return collection(col); },
      get: function () { return refresh().then(function () { return snapshotFor(col); }); }
    };
  }
  function doc(col, id) {
    return {
      id: id, path: col + "/" + id,
      get: function () { return refresh().then(function () { var d = current.cols[col][id]; return { id: id, exists: !!d, data: function () { return d; } }; }); },
      set: function (data) { return req("PUT", "/api/" + col + "/" + encodeURIComponent(id), data).then(function () {}); },
      update: function (data) { return req("PATCH", "/api/" + col + "/" + encodeURIComponent(id), data).then(function () {}); },
      delete: function () { return req("DELETE", "/api/" + col + "/" + encodeURIComponent(id)).then(function () {}); },
      collection: function (sub) { return collection(col + "/" + id + "/" + sub); }
    };
  }
  var db = { collection: collection, doc: function (p) { var s = p.split("/"); return doc(s.slice(0, -1).join("/"), s[s.length - 1]); } };
  var downloads = {
    save: function (o) {
      var blob = o.data instanceof Blob ? o.data : new Blob([o.data], { type: "text/csv" });
      var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = o.filename || "download"; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
      return Promise.resolve({ status: "saved" });
    }
  };
  var assets = {
    upload: function (blob) {
      return fetch("/api/upload", { method: "POST", headers: { "Content-Type": blob.type || "image/png" }, body: blob })
        .then(function (r) { if (!r.ok) throw { code: "unsupported_type", message: "Upload refused" }; return r.json(); });
    },
    delete: function (id) { return fetch("/api/upload/" + encodeURIComponent(id), { method: "DELETE" }).then(function () {}); },
    list: function () { return Promise.resolve({ assets: [], usage: {} }); }
  };
  // SharePoint documents (server side, see files.js). The Hub page uses this when present.
  function jget(r){ return r.json().catch(function(){return {};}).then(function(j){ if(!r.ok) throw Object.assign(new Error(j.error||r.statusText),{status:r.status,setup:!!j.setup}); return j; }); }
  window.HUB_FILES = {
    list: function(pid){ return fetch("/api/files/"+encodeURIComponent(pid),{cache:"no-store"}).then(jget); },
    types: function(){ return fetch("/api/files/types").then(jget); },
    preview: function(pid,id){ return fetch("/api/files/"+encodeURIComponent(pid)+"/preview/"+encodeURIComponent(id),{method:"POST"}).then(jget); },
    download: function(pid,id){ return fetch("/api/files/"+encodeURIComponent(pid)+"/download/"+encodeURIComponent(id)+"?json=1").then(jget); },
    upload: function(pid,file,type,desc,version,onProgress){
      return new Promise(function(resolve,reject){
        var x=new XMLHttpRequest();
        x.open("POST","/api/files/"+encodeURIComponent(pid)+"/upload?type="+encodeURIComponent(type)+"&desc="+encodeURIComponent(desc)+"&filename="+encodeURIComponent(file.name)+(version?"&version="+encodeURIComponent(version):""));
        var h=hdrs({"Content-Type":"application/octet-stream"}); for(var k in h) x.setRequestHeader(k,h[k]);
        x.withCredentials=true;
        if(x.upload&&onProgress) x.upload.onprogress=function(e){ if(e.lengthComputable) onProgress(e.loaded/e.total); };
        x.onload=function(){ var j={}; try{j=JSON.parse(x.responseText)}catch(e){} if(x.status>=200&&x.status<300) resolve(j); else reject(new Error(j.error||("Upload failed ("+x.status+")"))); };
        x.onerror=function(){ reject(new Error("Upload failed")); };
        x.send(file);
      });
    },
    rename: function(pid,id,body){ return fetch("/api/files/"+encodeURIComponent(pid)+"/rename/"+encodeURIComponent(id),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}).then(jget); }
  };
  var caps = { db: db, downloads: downloads, assets: assets };
  // Sign in first: inside Teams through single sign on, in a browser through the App Service sign in page.
  function signInScreen(login) {
    var boot = document.getElementById("boot") || document.body;
    boot.innerHTML = '<div style="display:flex;flex-direction:column;gap:14px;align-items:center;text-align:center;max-width:36ch"><div style="font-weight:800;font-size:20px">HCI Implementation Hub</div><div>Sign in with your Microsoft account to open the Hub.</div><a class="btn" href="' + login + '" style="text-decoration:none">Sign in with Microsoft</a></div>';
  }
  var ready = (function () {
    var teams = window.microsoftTeams && window.microsoftTeams.app;
    var tokenP = Promise.resolve("");
    if (teams) tokenP = teams.initialize().then(function () { return window.microsoftTeams.authentication.getAuthToken(); }).catch(function () { return ""; });
    return tokenP.then(function (t) { bearer = t || ""; return fetch("/api/me", { cache: "no-store" }); }).then(function (r) {
      if (r.status === 401) return r.json().catch(function () { return {}; }).then(function (j) { signInScreen(j.login || "/.auth/login/aad?post_login_redirect_uri=" + encodeURIComponent(location.pathname + location.search)); return false; });
      if (!r.ok) throw new Error("me " + r.status);
      return r.json().then(function (me) {
        if (!me.dev) { window.HUB_IDENTITY = me; try { localStorage.setItem("hub.me", me.name || me.email || ""); } catch (e) {} }
        if (me.role === "none") { var boot = document.getElementById("boot"); if (boot) boot.textContent = "Your account (" + me.email + ") is not on any project team yet. Ask HCI to add you."; return false; }
        return true;
      });
    }).catch(function (e) { console.warn("identity", e); return true; });
  })();
  // When sign in is needed, never resolve: the Hub page would otherwise replace the sign in screen with an error.
  window.claude = { use: function (name) { return ready.then(function (ok) { return ok ? (caps[name] || null) : new Promise(function () {}); }); } };
  window.HUB_SERVER_AUDIT = true; // the server records the audit trail; the page must not write its own

  // Which project this tab was configured for (channel tab) or a portfolio landing (personal tab).
  var q = new URLSearchParams(location.search);
  if (q.get("project")) window.HUB_PRESELECT = { pid: q.get("project"), scope: "project", view: "overview" };
  else if (q.get("scope") === "portfolio") window.HUB_PRESELECT = { scope: "portfolio", view: "portfolio" };

  // Microsoft Teams: follow the Teams theme and tell Teams the tab loaded.
  function applyTheme(t) { document.documentElement.dataset.theme = (t === "dark" || t === "contrast") ? "dark" : "light"; }
  if (window.microsoftTeams && window.microsoftTeams.app) {
    var app = window.microsoftTeams.app;
    ready.then(function () { return app.initialize(); }).then(function () {
      app.getContext().then(function (ctx) { applyTheme(ctx.app && ctx.app.theme); }).catch(function () {});
      app.registerOnThemeChangeHandler(applyTheme);
      app.notifySuccess();
    }).catch(function () { /* not inside Teams */ });
  }
})();
