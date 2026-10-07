var currentData = null;
var currentTab = "live";
var searchQuery = "";
var _barSettings = { showPct: true, showTimeLeft: false };
var _appearance = "dark";
var _accounts = [];
var _activeAccount = -1;
var _claimStatus = null;

function sendMsg(msg, cb) {
  try {
    chrome.runtime.sendMessage(msg, function (res) {
      if (chrome.runtime.lastError) { if (cb) cb(null); return; }
      if (cb) cb(res);
    });
  } catch (e) { if (cb) cb(null); }
}

function on(id, fn) {
  var el = document.getElementById(id);
  if (el) el.addEventListener("click", fn);
}

document.addEventListener("DOMContentLoaded", function () {
  on("scanBtn", runScan);
  on("claimNowBtn", claimNow);
  on("dbgBtn", function () {
    var p = document.getElementById("debugPanel");
    if (p) p.style.display = (p.style.display === "block") ? "none" : "block";
  });
  on("settingsBtn", openSettings);
  on("historyBtn", openHistory);
  on("historyCloseBtn", function () { document.getElementById("historyOverlay").style.display = "none"; });
  on("historyClear", function () {
    chrome.storage.local.set({ claimHistory: [] }, renderHistory);
  });
  on("aboutBtn", function () {
    var m = chrome.runtime.getManifest();
    document.getElementById("aboutVersion").textContent = "v" + m.version;
    document.getElementById("aboutOverlay").style.display = "flex";
  });
  on("aboutCloseBtn", function () { document.getElementById("aboutOverlay").style.display = "none"; });
  on("bugBtn", collectBugs);

  // settings tab switching
  var settabs = document.querySelectorAll(".settab");
  for (var si = 0; si < settabs.length; si++) {
    settabs[si].addEventListener("click", function () {
      var id = this.dataset.settab;
      var all = document.querySelectorAll(".settab");
      for (var sj = 0; sj < all.length; sj++) all[sj].classList.remove("active");
      this.classList.add("active");
      document.getElementById("panel-notif").style.display = id === "notif" ? "block" : "none";
      document.getElementById("panel-auto").style.display = id === "auto" ? "block" : "none";
      document.getElementById("panel-adv").style.display = id === "adv" ? "block" : "none";
      document.getElementById("panel-accounts").style.display = id === "accounts" ? "block" : "none";
    });
  }
  on("settingsCloseBtn", function () {
    var o = document.getElementById("settingsOverlay");
    if (o) o.style.display = "none";
    if (window._stLineTimer) { clearInterval(window._stLineTimer); window._stLineTimer = null; }
  });
  wireSettingsControls();

  var tabs = document.querySelectorAll(".tab");
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].addEventListener("click", function () {
      var all = document.querySelectorAll(".tab");
      for (var j = 0; j < all.length; j++) all[j].classList.remove("active");
      this.classList.add("active");
      currentTab = this.dataset.tab;
      render();
    });
  }

  var searchEl = document.getElementById("dropSearch");
  if (searchEl) {
    searchEl.addEventListener("input", function () {
      searchQuery = this.value;
      render();
    });
  }

  // live-refresh whenever the background writes new data
  if (typeof chrome === "undefined" || !chrome.storage) {
    seedPreview();
    return;
  }

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === "storage" && changes.lastScan && changes.lastScan.newValue) {
      currentData = changes.lastScan.newValue;
      updateTheme(currentData.source);
      updateCounts();
      render();
      setDebug(currentData.debug);
      renderStatusLine();
    }
  });

  // load cached scan + resume overlay if a scan is still running
  chrome.storage.local.get(["lastScan", "scanState"], function (data) {
    loadDisplayOptions();
    loadAccounts();
    loadClaimStatus();
    if (data.lastScan && data.lastScan.drops) {
      currentData = data.lastScan;
      updateTheme(currentData.source);
      updateCounts();
      render();
      setDebug(data.lastScan.debug);
      var btn0 = document.getElementById("scanBtn");
      if (btn0) btn0.textContent = "Scan";
    }
    if (data.scanState && data.scanState.state === "running") {
      showOverlay(data.scanState.step || "Scanning ...");
      pollScan();
    }
    // self-heal: if data is stale, trigger a background update right away
    if (data.lastScan && data.lastScan.lastUpdated) {
      var ageMin = (Date.now() - new Date(data.lastScan.lastUpdated).getTime()) / 60000;
      if (ageMin > 8 && !(data.scanState && data.scanState.state === "running")) {
        sendMsg({ action: "forceUpdate" });
      }
    }
    // countdown to next auto-refresh (2-min tick, 10-min data), plus updater status
    startCountdown();
  });
});

function seedPreview() {
  function art(hex, label) {
    return "data:image/svg+xml," + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><rect width="240" height="240" fill="' + hex + '"/><text x="120" y="126" text-anchor="middle" fill="#f4eadf" font-size="22" font-family="Segoe UI">' + label + "</text></svg>"
    );
  }
  currentData = {
    source: "twitch",
    campaignEndTs: Date.now() + 6.8 * 3600000,
    drops: [
      {
        name: "Large Wood Box", displayName: "Large Wood Box", image: art("#5a3a22", "Box"), claimed: false, live: true,
        hours: "2 hours", pct: 64, wasReady: false, isGeneral: false,
        streamers: [{ name: "shroud", live: true, url: "https://www.twitch.tv/shroud" }, { name: "ironmouse", live: false, url: "https://www.twitch.tv/ironmouse" }]
      },
      {
        name: "Auto Turret", displayName: "Auto Turret", image: art("#2c3338", "Turret"), claimed: false, live: true,
        hours: "3 hours", pct: 100, wasReady: true, isGeneral: true, watchUrl: "https://www.twitch.tv/directory/category/rust",
        streamers: []
      },
      { name: "Large Wood Box", claimed: true, image: art("#5a3a22", "Box") },
      { name: "Auto Turret", claimed: true, image: art("#2c3338", "Turret") },
      { name: "Small Box", claimed: true, image: art("#4a3428", "Small") },
      { name: "Pants", claimed: true, image: art("#3a4a32", "Pants") },
      { name: "Work Boots", claimed: true, image: art("#3a2a20", "Boots") },
      { name: "Hoodie", claimed: true, image: art("#4a2830", "Hoodie") }
    ]
  };
  updateTheme("twitch");
  updateCounts();
  currentTab = "claimed";
  var tabs = document.querySelectorAll(".tab");
  for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle("active", tabs[i].dataset.tab === "claimed");
  render();
}

var _cdTimer = null;
function startCountdown() {
  if (_cdTimer) clearInterval(_cdTimer);
  renderStatusLine();
  _cdTimer = setInterval(renderStatusLine, 1000);
}

function applyAppearance(mode) {
  if (mode !== "dark" && mode !== "light") mode = "dark";
  _appearance = mode;
  if (document.body) document.body.setAttribute("data-mode", mode);
  updateTheme(currentData ? currentData.source : "twitch");
}

function updateTheme(source) {
  if (!source) source = "twitch";
  // red for a Twitch round (or no round), green for a Kick round
  var liveRound = !!(currentData && currentData.campaignLive && currentData.drops && currentData.drops.length);
  document.body.setAttribute("data-theme", liveRound && source === "kick" ? "kick" : (source === "kick" ? "kick" : "twitch"));
  var chip = document.getElementById("sourceChip");
  if (chip) {
    chip.textContent = liveRound ? (source === "kick" ? "Kick" : "Twitch") : (source === "kick" ? "Kick" : (currentData && currentData.drops && currentData.drops.length ? "Twitch" : "No round"));
    chip.style.color = "#1a1410";
  }
}

// Rebuilds the whole status line from scratch every call (from currentData +
// live storage state) instead of splicing strings onto the previous text.
// The old splice approach only stripped " | tick"/" | src" substrings, so a
// stale "UPDATER ERROR"/"ERR:" segment written once could never be removed
// and kept getting added to on every tick.
function renderStatusLine() {
  chrome.storage.local.get("alarmHeartbeat", function (h) {
    var el = document.getElementById("updatedAgo");
    if (!el) return;
    updateRoundCountdown();
    if (!h.alarmHeartbeat) { el.textContent = ""; return; }
    var tickAt = new Date(h.alarmHeartbeat.at).getTime();
    var nextData = Math.max(0, 20 - Math.round((Date.now() - tickAt) / 1000));
    var nextLive = Math.max(0, 60 - (Math.round((Date.now() - tickAt) / 1000) % 60));
    el.textContent = "updating progress in " + nextData + "s | updating stream channels in " + nextLive + "s";
    el.style.color = "#adadb8";
  });
}

function setDebug(debug) { /* debug panel removed */ }

function showOverlay(step) {
  var o = document.getElementById("scanOverlay");
  if (o) {
    o.style.display = "flex";
    var t = document.getElementById("stepText");
    if (t) t.textContent = step;
  }
}
function hideOverlay() {
  var o = document.getElementById("scanOverlay");
  if (o) o.style.display = "none";
}

function runScan() {
  var btn = document.getElementById("scanBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Scanning…"; }
  showOverlay("Connecting ...");
  sendMsg({ action: "scan" });
  pollScan();
}

// poll for scan completion (used by runScan AND mid-scan popup reopen)
function pollScan() {
  var btn = document.getElementById("scanBtn");
  var polls = 0;
  var timer = setInterval(function () {
    polls++;
    chrome.storage.local.get("scanState", function (data) {
      var st = data.scanState;
      if (!st || st.state === "running") {
        if (st && st.step) showOverlay(st.step);
        if (polls > 80) {
          clearInterval(timer);
          hideOverlay();
          if (btn) { btn.disabled = false; btn.textContent = "Scan"; }
          showError("Scan timed out. Are you logged into twitch.tv?", []);
        }
        return;
      }
      clearInterval(timer);
      hideOverlay();
      if (btn) { btn.disabled = false; btn.textContent = "Scan"; }
      if (st.state === "error") { showError(st.message || "Scan failed", []); return; }
      if (st.state === "done" && st.result) {
        if (st.result.error && (!st.result.drops || st.result.drops.length === 0)) {
          showError(st.result.error, st.result.debug);
          return;
        }
        currentData = st.result;
        updateCounts();
        render();
        setDebug(st.result.debug);
      }
    });
  }, 1500);
}

function showError(msg, debug) {
  var html = "<div class='empty-state'><p style='color:#ff7b72;font-weight:bold;'>" + escapeHtml(msg) + "</p>";
  if (debug && debug.length) {
    var txt = debug.join("\n");
    window._dbgText = txt;
    html += "<div class='error-detail'>" + escapeHtml(txt) + "</div>";
    html += "<button class='copy-btn' id='copyDbg'>Copy debug info</button>";
  }
  html += "</div>";
  document.getElementById("content").innerHTML = html;
  var b = document.getElementById("copyDbg");
  if (b) b.addEventListener("click", function () {
    var ta = document.createElement("textarea");
    ta.value = window._dbgText;
    document.body.appendChild(ta); ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    b.textContent = "Copied!";
  });
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function updateCounts() {
  var drops = (currentData && currentData.drops) || [];
  document.getElementById("liveCount").textContent = drops.filter(function (d) { return !d.claimed && d.live; }).length;
  document.getElementById("unclaimedCount").textContent = drops.filter(function (d) { return !d.claimed; }).length;
  document.getElementById("claimedCount").textContent = drops.filter(function (d) { return d.claimed; }).length;
}

function thumbHtml(d) {
  if (d.image) {
    return "<img class='thumb' src='" + d.image + "' alt='' onerror=\"this.outerHTML='<div class=thumb-fallback>No art</div>'\">";
  }
  return "<div class='thumb-fallback'>No art</div>";
}

function liveStreamerCount(d) {
  if (!d.streamers) return 0;
  var n = 0;
  for (var i = 0; i < d.streamers.length; i++) if (d.streamers[i].live) n++;
  return n;
}

function emptyHtml(title, body) {
  return "<div class='empty-state'><strong>" + title + "</strong>" + body + "</div>";
}

function render() {
  var container = document.getElementById("content");
  container.classList.toggle("inventory", currentTab === "claimed");
  if (!currentData || !currentData.drops) {
    container.innerHTML = emptyHtml("Nothing loaded yet", "Hit Scan to pull claimed items, live streamers, and drop progress.");
    return;
  }
  var drops = currentData.drops;
  var list = [], emptyTitle = "", emptyBody = "";

  if (currentTab === "live") {
    list = drops.filter(function (d) { return !d.claimed && d.live; });
    emptyTitle = "Nobody live for unclaimed drops";
    emptyBody = "Check Open for progress, or wait for a tracked streamer.";
  } else if (currentTab === "unclaimed") {
    list = drops.filter(function (d) { return !d.claimed; });
    emptyTitle = "All caught up";
    emptyBody = "No unclaimed drops in this round.";
  } else {
    list = drops.filter(function (d) { return d.claimed; });
    emptyTitle = "No claimed items";
    emptyBody = "Scan while logged into Twitch to load inventory.";
  }

  list = list.filter(function (d) { return dropMatchesQuery(d, searchQuery); });
  if (searchQuery.trim() && list.length === 0) {
    emptyTitle = "No matches";
    emptyBody = "Nothing in this tab for “" + escapeHtml(searchQuery.trim()) + "”.";
  }

  if (list.length === 0) {
    container.innerHTML = emptyHtml(emptyTitle, emptyBody);
    return;
  }

  var html = "";
  for (var i = 0; i < list.length; i++) {
    html += currentTab === "claimed" ? renderTile(list[i]) : renderCard(list[i]);
  }
  container.innerHTML = html;
}

function renderTile(d) {
  return "<article class='tile'>" + thumbHtml(d) +
    "<div class='drop-name'>" + escapeHtml(d.name || d.displayName) + "</div></article>";
}

function fmtEta(min) {
  if (min == null || min !== min) { return ""; }
  if (min <= 0) { return "Ready"; }
  var total = Math.ceil(min * 60);
  var h = Math.floor(total / 3600);
  var m = Math.floor((total % 3600) / 60);
  if (h > 0) { return "~" + h + "h " + m + "m"; }
  return "~" + m + "m";
}

function renderCard(d) {
  var html = "<article class='drop-card'>" + thumbHtml(d) + "<div class='drop-body'>";
  html += "<div class='drop-name'>" + escapeHtml(d.displayName || d.name) + "</div>";
  html += "<div class='drop-meta'>";
  if (d.claimed) html += "<span class='tag tag-claimed'>Claimed</span>";
  if (!d.claimed && d.live) html += "<span class='tag tag-live'>Live now</span>";
  if (!d.claimed && !d.live && !d.isGeneral) html += "<span class='tag'>Offline</span>";
  if (d.isGeneral) html += "<span class='tag'>Any Rust stream</span>";
  if (d.hours) html += "<span class='tag'>" + escapeHtml(d.hours) + "</span>";
  if (d.wasReady && !d.claimed) html += "<span class='tag tag-ready'>Ready to claim</span>";
  var liveN = liveStreamerCount(d);
  if (d.streamers && d.streamers.length) {
    html += "<span class='tag'>" + liveN + "/" + d.streamers.length + " live</span>";
  }
  html += "</div>";
  if (d.pct !== null && d.pct !== undefined) {
    var full = d.pct >= 100;
    var showPct = _barSettings.showPct;
    var showTime = _barSettings.showTimeLeft && d.etaMin != null && d.pct < 100;
    var barClass = "pbar" + (full ? " full" : "");
    html += "<div class='pbar-wrap'><div class='" + barClass + "'><div style='width:" +
            Math.min(100, d.pct) + "%'></div></div>";
    if (showPct) html += "<span class='pbar-pct'>" + Math.min(100, d.pct) + "%</span>";
    if (showTime) html += "<span class='pbar-time'>" + fmtEta(d.etaMin) + "</span>";
    html += "</div>";
  }
  if (d.streamers && d.streamers.length) {
    html += "<div class='streamer-row'>";
    for (var j = 0; j < d.streamers.length; j++) {
      var s = d.streamers[j];
      var cls = s.live ? "live" : "offline";
      var label = (s.live ? "Live · " : "") + s.name;
      if (s.url) {
        html += "<a class='watch-link " + cls + "' href='" + s.url + "' target='_blank'>" + escapeHtml(label) + "</a>";
      } else {
        html += "<span class='watch-link " + cls + "'>" + escapeHtml(label) + "</span>";
      }
    }
    html += "</div>";
  } else if (!d.claimed && d.watchUrl && d.isGeneral) {
    html += "<div class='streamer-row'><a class='watch-link live' href='" + d.watchUrl + "' target='_blank'>Browse Rust streams</a></div>";
  }
  html += "</div></article>";
  return html;
}

// ---------- notification / alarm-sound settings panel ----------
var _localSounds = null;
function playSoundLocal(id) {
  if (_localSounds) { doPlayLocal(id); return; }
  sendMsg({ action: "getSounds" }, function (sounds) {
    if (sounds && sounds.length) { _localSounds = sounds; doPlayLocal(id); }
  });
}
function doPlayLocal(id) {
  try { new Audio(_localSounds[id] || _localSounds[0]).play().catch(function () {}); } catch (e) {}
}

// ---------- claim history ----------
function openHistory() {
  document.getElementById("historyOverlay").style.display = "flex";
  renderHistory();
}
function renderHistory() {
  chrome.storage.local.get("claimHistory", function (d) {
    var list = d.claimHistory || [];
    var el = document.getElementById("historyList");
    if (!list.length) { el.innerHTML = "<div class='empty-state'>No claims recorded yet.</div>"; return; }
    var html = "";
    for (var i = list.length - 1; i >= 0; i--) {
      var dt = new Date(list[i].at);
      html += "<div class='hist-row'><div><div class='hist-name'>" + escapeHtml(list[i].name) + "</div>" +
        "<div class='hist-time'>" + dt.toLocaleString() + "</div></div>" +
        "<span class='hist-src'>" + escapeHtml(list[i].source || "") + "</span></div>";
    }
    el.innerHTML = html;
  });
}
// ---------- bug diagnostics ----------
function collectBugs() {
  chrome.storage.local.get(["updateStatus", "beepStatus", "notifStatus", "tabLog", "scanState", "buildTag"], function (st) {
    var out = [];
    out.push("Rust Drops Companion diagnostics");
    out.push("build: " + (st.buildTag || "?"));
    if (st.updateStatus) out.push("updater: " + JSON.stringify(st.updateStatus));
    if (st.beepStatus) out.push("sound: " + JSON.stringify(st.beepStatus));
    if (st.notifStatus) out.push("notif: " + JSON.stringify(st.notifStatus));
    if (st.tabLog) out.push("tabLog: " + JSON.stringify(st.tabLog));
    if (st.scanState && st.scanState.state !== "idle") out.push("scanState: " + JSON.stringify(st.scanState));
    var ta = document.getElementById("bugText");
    ta.style.display = "block";
    ta.value = out.join("\n");
    ta.select();
    document.execCommand("copy");
    var btn = document.getElementById("bugBtn");
    btn.textContent = "Copied! Paste it to john503";
    setTimeout(function () { btn.textContent = "Report a bug (copy diagnostics)"; }, 3000);
  });
}

// ---------- round countdown in header ----------
function refreshStatusLine() { renderStatusLine(); }

function updateRoundCountdown() {
  var el = document.getElementById("roundCountdown");
  if (!el) return;
  if (!currentData || !currentData.campaignEndTs) { el.textContent = ""; return; }
  var ms = currentData.campaignEndTs - Date.now();
  if (ms <= 0) { el.textContent = "round ended"; el.style.color = "#ff7b72"; return; }
  var d = Math.floor(ms / 86400000);
  var h = Math.floor(ms % 86400000 / 3600000);
  var m = Math.floor(ms % 3600000 / 60000);
  el.textContent = "Ends in " + (d > 0 ? d + "d " : "") + h + "h " + m + "m";
  el.style.color = "";
}

function openSettings() {
  sendMsg({ action: "getNotifSettings" }, function (s) {
    s = s || {};
    setChecked("liveEnabled", s.liveEnabled !== false);
    setChecked("liveSound", s.liveSound !== false);
    setValue("liveSoundId", s.liveSoundId != null ? s.liveSoundId : 0);
    setChecked("readyEnabled", s.readyEnabled !== false);
    setChecked("readySound", s.readySound !== false);
    setValue("readySoundId", s.readySoundId != null ? s.readySoundId : 2);
    setChecked("autoClaim", !!s.autoClaim);
    setChecked("autoOpen", !!s.autoOpen);
    setChecked("autoWatch", !!s.autoWatch);
    setChecked("showPct", s.showPct !== false);
    setChecked("showTimeLeft", !!s.showTimeLeft);
    setValue("appearance", s.appearance || "dark");
    applyAppearance(s.appearance || "dark");
    _barSettings = { showPct: s.showPct !== false, showTimeLeft: !!s.showTimeLeft };
    render();
    updateSubEnabled();
    chrome.storage.local.get("extSettings", function (es) {
      setChecked("tabRecheck", !!(es.extSettings && es.extSettings.tabRecheck));
    });
    loadClaimStatus();
    loadAccounts();
    var o = document.getElementById("settingsOverlay");
    if (o) o.style.display = "flex";
    refreshStatusLine();
    if (window._stLineTimer) clearInterval(window._stLineTimer);
    window._stLineTimer = setInterval(refreshStatusLine, 4000);
  });
}

function setChecked(id, val) {
  var el = document.getElementById(id);
  if (el) el.checked = !!val;
}
function setValue(id, val) {
  var el = document.getElementById(id);
  if (el) el.value = String(val);
}

// sub-controls (sound select + test button) are only meaningful once the
// parent "notify" box is checked AND the "play sound" box is checked
function updateSubEnabled() {
  toggleSub("liveEnabled", "liveSoundWrap");
  toggleSub("readyEnabled", "readySoundWrap");
}
function toggleSub(enableId, wrapId) {
  var enabled = document.getElementById(enableId);
  var wrap = document.getElementById(wrapId);
  if (!enabled || !wrap) return;
  wrap.classList.toggle("disabled", !enabled.checked);
}

function saveSettings() {
  var settings = {
    liveEnabled: !!document.getElementById("liveEnabled").checked,
    liveSound: !!document.getElementById("liveSound").checked,
    liveSoundId: parseInt(document.getElementById("liveSoundId").value, 10) || 0,
    readyEnabled: !!document.getElementById("readyEnabled").checked,
    readySound: !!document.getElementById("readySound").checked,
    readySoundId: parseInt(document.getElementById("readySoundId").value, 10) || 0,
    autoClaim: !!document.getElementById("autoClaim").checked,
    autoOpen: !!document.getElementById("autoOpen").checked,
    autoWatch: !!document.getElementById("autoWatch").checked,
    showPct: !!document.getElementById("showPct").checked,
    showTimeLeft: !!document.getElementById("showTimeLeft").checked,
    appearance: (document.getElementById("appearance") || { value: _appearance }).value || "dark"
  };
  sendMsg({ action: "setNotifSettings", settings: settings });
  chrome.storage.local.set({ extSettings: { tabRecheck: !!document.getElementById("tabRecheck").checked } });
  _barSettings = { showPct: settings.showPct, showTimeLeft: settings.showTimeLeft };
  if (settings.appearance !== _appearance) { applyAppearance(settings.appearance); }
  render();
}

function wireSettingsControls() {
  var ids = ["liveEnabled", "liveSound", "liveSoundId", "readyEnabled", "readySound", "readySoundId", "tabRecheck", "autoClaim", "autoOpen", "autoWatch", "showPct", "showTimeLeft", "appearance"];
  for (var i = 0; i < ids.length; i++) {
    var el = document.getElementById(ids[i]);
    if (!el) continue;
    el.addEventListener("change", function () {
      updateSubEnabled();
      saveSettings();
    });
  }
  // one test button per event - respects the toggles (only tests what's enabled)
  on("liveTest", function () {
    var id = parseInt(document.getElementById("liveSoundId").value, 10) || 0;
    if (document.getElementById("liveSound").checked) {
      playSoundLocal(id);
      sendMsg({ action: "testSound", soundId: id });
    }
    if (document.getElementById("liveEnabled").checked) {
      sendMsg({ action: "testNotif", kind: "live", soundId: id, playSound: false });
    }
  });
  on("readyTest", function () {
    var id = parseInt(document.getElementById("readySoundId").value, 10) || 0;
    if (document.getElementById("readySound").checked) {
      playSoundLocal(id);
      sendMsg({ action: "testSound", soundId: id });
    }
    if (document.getElementById("readyEnabled").checked) {
      sendMsg({ action: "testNotif", kind: "ready", soundId: id, playSound: false });
    }
  });
  on("accountAddBtn", function () {
    var auth = (document.getElementById("accountToken") || {}).value || "";
    var label = (document.getElementById("accountLabel") || {}).value || "";
    if (!auth.trim()) { return; }
    var btn = document.getElementById("accountAddBtn");
    if (btn) btn.textContent = "Adding…";
    sendMsg({ action: "addAccount", auth: auth, label: label }, function (res) {
      if (btn) btn.textContent = "Add account";
      if (res && res.error) { alert(res.error); return; }
      loadAccounts();
    });
  });
}

// load persisted display options (bar toggles + theme) for immediate render
function loadDisplayOptions() {
  sendMsg({ action: "getNotifSettings" }, function (s) {
    if (!s) { return; }
    _barSettings = { showPct: s.showPct !== false, showTimeLeft: !!s.showTimeLeft };
    _appearance = s.appearance || "dark";
    applyAppearance(_appearance);
    render();
  });
}

function loadClaimStatus() {
  sendMsg({ action: "getClaimStatus" }, function (s) {
    _claimStatus = s;
    var el = document.getElementById("claimStatusText");
    if (!el) { return; }
    if (!s) { el.textContent = "No auto-claim attempts yet"; return; }
    var isOk = s.result && s.result.startsWith("ok");
    el.innerHTML = "Last: " + escapeHtml(s.name || "?") + " (" +
      "<span style='color:" + (isOk ? "var(--live)" : "var(--danger)") + "'>" + escapeHtml(s.result || "") + "</span>" +
      ") " + new Date(s.at || "").toLocaleTimeString();
  });
}

function loadAccounts() {
  sendMsg({ action: "getAccounts" }, function (res) {
    if (!res) { return; }
    _accounts = res.accounts || [];
    _activeAccount = res.active == null ? -1 : res.active;
    renderAccounts();
  });
}

function renderAccounts() {
  var el = document.getElementById("accountsList");
  if (!el) { return; }
  if (!_accounts.length) {
    el.innerHTML = "<div style='font-size:12px;color:var(--muted)'>No saved accounts. The browser login is always available.</div>";
    return;
  }
  var html = "";
  for (var i = 0; i < _accounts.length; i++) {
    var a = _accounts[i];
    var active = _activeAccount === i;
    html += "<div class='set-row' style='justify-content:space-between'>" +
      "<label style='display:flex;align-items:center;gap:8px;flex:1'><input type='radio' name='acct' " + (active ? "checked" : "") +
      " value='" + i + "'><span style='font-size:12px'>" + escapeHtml(a.label || a.login || "?") +
        " <span style='color:var(--muted)'>" + escapeHtml(a.login || "") + "</span></span></label>" +
      "<button class='ghost' style='padding:4px 8px;font:700 10px/1 sans-serif' data-idx='" + i + "' onclick='removeAccount(" + i + ")'>Remove</span></button></div>";
  }
  el.innerHTML = html;
  // wire radio change -> setActiveAccount
  var radios = el.querySelectorAll("input[name='acct']");
  for (var r = 0; r < radios.length; r++) {
    radios[r].addEventListener("change", function () {
      if (this.checked) {
        sendMsg({ action: "setActiveAccount", index: Number(this.value) });
        _activeAccount = Number(this.value);
      }
    });
  }
}

function removeAccount(i) {
  sendMsg({ action: "removeAccount", index: i }, function () { loadAccounts(); });
}

function claimNow() {
  var btn = document.getElementById("claimNowBtn");
  if (btn) btn.textContent = "Claiming…";
  sendMsg({ action: "autoClaim" }, function () {
    if (btn) btn.textContent = "Claim ready drops now";
    loadClaimStatus();
  });
}
