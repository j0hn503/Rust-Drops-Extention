// background.js v3.3
// Sources:
//  A) twitch.facepunch.com  - direct fetch: drop catalog, claimed badges (if logged in),
//                             per-drop streamers + who is LIVE (multiple streamers per drop)
//  B) twitch.tv/drops/inventory - content_inventory.js: authoritative claimed list (alt-text)
//  C) twitch.tv/drops/campaigns - content_campaigns.js: progress %, claimed, live channels

const FP_URL = "https://twitch.facepunch.com/";
const KICK_URL = "https://kick.facepunch.com/";
const INV_URL = "https://www.twitch.tv/drops/inventory";
const CAMP_URL = "https://www.twitch.tv/drops/campaigns";
const RUST_DIR = "https://www.twitch.tv/directory/category/rust";

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

let _keepalive = null;
function startKeepalive() { stopKeepalive(); _keepalive = setInterval(() => chrome.tabs.query({}, () => {}), 10000); }
function stopKeepalive() { if (_keepalive) { clearInterval(_keepalive); _keepalive = null; } }

function decodeHtml(s) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();
}
function norm(s) { return (s || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
const ABBREV = { sm: "small", lg: "large", med: "medium", xl: "large", xxl: "large",
  ar: "assault rifle", sar: "semi auto rifle", db: "double barrel",
  tac: "tactical", sg: "shotgun", bp: "backpack" };
function tokens(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/)
    .filter(t => t && ["rust", "isles", "the", "skin", "drop", "twitch"].indexOf(t) === -1)
    .map(t => ABBREV[t] || t);
}
// fuzzy token equality: exact, OR one is a prefix of the other (>=3 chars),
// handles "sm box" vs "small box", "wood door" vs "wooden door", "boonie" vs "boonie hat"
function tokEq(x, y) {
  if (x === y) return true;
  if (x.length >= 3 && y.length >= 3 && (x.startsWith(y) || y.startsWith(x))) return true;
  return false;
}
function nameMatches(a, b) {
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb || na.indexOf(nb) !== -1 || nb.indexOf(na) !== -1) return true;
  let ta = tokens(a), tb = tokens(b);
  if (!ta.length || !tb.length) return false;
  const short = ta.length <= tb.length ? ta : tb;
  const long = ta.length <= tb.length ? tb : ta;
  let hits = 0;
  for (const t of short) {
    if (long.some(u => tokEq(t, u))) hits++;
  }
  if (hits === short.length) return true; // all of shorter found ("boonie" in ["boonie","hat"])
  // generic cross-site rule: same head noun (last token) + >=50% overlap.
  // links "Rustoria Turret" (twitch) with "Auto Turret" (facepunch), any future rename
  if (ta[ta.length-1] === tb[tb.length-1] && hits / short.length >= 0.5 && hits / long.length >= 0.5) {
    // head-noun matches on GENERIC words (door/box/hat...) need stronger evidence,
    // otherwise "Garage Door" == "Wooden Door" (the current bug)
    const GENERIC = ["door","box","hat","pants","boots","gloves","jacket","mask","shirt","vest",
                     "helmet","bag","pack","sword","knife","rifle","gun","sign","rug","table",
                     "chair","lantern","torch","rock","chest","locker","furnace"];
    const need = GENERIC.indexOf(ta[ta.length-1]) !== -1 ? 0.6 : 0.5;
    if (hits / short.length >= need && hits / long.length >= need) return true;
  }
  return false;
}

// same streamer channel = same drop, even if the names are completely different

// pick the best fuzzy match: prefer drops with progress/in-progress, then first
function pickMatch(list, n) {
  const cands = list.filter(d => nameMatches(d.name, n));
  if (!cands.length) return null;
  return cands.find(d => d._inProgress || (d.pct !== null && d.pct !== undefined)) || cands[0];
}


// claimed items from OLD events (other games/campaigns sharing generic item names
// like "Furnace") must never mark a current-round drop - e.g. the false pair
// "Rust Charity '26 Furnace -> Furnace"
const OLD_EVENT_WORDS = ["charity", "rivals", "global", "warfare", "gta", "nutsack",
                         "burntpeanut", "winter", "highway", "patrol"];
function isOldEventClaim(name) {
  const n = " " + norm(name) + " ";
  for (const w of OLD_EVENT_WORDS) {
    if (n.indexOf(w) !== -1) return true;
  }
  return false;
}


// for in-progress matching: same-name variants exist (general vs streamer cards).
// the earnable campaign is the streamer one, so prefer candidates WITH streamers,
// then ones that already carry progress, then first.
function pickProgressMatch(list, n) {
  const cands = list.filter(d => nameMatches(d.name, n));
  if (!cands.length) return null;
  const withStreamers = cands.filter(d => d.streamers && d.streamers.length);
  const pool = withStreamers.length ? withStreamers : cands;
  return pool.find(d => d._inProgress || (d.pct !== null && d.pct !== undefined)) || pool[0];
}

function sameDrop(a, b) {
  // 1) If both have dropInstanceID, use it for exact matching
  if (a.dropInstanceID && b.dropInstanceID && a.dropInstanceID === b.dropInstanceID) return true;
  if (a.dropInstanceID && b.dropInstanceID && a.dropInstanceID !== b.dropInstanceID) return false;

  // 2) Campaign ID differentiation - different campaigns = different drops
  if (a.campaignId && b.campaignId && a.campaignId !== b.campaignId) return false;

  // 3) Image URL differentiation - different images = different drops
  if (a.image && b.image && a.image !== b.image) {
    // Only consider this a differentiator if both have valid URLs
    const aImg = a.image.startsWith('http');
    const bImg = b.image.startsWith('http');
    if (aImg && bImg) return false;
  }

  // 4) Streamer count differentiation - different streamer counts = different drops
  const aCount = (a.streamers || []).length;
  const bCount = (b.streamers || []).length;
  if (aCount > 0 && bCount > 0 && aCount !== bCount) return false;

  // 5) General vs streamer variants stay separate
  const aGen = !(a.streamers && a.streamers.length);
  const bGen = !(b.streamers && b.streamers.length);
  if (aGen !== bGen) return false;

  // 6) Name matching
  if (nameMatches(a.name, b.name)) return true;

  // 7) Streamer channel matching
  const la = (a.streamers || []).map(s => ((s.url || "").split("/").filter(Boolean).pop() || s.name || "").toLowerCase()).filter(Boolean);
  const lb = (b.streamers || []).map(s => ((s.url || "").split("/").filter(Boolean).pop() || s.name || "").toLowerCase()).filter(Boolean);
  if (!la.length || !lb.length) return false;
  if (a.isGeneral && b.isGeneral) return false; // general drops have no owned channel
  return la.some(x => lb.indexOf(x) !== -1);
}

// ---------- A) Facepunch ----------
async function fetchFacepunch() {
  const resp = await fetch(FP_URL, { credentials: "include" });
  if (!resp.ok) throw new Error("Facepunch HTTP " + resp.status);
  return resp.text();
}

async function fetchKick() {
  const resp = await fetch(KICK_URL, { credentials: "include" });
  if (!resp.ok) throw new Error("Kick HTTP " + resp.status);
  return resp.text();
}

function parseFacepunch(html) {
  const result = { campaign: null, campaignId: null, campaignLive: false, endText: null, loggedIn: false, drops: [], campaignEndTs: null };

  const titleM = html.match(/<h2 class="event-title">([\s\S]*?)<\/h2>/);
  if (titleM) result.campaign = decodeHtml(titleM[1].replace(/<[^>]+>/g, ""));
  result.campaignLive = /status-badge is-live/.test(html);
  const cdM = html.match(/setupCountdown\([^,]+,\s*(\d{13}),\s*(\d{13})\)/);
  result.campaignEndTs = cdM ? Number(cdM[2]) : null;
  result.loggedIn = /class="avatar"/.test(html);
  const dateM = html.match(/class="date"[^>]*>([^<]+)<\/span>[\s\S]*?date-sep[\s\S]*?class="date"[^>]*>([^<]+)<\/span>/);
  if (dateM) result.endText = decodeHtml(dateM[2]);

  // Extract campaign ID from page if available (used for drop differentiation)
  const campaignIdM = html.match(/data-campaign-id="([^"]+)"/);
  if (campaignIdM) result.campaignId = campaignIdM[1];

  // match only OUTER drop cards: <div class="drop-box..."> or <a ... class="drop-box...">
  // (NOT the inner drop-box-header/body/footer divs - those chop cards apart)
  const parts = html.split(/<(?:div|a)\b[^>]*?class="drop-box(?=[" ])/);
  for (let i = 1; i < parts.length; i++) {
    const block = parts[i];
    const head = block.slice(0, block.indexOf('>') + 1);
    const typeM = block.match(/<span class="drop-type">([\s\S]*?)<\/span>/);
    if (!typeM) continue;
    const name = decodeHtml(typeM[1]);

    // streamers with per-streamer LIVE status.
    // each streamer anchor looks like:
    // <a href="https://www.twitch.tv/NAME" class="streamer-info" ...> ... <span class="streamer-name">NAME</span> [online-status]
    const streamers = [];
    const sRe = /<a href="(https:\/\/www\.twitch\.tv\/[^"]+)"[^>]*class="streamer-info"[\s\S]*?<span class="streamer-name">([^<]+)<\/span>([\s\S]{0,400}?)(?=<a href="https:\/\/www\.twitch\.tv\/[^"]+"[^>]*class="streamer-info"|<a href="https:\/\/www\.twitch\.tv\/[^"]+"[^>]*class="drop-box-body"|$)/g;
    let sm;
    while ((sm = sRe.exec(block)) !== null) {
      const after = sm[3];
      // online-status div appears (empty or with icon) near live streamers; also drop-box is-live covers it
      streamers.push({ name: decodeHtml(sm[2]), url: sm[1], live: /online-status/.test(after) });
    }
    // fallback: plain streamer-name spans
    if (streamers.length === 0) {
      const nRe = /class="streamer-name">([^<]+)</g;
      while ((sm = nRe.exec(block)) !== null) streamers.push({ name: decodeHtml(sm[1]), url: null, live: /is-live/.test(head) });
    }

    const isLive = /is-live/.test(head) || streamers.some(s => s.live);

    let watchUrl = null;
    const bM = block.match(/<a href="(https:\/\/www\.twitch\.tv\/[^"]+)"[^>]*class="drop-box-body"/);
    if (bM) watchUrl = bM[1];

    const timeM = block.match(/class="drop-time"[\s\S]*?<span>([^<]+)<\/span>/);
    const imgM = block.match(/<img src="(https:\/\/files\.facepunch\.com\/[^"]+)"/);
    const badgeM = block.match(/<[^>]*drop-claimed-badge[^>]*>/);
    const claimed = badgeM ? !/hidden/.test(badgeM[0]) : false;

    result.drops.push({
      name: name, campaign: result.campaign || "Rust Drops", campaignId: result.campaignId,
      image: imgM ? imgM[1] : null,
      streamers: streamers, watchUrl: watchUrl || RUST_DIR,
      live: isLive, isGeneral: streamers.length === 0,
      hours: timeM ? decodeHtml(timeM[1]) : null,
      claimed: claimed, pct: null, progress: null, extra: false
    });
  }
  // merge only true duplicates: same name AND same variant (general vs streamer).
  // facepunch can list the same item twice with different earn paths
  // (e.g. general "Large Wood Box" + ironmouse "Large Wood Box") - those stay separate.
  const map = {}, drops = [];
  for (const d of result.drops) {
    const k = d.name.toLowerCase() + (d.streamers.length ? "|s" : "|g");
    if (map[k]) {
      const ex = map[k];
      if (d.streamers.length) { ex.streamers = ex.streamers.concat(d.streamers); ex.isGeneral = false; }
      ex.live = ex.live || d.live;
      ex.claimed = ex.claimed || d.claimed;
    } else { map[k] = d; drops.push(d); }
  }
  result.drops = drops;
  return result;
}

// ---------- B/C) tab scraping with content scripts ----------
async function waitTabLoad(tabId, timeoutMs) {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("load timeout")), timeoutMs || 60000);
    const listener = (tid, info) => {
      if (tid === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timer); resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function extractWithRetry(tabId) {
  await sleep(3000);
  let lastErr = null;
  for (let i = 0; i < 6; i++) {
    try {
      const res = await chrome.tabs.sendMessage(tabId, { action: "extract" });
      if (res) return res;
      lastErr = new Error("empty response");
    } catch (e) { lastErr = e; }
    await sleep(1500);
  }
  throw lastErr || new Error("no response");
}

// carry forward transient state (ETA history, claim-throttle, auto-open flags)
// so a fresh scan doesn't reset watch-rate ETA and won't re-claim or re-open.
async function carryPrevState(result) {
  try {
    const { lastScan } = await chrome.storage.local.get("lastScan");
    if (!lastScan || !lastScan.drops || !result.drops) { return; }
    for (const d of result.drops) {
      const p = lastScan.drops.find(x => sameDrop(x, d) || (x.dropInstanceID && x.dropInstanceID === d.dropInstanceID) || nameMatches(x.name, d.name));
      if (!p) { continue; }
      if (d._prevPct == null && p._prevPct != null) { d._prevPct = p._prevPct; }
      if (d._prevTs == null && p._prevTs != null) { d._prevTs = p._prevTs; }
      if (!d._lastClaimTry && p._lastClaimTry) { d._lastClaimTry = p._lastClaimTry; }
      if (!d._claimedFallback && p._claimedFallback) { d._claimedFallback = p._claimedFallback; }
      if (d.wasReady == null && p.wasReady != null) { d.wasReady = p.wasReady; }
      if (p.autoOpened) { d.autoOpened = true; }
      if (p.autoWatched) { d.autoWatched = true; }
    }
  } catch (e) {}
}

// ---------- main scan ----------
let scanning = false;
let lastInvClaimed = [];

function setStep(step) {
  return chrome.storage.local.set({ scanState: { state: "running", step: step, startedAt: Date.now() } });
}

// verify via Twitch GQL: is this streamer LIVE and playing Rust right now?
async function verifyLiveStreamers(streamerList) {
  const logins = [];
  const seen = {};
  for (const s of streamerList) {
    const login = ((s.url || "").split("/").filter(Boolean).pop() || s.name || "").toLowerCase();
    if (login && !seen[login]) { seen[login] = 1; logins.push(login); }
  }
  if (logins.length === 0) return null;
  const fields = logins.map((l, i) => 'u' + i + ': user(login: "' + l + '") { login stream { type game { name } } }').join("\n");
  const resp = await fetch("https://gql.twitch.tv/gql", {
    method: "POST",
    headers: { "Client-ID": "kimne78kx3ncx6brgo4mv6wki5h1ko", "Content-Type": "application/json" },
    body: JSON.stringify({ query: "query {\n" + fields + "\n}" })
  });
  const data = await resp.json();
  if (!data || !data.data) return null;
  const out = {};
  logins.forEach((l, i) => {
    const u = data.data["u" + i];
    out[l] = !!(u && u.stream && u.stream.type === "live" && u.stream.game && /rust/i.test(u.stream.game.name));
  });
  return out;
}

async function doScan() {
  const result = { drops: [], campaign: null, campaignId: null, campaignLive: false, endText: null,
                   facepunchLoggedIn: false, source: "twitch", debug: [], lastUpdated: new Date().toISOString() };

  // ONE tab: facepunch -> inventory -> campaigns -> rust directory, then auto-close
  await setStep("Opening twitch.facepunch.com ...");
  let tab = null;
  try { tab = await chrome.tabs.create({ url: FP_URL, active: false }); tabLog("open", FP_URL); markOurTab(tab.id); } catch (e) {}
  try {
    const fpHtml = await fetchFacepunch();
    await sleep(3500); // let you see the facepunch tab before switching
    const fp = parseFacepunch(fpHtml);
    result.campaign = fp.campaign;
    result.campaignId = fp.campaignId;
    result.campaignLive = fp.campaignLive;
    result.endText = fp.endText;
    result.facepunchLoggedIn = fp.loggedIn;
    result.campaignEndTs = fp.campaignEndTs;
    result.drops = fp.drops;
    result.debug.push("facepunch: " + fp.drops.length + " drops, loggedIn=" + fp.loggedIn);
  } catch (e) { result.debug.push("facepunch failed: " + e.message); }

  // Fallback to Kick if Twitch has no drops
  if (result.drops.length === 0) {
    await setStep("No Twitch drops, checking kick.facepunch.com ...");
    try {
      const kickHtml = await fetchKick();
      await sleep(2000);
      const kick = parseFacepunch(kickHtml); // Use same parser, structure is similar
      if (kick.drops && kick.drops.length > 0) {
        result.campaign = kick.campaign;
        result.campaignId = kick.campaignId;
        result.campaignLive = kick.campaignLive;
        result.endText = kick.endText;
        result.facepunchLoggedIn = kick.loggedIn;
        result.campaignEndTs = kick.campaignEndTs;
        result.drops = kick.drops;
        result.source = "kick";
        result.debug.push("kick: " + kick.drops.length + " drops, loggedIn=" + kick.loggedIn);
      } else {
        result.debug.push("kick: no drops found");
      }
    } catch (e) { result.debug.push("kick failed: " + e.message); }
  }

  const byName = (n) => pickMatch(result.drops, n);
  const byNameFor = (n, hasStreamers) => {
    const cands = result.drops.filter(d => nameMatches(d.name, n));
    if (!cands.length) return null;
    if (hasStreamers) return cands.find(d => d.streamers && d.streamers.length) || cands[0];
    return cands.find(d => !d.streamers || !d.streamers.length) || cands[0];
  };

  // B) inventory claimed
  let invClaimedCount = 0;
  try {
    await setStep("Reading your Twitch inventory ...");
    await chrome.tabs.update(tab.id, { url: INV_URL, active: false }); tabLog("nav", INV_URL);
    await waitTabLoad(tab.id);
    const inv = await extractWithRetry(tab.id);
    const claimed = inv.claimed || [];
    invClaimedCount = claimed.length;
    let matched = 0;
    for (const c of claimed) {
      if (isOldEventClaim(c.name)) continue;
      // same-name variants exist (general vs streamer "Large Wood Box"):
      // one claimed inventory name must mark EVERY matching card, otherwise
      // the second copy stays "not claimed" forever
      const cands = result.drops.filter(d => nameMatches(d.name, c.name));
      for (const d of cands) {
        d.claimed = true; matched++;
        if (norm(c.name) !== norm(d.name)) result.debug.push("CLAIM PAIR: " + c.name + " -> " + d.name);
      }
    }
    lastInvClaimed = claimed;
    if (inv.inProgress && inv.inProgress.length) {
      result.debug.push("in-progress: " + inv.inProgress.map(p => p.name + " " + p.percent + "%").join(", "));
    }
    result.debug.push("inventory: " + claimed.length + " claimed total, " + matched + " matched");
    result.debug.push("claimed names: " + claimed.map(c => c.name).join(", "));
    // in-progress items from inventory
    let prog = 0;
    const progNames = [];
    for (const p of (inv.inProgress || [])) {
      const d = (result.drops.filter(x => nameMatches(x.name, p.name)).length > 1)
        ? pickProgressMatch(result.drops, p.name)
        : byName(p.name);
       if (d) { d.pct = p.percent; d.progress = p.percent + "%"; prog++; progNames.push(norm(d.name)); }
     }
     await carryPrevState(result);
     await trackReady(result, progNames);
     if (prog) result.debug.push("inventory progress applied to " + prog + " drops");
   } catch (e) { result.debug.push("inventory failed: " + e.message + " (log into twitch.tv)"); }

  // C) campaigns progress + live channels
  try {
    await setStep("Opening campaigns and clicking Rust ...");
    await chrome.tabs.update(tab.id, { url: CAMP_URL, active: false }); tabLog("nav", CAMP_URL);
    await waitTabLoad(tab.id);
    const camp = await extractWithRetry(tab.id);
    const cdrops = camp.drops || [];
    let matched = 0;
    for (const cd of cdrops) {
      const d = byNameFor(cd.name, (cd.streamers || []).length > 0);
      if (d) {
        matched++;
        // only fill in a missing image - never overwrite the card's own
        // facepunch picture, or same-name variants (general vs streamer
        // "Large Wood Box": box2.jpg vs box1.jpg) end up identical
        if (cd.image && !d.image) d.image = cd.image;
        if (cd.percent !== null && cd.percent !== undefined && d.pct === null) {
          d.pct = cd.percent; d.progress = cd.percent + "%";
        }
        // merge streamer urls (campaigns page has exact links)
        if (cd.streamers && cd.streamers.length) {
          for (const cs of cd.streamers) {
            const existing = (d.streamers || []).find(s => s.name.toLowerCase() === cs.name.toLowerCase());
            if (existing) existing.url = cs.url;
            else d.streamers.push({ name: cs.name, url: cs.url, live: false });
          }
        }
      }
      // non-current-campaign drops ignored: facepunch is the single catalog source
    }
    result.debug.push("campaigns: " + cdrops.length + " rust drops, " + matched + " matched to facepunch");
  } catch (e) { result.debug.push("campaigns failed: " + e.message); }

  // (old "second pass" removed - it used an unfiltered claimed list and
  //  re-introduced old-event false matches like "Rust Charity '26 Furnace".
  //  The 20s updater applies claimed status with proper filtering + audit.)

  // final safety: merge any two entries that refer to the same item
  for (let i = 0; i < result.drops.length; i++) {
    for (let j = result.drops.length - 1; j > i; j--) {
      if (sameDrop(result.drops[i], result.drops[j])) {
        const a = result.drops[i], b = result.drops[j];
        a.claimed = a.claimed || b.claimed;
        a.live = a.live || b.live;
        if (!a.image && b.image) a.image = b.image;
        if (b.streamers && b.streamers.length) {
          for (const s of b.streamers) {
            if (!(a.streamers || []).some(x => x.name.toLowerCase() === s.name.toLowerCase()))
              (a.streamers = a.streamers || []).push(s);
          }
          a.isGeneral = false;
        }
        if (a.pct === null && b.pct !== null) { a.pct = b.pct; a.progress = b.progress; }
        result.drops.splice(j, 1);
      }
    }
  }

  // D) verify each streamer via Twitch API: live AND playing Rust (sidebar-safe)
  try {
    await setStep("Checking who is live on Rust ...");
    const allStreamers = [];
    for (const d of result.drops) if (d.streamers) allStreamers.push(...d.streamers);
    const liveMap = await verifyLiveStreamers(allStreamers);
    if (liveMap) {
      let on = 0, off = 0;
      for (const d of result.drops) {
        if (!d.streamers) continue;
        d.live = false;
        for (const s of d.streamers) {
          const login = ((s.url || "").split("/").filter(Boolean).pop() || s.name || "").toLowerCase();
          if (login in liveMap) {
            s.live = liveMap[login];
            if (s.live) d.live = true;
            if (s.live) on++; else off++;
          }
        }
      }
      result.debug.push("api verified: " + on + " online on rust, " + off + " offline/other game");
    } else {
      result.debug.push("api verify unavailable, using facepunch live status");
    }
  } catch (e) { result.debug.push("live verify failed: " + e.message); }

  // baseline for the monitor: currently-live drops are not "new"
  for (const d of result.drops) d.wasLive = !!d.live;

  result.debug.push("claimed tab: " + result.drops.filter(d => d.claimed).map(d => d.name).join(", "));
  result.debug.push("not-claimed: " + result.drops.filter(d => !d.claimed).map(d => d.name).join(", "));
  if (tab) { try { await chrome.tabs.remove(tab.id); tabLog("close", "scan-tab"); } catch (e) {} }
  // same-name pairs: share the best (twitch reward) image so both cards look consistent
  const byNameImg = {};
  for (const d of result.drops) {
    const k = d.name.toLowerCase();
    if (d.image && d.image.indexOf("twitch-quests-assets") !== -1) byNameImg[k] = d.image;
  }
  for (const d of result.drops) {
    const best = byNameImg[d.name.toLowerCase()];
    if (best && d.image !== best) d.image = best;
  }

  // differentiate same-name items: "Large Wood Box" (general) vs "Large Wood Box (ironmouse)"
  const nameCount = {};
  for (const d of result.drops) {
    const k = d.name.toLowerCase();
    nameCount[k] = (nameCount[k] || 0) + 1;
  }
  for (const d of result.drops) {
    if (nameCount[d.name.toLowerCase()] > 1 && d.streamers && d.streamers.length) {
      d.displayName = d.name + " (" + d.streamers[0].name + ")";
    }
  }

  chrome.storage.local.set({ lastScan: result });
  updateBadge();
  return result;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "scan") {
    if (!scanning) {
      scanning = true;
      setStep("Starting...");
      startKeepalive();
      doScan().then(result => {
        return chrome.storage.local.set({ scanState: { state: "done", finishedAt: Date.now(), result: result } });
      }).catch(e => {
        return chrome.storage.local.set({ scanState: { state: "error", finishedAt: Date.now(), message: e.message } });
      }).finally(() => { scanning = false; stopKeepalive(); });
    }
    sendResponse({ ok: true });
    return true;
  }
  if (request.action === "forceUpdate") {
    startKeepalive();
    (async () => {
      try { await updateClaimedAndProgress(); } catch (e) {}
      try { await monitorTick(); } catch (e) {}
      stopKeepalive();
    })();
    sendResponse({ ok: true });
    return true;
  }
  if (request.action === "getScanState") {
    chrome.storage.local.get("scanState", (data) => sendResponse(data.scanState || { state: "idle" }));
    return true;
  }
  if (request.action === "openAllLive") {
    chrome.storage.local.get("lastScan", (data) => {
      const opened = [];
      if (data.lastScan && data.lastScan.drops) {
        for (const d of data.lastScan.drops) {
          if (d.claimed || !d.live) continue;
          const urls = [];
          if (d.streamers && d.streamers.length) {
            for (const s of d.streamers) {
              const u = (s.live && s.url) ? s.url : (s.url || null);
              if (u) urls.push(u);
            }
          }
          if (urls.length === 0 && d.watchUrl) urls.push(d.watchUrl);
          for (const u of urls) if (opened.indexOf(u) === -1) { opened.push(u); chrome.tabs.create({ url: u, active: false }); }
        }
      }
      if (opened.length === 0) chrome.tabs.create({ url: RUST_DIR, active: true });
    });
    sendResponse({ ok: true });
    return true;
  }
  if (request.action === "autoClaim") {
    startKeepalive();
    autoClaimFlow().then(res => {
      stopKeepalive();
      const n = res && res.clicked || 0;
      chrome.storage.local.set({ claimStatus: { name: "manual", instanceId: false, at: new Date().toISOString(), result: n > 0 ? ("ok (claimed " + n + " manually)") : "manual: nothing ready to claim" } });
      sendResponse(res);
    })
                   .catch(e => { stopKeepalive(); sendResponse({ error: e.message }); });
    return true;
  }
  if (request.action === "getNotifSettings") {
    getNotifSettings().then(s => sendResponse(s));
    return true;
  }
  if (request.action === "setNotifSettings") {
    chrome.storage.local.set({ notifSettings: request.settings || {} }, () => sendResponse({ ok: true }));
    return true;
  }
    if (request.action === "testSound") {
      beep(request.soundId);
      sendResponse({ ok: true });
      return true;
    }
    if (request.action === "getAccounts") {
      (async () => {
        const { twitchAccounts, activeTwitchAccount } = await chrome.storage.local.get(["twitchAccounts", "activeTwitchAccount"]);
        sendResponse({ accounts: Array.isArray(twitchAccounts) ? twitchAccounts : [], active: activeTwitchAccount == null ? -1 : activeTwitchAccount });
      })();
      return true;
    }
    if (request.action === "addAccount") {
      (async () => {
        const auth = (request.auth || "").trim();
        const label = (request.label || "").trim();
        if (!auth) { sendResponse({ error: "missing token" }); return; }
        const login = await gqlLogin(auth, (request.device) || null);
        if (!login) { sendResponse({ error: "invalid token (check auth-token)" }); return; }
        const { twitchAccounts } = await chrome.storage.local.get(["twitchAccounts"]);
        const accounts = Array.isArray(twitchAccounts) ? twitchAccounts.slice() : [];
        const existing = accounts.findIndex(a => a.auth === auth);
        if (existing >= 0) { accounts[existing] = { label: label || login, auth: auth, device: accounts[existing].device || randomDevice(), login: login }; }
        else { accounts.push({ label: label || login, auth: auth, device: randomDevice(), login: login }); }
        await chrome.storage.local.set({ twitchAccounts: accounts, activeTwitchAccount: existing >= 0 ? existing : accounts.length - 1 });
        sendResponse({ ok: true, login: login, accounts: accounts });
      })();
      return true;
    }
    if (request.action === "setActiveAccount") {
      (async () => {
        await chrome.storage.local.set({ activeTwitchAccount: request.index });
        sendResponse({ ok: true });
        // refresh inventory promptly with the newly selected account
        try { await updateClaimedAndProgress(false); } catch (e) {}
      })();
      return true;
    }
    if (request.action === "removeAccount") {
      (async () => {
        const { twitchAccounts, activeTwitchAccount } = await chrome.storage.local.get(["twitchAccounts", "activeTwitchAccount"]);
        let accounts = Array.isArray(twitchAccounts) ? twitchAccounts : [];
        const idx = request.index;
        if (idx >= 0 && idx < accounts.length) { accounts.splice(idx, 1); }
        let active = activeTwitchAccount == null ? -1 : activeTwitchAccount;
        if (accounts.length === 0) active = -1; else if (active >= accounts.length) active = accounts.length - 1;
        await chrome.storage.local.set({ twitchAccounts: accounts, activeTwitchAccount: active });
        sendResponse({ ok: true, accounts: accounts, active: active });
      })();
      return true;
    }
    if (request.action === "getClaimStatus") {
      (async () => {
        const { claimStatus } = await chrome.storage.local.get("claimStatus");
        sendResponse(claimStatus || null);
      })();
      return true;
    }
  if (request.action === "getSounds") {
    (async () => {
      try {
        const resp = await fetch(chrome.runtime.getURL("beep.js"));
        const text = await resp.text();
        const m = text.match(/const SOUNDS = \[([\s\S]*?)\];/);
        if (!m) { sendResponse([]); return; }
        const uris = m[1].match(/"data:audio\/wav;base64,[^"]+"/g) || [];
        sendResponse(uris.map(u => u.replace(/"/g, "")));
      } catch (e) { sendResponse([]); }
    })();
    return true;
  }
  if (request.action === "testNotif") {
    // fire a real notification so the user can see exactly what will pop up
    const kind = request.kind === "ready" ? "ready" : "live";
    chrome.notifications.create("test-" + kind + "-" + Date.now(), {
      type: "basic",
      iconUrl: "icon128.png",
      title: kind === "ready" ? "RUST DROP READY: Example Drop" : "RUST DROP LIVE: Example Drop",
      message: kind === "ready"
        ? "100% watched - click to open your Drops Inventory and claim it"
        : "Unclaimed drop is online now - click to watch (ExampleStreamer)",
      priority: 2
    }, (notifId) => {
      chrome.storage.local.set({ notifStatus: {
        ok: !chrome.runtime.lastError,
        err: chrome.runtime.lastError ? String(chrome.runtime.lastError.message) : null,
        id: notifId || null,
        at: new Date().toISOString()
      } });
    });
    if (request.playSound !== false) beep(request.soundId);
    sendResponse({ ok: true });
    return true;
  }
});

async function autoClaimFlow() {
  const tab = await chrome.tabs.create({ url: INV_URL, active: true }); markOurTab(tab.id);
  tabLog("open", "autoclaim");
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("load timeout")), 60000);
      const listener = (tabId, info) => {
        if (tabId === tab.id && info.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener);
          clearTimeout(timer); resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });
    await sleep(3000);
    let lastErr = null;
    for (let i = 0; i < 5; i++) {
      try {
        const res = await chrome.tabs.sendMessage(tab.id, { action: "claimAll" });
        if (res) return res;
      } catch (e) { lastErr = e; }
      await sleep(1500);
    }
    throw lastErr || new Error("no response");
  } finally {
    setTimeout(() => { chrome.tabs.remove(tab.id).then(() => tabLog("close", "autoclaim")).catch(() => {}); }, 8000);
  }
}

// ---------- notification + alarm-sound settings ----------
// Sound IDs map 1:1 to the SOUNDS array in beep.html:
// 0 Classic Beep, 1 Double Beep, 2 Chime, 3 Siren, 4 Alert,
// 5 Soft Chime, 6 Warm Bell, 7 Double Pulse
const DEFAULT_NOTIF_SETTINGS = {
  liveEnabled: true,
  liveSound: true,
  liveSoundId: 0,
  readyEnabled: true,
  readySound: true,
  readySoundId: 2,
  autoClaim: false,    // claim drops via API the moment they hit 100%
  autoOpen: false,     // open the streamer in a tab when a drop goes live
  autoWatch: false,    // BETA: open the live stream muted+pinned in background when a drop goes live
  showPct: true,       // show "%" next to the progress bar
  showTimeLeft: false, // show estimated time left to complete the drop
  appearance: "dark",  // "dark" | "light" popup theme
};

async function getNotifSettings() {
  const { notifSettings } = await chrome.storage.local.get("notifSettings");
  return Object.assign({}, DEFAULT_NOTIF_SETTINGS, notifSettings || {});
}


// ---------- serialized state access: prevents read-modify-write races ----------
// (monitorTick and the updater both read->modify->write lastScan; without this
//  the one that saves last silently overwrites the other's changes)
let _stateQueue = Promise.resolve();
function withState(fn) {
  const run = _stateQueue.then(fn).catch((e) => {});
  _stateQueue = run;
  return run;
}

// ---------- background monitor ----------
let _beepReady = null;
async function beep(soundId) {
  const sid = (typeof soundId === "number" ? soundId : 0);
  const ping = () => new Promise((resolve) => {
    let done = false;
    try {
      chrome.runtime.sendMessage({ action: "beepPing" }, (r) => {
        if (done) return; done = true;
        resolve(!chrome.runtime.lastError && !!(r && r.pong));
      });
    } catch (e) { done = true; resolve(false); return; }
    setTimeout(() => { if (!done) { done = true; resolve(false); } }, 2500);
  });
  try {
    if (!_beepReady) {
      _beepReady = (async () => {
        let has = false;
        try { has = await chrome.offscreen.hasDocument(); } catch (e) {}
        if (has && await ping()) return { ok: true };
        // create (or replace a zombie) and wait for it to answer
        try { await chrome.offscreen.closeDocument(); } catch (e) {}
        await sleep(500);
        try {
          await chrome.offscreen.createDocument({
            url: chrome.runtime.getURL("beep.html"),
            reasons: ["AUDIO_PLAYBACK"],
            justification: "alert sound for Rust drop notifications"
          });
        } catch (e) {
          return { ok: false, err: "createDocument: " + String(e && e.message || e) };
        }
        for (let i = 0; i < 12; i++) {
          await sleep(600);
          if (await ping()) return { ok: true };
        }
        return { ok: false, err: "offscreen page not responding" };
      })();
    }
    const ready = await _beepReady;
    if (!ready.ok) {
      chrome.storage.local.set({ beepStatus: { ok: false, err: ready.err, at: new Date().toISOString() } });
      _beepReady = null; // never cache a failure
      // scheduled retries - offscreen creation can be slow right when the
      // worker wakes for a notification; each retry re-sends the sound on success
      if (!beep._retrying) {
        beep._retrying = true;
        setTimeout(() => { beep._retrying = false; beep(sid); }, 15000);
        setTimeout(() => { beep._retrying = false; beep(sid); }, 40000);
      }
      return;
    }
    chrome.runtime.sendMessage({ action: "playBeep", soundId: sid }, (r) => {
      if (chrome.runtime.lastError || !r || r.played === false) {
        // retry once; if the page died, next beep rebuilds it
        setTimeout(() => chrome.runtime.sendMessage({ action: "playBeep", soundId: sid }, (r2) => {
          if (!chrome.runtime.lastError && r2 && r2.played) {
            chrome.storage.local.set({ beepStatus: { ok: true, at: new Date().toISOString() } });
          }
        }), 800);
      } else {
        chrome.storage.local.set({ beepStatus: { ok: true, at: new Date().toISOString() } });
      }
    });
  } catch (e) {
    _beepReady = null;
  }
}

// the offscreen page announces itself; treat as liveness refresh
chrome.runtime.onMessage.addListener((req) => {
  if (req && req.action === "offscreenAlive") {
    chrome.storage.local.set({ beepStatus: { ok: true, alive: true, at: new Date().toISOString() } });
  }
});


// ---- external tab-close detector ----
const _ourTabs = {};
function markOurTab(id) { if (id != null) _ourTabs[id] = true; }
chrome.tabs.onRemoved.addListener((tabId, info) => {
  if (_ourTabs[tabId]) { delete _ourTabs[tabId]; return; } // our own close, already logged
  try { chrome.tabs.get(tabId, () => { void chrome.runtime.lastError;
    // tab is gone; we can't read its URL post-removal, so log any non-ours removal
    // while inventory-ish pages are in use. Best-effort: record time + windowId.
    tabLog("EXT_CLOSE", "tab " + tabId + " win " + (info.windowId || "?"));
  }); } catch (e) {}
});

// ---- tab activity log ----
function tabLog(action, url) {
  try {
    chrome.storage.local.get("tabLog", (d) => {
      const log = (d.tabLog || []).slice(-7);
      log.push({ at: new Date().toISOString().slice(11, 19), action: action, url: (url || "").slice(0, 60) });
      chrome.storage.local.set({ tabLog: log });
    });
  } catch (e) {}
}

// ---- claim history ----
async function addClaimHistory(name, source) {
  try {
    const { claimHistory } = await chrome.storage.local.get("claimHistory");
    const list = claimHistory || [];
    list.push({ name: name, at: new Date().toISOString(), source: source || "auto" });
    while (list.length > 300) list.shift();
    await chrome.storage.local.set({ claimHistory: list });
  } catch (e) {}
}

// mark claimed + record history (only on false -> true transition)
async function markClaimed(d, source) {
  if (d.claimed) return;
  d.claimed = true;
  d.pct = 100; d.progress = "100%";
  await addClaimHistory(d.name, source);
  // a recorded FAIL for this drop is stale now - the claim did succeed
  try {
    const { claimStatus } = await chrome.storage.local.get("claimStatus");
    if (claimStatus && claimStatus.name && nameMatches(claimStatus.name, d.name) && !/^ok/.test(String(claimStatus.result || ""))) {
      chrome.storage.local.set({ claimStatus: Object.assign({}, claimStatus, { at: new Date().toISOString(), result: "ok (" + (source || "claim") + ")" }) });
    }
  } catch (e) {}
}


// ---------- claim a drop via Twitch persisted mutation ----------
// Twitch gates claimDropRewards behind a Client-Integrity token ("failed
// integrity check" otherwise). Acquire one from the /integrity endpoint and
// retry the claim with the token attached; cache until near expiry.
let _integrity = null; // { token, until }

async function getIntegrityToken(ck) {
  if (_integrity && _integrity.until > Date.now() + 60000) return _integrity.token;
  try {
    // same endpoint the Twitch web client uses; the token is bound to the device id
    const resp = await fetch("https://gql.twitch.tv/integrity", {
      method: "POST", credentials: "include",
      headers: {
        "Authorization": "OAuth " + ck.auth,
        "Client-ID": "kimne78kx3ncx6brgo4mv6wki5h1ko",
        "X-Device-Id": ck.device,
        "Content-Type": "text/plain;charset=UTF-8"
      }
    });
    const text = await resp.text();
    const data = text ? JSON.parse(text) : {};
    if (data && data.token) {
      const exp = data.expiration;
      let ttl = 3600000; // default 1h
      if (typeof exp === "number" && exp > Date.now()) ttl = exp - Date.now();
      else if (typeof exp === "string" && Date.parse(exp)) ttl = Math.max(60000, Date.parse(exp) - Date.now());
      _integrity = { token: data.token, until: Date.now() + Math.min(ttl, 6 * 3600000) * 0.9 };
      return _integrity.token;
    }
  } catch (e) {}
  return null;
}

async function claimDropAPI(dropInstanceID) {
  const ck = await getTwitchCookies();
  if (!ck || !ck.auth) return { error: "no auth" };
  const attempt = async (extraHeaders) => {
    const resp = await fetch("https://gql.twitch.tv/gql", {
      method: "POST", credentials: "include",
      headers: Object.assign({}, GQL_HEADERS(ck.auth, ck.device), extraHeaders || {}),
      body: JSON.stringify([{
        operationName: "DropsPage_ClaimDropRewards",
        variables: { input: { dropInstanceID: dropInstanceID } },
        extensions: { persistedQuery: { version: 1, sha256Hash: "a455deea71bdc9015b78eb49f4acfbce8baa7ccbedd28e549bb025bd0f751930" } }
      }])
    });
    return JSON.parse(await resp.text());
  };
  // attach a cached integrity token right away if we have a valid one
  let arr = await attempt(_integrity && _integrity.until > Date.now() ? { "Client-Integrity": _integrity.token } : null);
  let r0 = Array.isArray(arr) ? arr[0] : arr;
  const errText = r0 && r0.errors ? JSON.stringify(r0.errors) : "";
  if (errText && /integrity/i.test(errText)) {
    // rejected by bot-protection: fetch an integrity token and retry once
    const token = await getIntegrityToken(ck);
    if (token) {
      arr = await attempt({ "Client-Integrity": token });
      r0 = Array.isArray(arr) ? arr[0] : arr;
    }
  }
  if (r0 && r0.errors) return { error: JSON.stringify(r0.errors).slice(0, 200) };
  const cr = r0 && r0.data && r0.data.claimDropRewards;
  if (cr && !cr.error) return { ok: true, status: cr.status };
  return { error: (cr && cr.error) || "unexpected response" };
}

// ---------- toolbar badge: ready-to-claim (green) takes priority, else live (red) ----------
async function updateBadge() {
  try {
    const { lastScan } = await chrome.storage.local.get("lastScan");
    const drops = (lastScan && lastScan.drops) || [];
    let n = 0, bg = null;
    const ready = drops.filter(d => !d.claimed && d.pct >= 100).length;
    if (ready > 0) { n = ready; bg = "#2f9e68"; }
    else {
      n = drops.filter(d => !d.claimed && d.live).length;
      if (n > 0) bg = "#e91916";
    }
    if (bg) chrome.action.setBadgeBackgroundColor({ color: bg });
    chrome.action.setBadgeText({ text: n > 0 ? String(n) : "" });
  } catch (e) {}
}


// click the Claim button for a specific drop on the real inventory page
// resolves true if a matching Claim button was found and clicked
async function claimOnPage(dropName) {
  const tab = await chrome.tabs.create({ url: INV_URL + "?cb=" + Date.now(), active: false });
  markOurTab(tab.id);
  tabLog("open", "claim-fallback");
  try {
    await waitTabLoad(tab.id);
    try { await chrome.tabs.reload(tab.id, { bypassCache: true }); await waitTabLoad(tab.id); } catch (e) {}
    await extractWithRetry(tab.id);
    let res = null;
    try { res = await chrome.tabs.sendMessage(tab.id, { action: "claimDropByName", name: dropName }); } catch (e) {}
    return !!(res && res.clicked);
  } finally {
    try { await chrome.tabs.remove(tab.id); tabLog("close", "claim-fallback"); } catch (e) {}
  }
}

async function monitorTick() {
  withState(async () => {
    const { lastScan } = await chrome.storage.local.get("lastScan");
    if (!lastScan || !lastScan.drops || !lastScan.drops.length) return;

    // fresh live data from facepunch (network only, no tab)
    const fp = parseFacepunch(await fetchFacepunch());
    for (const d of lastScan.drops) {
      if (d.claimed) { d.live = false; continue; }
      const f = fp.drops.find(x => sameDrop(x, d));
      if (f && f.streamers && f.streamers.length) d.streamers = f.streamers;
    }

    // verify via twitch api: live AND playing rust
    const all = [];
    for (const d of lastScan.drops) if (!d.claimed && d.streamers) all.push(...d.streamers);
    const liveMap = await verifyLiveStreamers(all);
    if (!liveMap) return;

    const nowLive = [];
    for (const d of lastScan.drops) {
      if (d.claimed || !d.streamers) continue;
      d.live = false;
      for (const s of d.streamers) {
        const login = ((s.url || "").split("/").filter(Boolean).pop() || s.name || "").toLowerCase();
        if (login in liveMap) { s.live = liveMap[login]; if (s.live) d.live = true; }
      }
      if (d.live && d.wasLive === false) nowLive.push(d);
      d.wasLive = !!d.live;
    }
    lastScan.lastUpdated = new Date().toISOString();
    await chrome.storage.local.set({ lastScan });
    updateBadge();

    if (nowLive.length) {
      const settings = await getNotifSettings();
      for (const d of nowLive) {
        const ch0 = (d.streamers || []).find(s => s.live);
        const watchUrl = (ch0 && ch0.url) || (d.isGeneral && !d.claimed ? d.watchUrl : null);
        // BETA: auto-watch opens the live stream muted + pinned in the background
        if (watchUrl) {
          if (settings.autoWatch && !d.autoWatched) {
            d.autoWatched = true;
            try {
              const t = await chrome.tabs.create({ url: watchUrl, active: false });
              if (t && t.id) { chrome.tabs.update(t.id, { muted: true, pinned: true }); }
            } catch (e) {}
          } else if (settings.autoOpen && !d.autoOpened) {
            d.autoOpened = true;
            try { chrome.tabs.create({ url: watchUrl, active: false }); } catch (e) {}
          }
        }
        if (!settings.liveEnabled) continue;
        const ch = ch0 || { name: "" };
        chrome.notifications.create("live-" + norm(d.name), {
          type: "basic",
          iconUrl: "icon128.png",
          title: "RUST DROP LIVE: " + d.name,
          message: "Unclaimed drop is online now - click to watch" + (ch && ch.name ? " (" + ch.name + ")" : ""),
          priority: 2
        });
        if (settings.liveSound) beep(settings.liveSoundId);
      }
    }
  }).catch(() => {});
}

chrome.notifications.onClicked.addListener((id) => {
  if (id.indexOf("ready-") === 0) {
    chrome.tabs.create({ url: INV_URL, active: false });
    return;
  }
  if (id.indexOf("live-") !== 0) return;
  chrome.storage.local.get("lastScan", (data) => {
    if (!data.lastScan) return;
    const d = data.lastScan.drops.find(x => "live-" + norm(x.name) === id);
    if (d) {
      const ch = (d.streamers || []).find(s => s.live);
      const url = (ch && ch.url) || d.watchUrl;
      if (url) chrome.tabs.create({ url: url, active: false });
    }
  });
});


// notify when a watched drop completes (leaves in-progress, not yet claimed)
async function notifyReady(d) {
  try {
    const settings = await getNotifSettings();
    if (!settings.readyEnabled) return;
    chrome.notifications.create("ready-" + norm(d.name), {
      type: (d.image && String(d.image).indexOf("http") === 0) ? "image" : "basic",
      imageUrl: (d.image && String(d.image).indexOf("http") === 0) ? d.image : undefined,
      iconUrl: "icon128.png",
      title: "RUST DROP READY: " + d.name,
      message: "100% watched - click to open your Drops Inventory and claim it",
      silent: false,
      priority: 2
    });
    if (settings.readySound) beep(settings.readySoundId);
  } catch (e) {}
}

// ---------- ETA (minutes-left) based on watch rate between progress updates ----------
// rate is only computable while the user is actually watching (pct advances in
// the 20s inventory updates). Returns null when there's not enough history.
function etaMinutes(d, now) {
  if (d.pct == null || typeof d.pct !== "number") { return null; }
  let eta = null;
  if (d._prevPct != null && d._prevTs != null && now > d._prevTs) {
    const dtMin = (now - d._prevTs) / 60000;
    if (dtMin > 0.25 && dtMin <= 120) {
      const rate = (d.pct - d._prevPct) / dtMin;      // pct points per minute
      if (rate > 0) { eta = (100 - d.pct) / rate; }  // minutes remaining
    }
  }
  d._prevPct = d.pct;
  d._prevTs = now;
  if (eta == null) { return null; }
  return eta < 0 ? 0 : eta;
}

// ---------- auto-claim fallback: click the Claim button on the inventory page ----------
// used when the API can't be used (no dropInstanceID, or integrity/API reject)
const FALLBACK_RETRY_MS = 30 * 60000;
function setClaimStatus(d, result) {
  try {
    chrome.storage.local.set({ claimStatus: { name: d.name, instanceId: !!d.dropInstanceID, at: new Date().toISOString(), result: result } });
  } catch (e) {}
}
function claimDropFallback(d, source) {
  if (d._fallbackTry && Date.now() - d._fallbackTry < FALLBACK_RETRY_MS) { return; }  // retry the page-claim at most every 30 min
  d._fallbackTry = Date.now();
  try {
    chrome.notifications.create("claimfail-" + norm(d.name), {
      type: "basic", iconUrl: "icon128.png", silent: false, priority: 2,
      title: "Auto-claim: " + d.name,
      message: source ? ("(" + source + ") - clicking the inventory Claim button") : "clicking the inventory Claim button..."
    });
  } catch (e) {}
  beep(3);
  setClaimStatus(d, "page-claim (trying)");
  claimOnPage(d.name).then(async (ok) => {
    if (ok) {
      setClaimStatus(d, "ok (page)");
      try { await addClaimHistory(d.name, "page-claim"); } catch (e) {}
      if (!d.claimed) { d.claimed = true; d.pct = 100; d.progress = "100%"; d.wasReady = false; }
      try { await chrome.storage.local.set({ lastScan }); } catch (e) {}
      updateBadge();
    } else {
      setClaimStatus(d, "FAIL page (Claim button not found)");
    }
  }).catch((e) => {
    setClaimStatus(d, "FAIL page " + String(e && e.message || e).slice(0, 60));
  });
}

// call after merging in-progress data: progNames = normalized names still in progress
async function trackReady(lastScan, progNames) {
  const now = Date.now();
  for (const d of lastScan.drops) {
    if (d.claimed) { d.wasReady = false; d._inProgress = false; d.etaMin = null; d._prevPct = null; d._prevTs = null; continue; }
    const key = norm(d.name);
    const inProg = progNames.indexOf(key) !== -1;
    d.etaMin = etaMinutes(d, now);
    if (d._inProgress && !inProg && !d.wasReady) {
      d.wasReady = true;
      d.pct = 100; d.progress = "100%"; // keep the bar visible at 100 instead of vanishing
      notifyReady(d);
    }
    if (d.pct >= 100 && !d.wasReady) {
      d.wasReady = true;
      notifyReady(d);
    }
    // auto-claim via API when we have a dropInstanceID, else click the page button
    const claimReady = d.pct >= 100 && !d.claimed &&
      (!d._lastClaimTry || Date.now() - d._lastClaimTry > 5 * 60000);
    if (claimReady) {
      d._lastClaimTry = Date.now();
      const s = await getNotifSettings();
      if (s.autoClaim) {
        if (d.dropInstanceID) {
          claimDropAPI(d.dropInstanceID).then(async (res) => {
            setClaimStatus(d, res.ok ? "ok (api)" : ("FAIL " + res.error));
            if (res.ok) {
              await markClaimed(d, "api-claim");
              d.wasReady = false;
              try { await chrome.storage.local.set({ lastScan: lastScan }); } catch (e) {}
              updateBadge();
            } else {
              claimDropFallback(d, "api:" + String(res.error).slice(0, 40));
            }
          });
        } else {
          // no instance id returned by Twitch - claim by clicking the real button
          claimDropFallback(d, "no-instance-id");
        }
      }
    }
    d._inProgress = inProg;
  }
}



// ---------- direct inventory via Twitch GQL (no tab, always fresh) ----------
let cachedAuth = null;

function randomDevice() {
  return "companion-" + Math.random().toString(36).slice(2, 12);
}

// validate a user-supplied auth token + discover their login name
async function gqlLogin(auth, device) {
  try {
    const resp = await fetch("https://gql.twitch.tv/gql", {
      method: "POST", credentials: "include",
      headers: GQL_HEADERS(auth, device || "companion"),
      body: JSON.stringify({ query: "query { currentUser { login } }" })
    });
    const data = JSON.parse(await resp.text());
    if (data && data.data && data.data.currentUser && data.data.currentUser.login) { return data.data.currentUser.login; }
    if (data && data.data) { return data.data.currentUser ? null : null; }
    return null;
  } catch (e) { return null; }
}

async function getTwitchCookies() {
  // 0) if a saved account is selected, use its token (independent of browser login)
  try {
    const { twitchAccounts, activeTwitchAccount } = await chrome.storage.local.get(["twitchAccounts", "activeTwitchAccount"]);
    const accounts = Array.isArray(twitchAccounts) ? twitchAccounts : [];
    const idx = activeTwitchAccount != null ? activeTwitchAccount : -1;
    if (idx >= 0 && accounts[idx] && accounts[idx].auth) {
      const ck = { auth: accounts[idx].auth, device: accounts[idx].device || "companion", login: accounts[idx].login || null };
      cachedAuth = ck;
      return ck;
    }
  } catch (e) {}
  // 1) fast path: cookies API
  try {
    const c = await chrome.cookies.get({ url: "https://www.twitch.tv/", name: "auth-token" });
    if (c && c.value) {
      const d = await chrome.cookies.get({ url: "https://www.twitch.tv/", name: "unique_id" });
      cachedAuth = { auth: c.value, device: (d && d.value) || "companion" };
      try { chrome.storage.local.set({ twitchAuth: cachedAuth }); } catch (e) {}
      return cachedAuth;
    }
  } catch (e) {}
  // 2) cached in memory or persisted from a previous page-context read
  if (cachedAuth) return cachedAuth;
  try {
    const stored = (await chrome.storage.local.get("twitchAuth")).twitchAuth;
    if (stored && stored.auth) { cachedAuth = stored; return cachedAuth; }
  } catch (e) {}
  // 3) page context: open a hidden twitch tab, read document.cookie there
  const authUrl = "https://www.twitch.tv/directory?cb=" + Date.now();
  const tab = await chrome.tabs.create({ url: authUrl, active: false }); markOurTab(tab.id);
  tabLog("open", authUrl);
  try {
    await waitTabLoad(tab.id);
    await sleep(2500);
    let res = null;
    for (let i = 0; i < 5 && !res; i++) {
      try { res = await chrome.tabs.sendMessage(tab.id, { action: "getAuth" }); } catch (e) {}
      if (!res) await sleep(1000);
    }
    if (res && res.auth) {
      cachedAuth = { auth: res.auth, device: res.device || "companion" };
      try { chrome.storage.local.set({ twitchAuth: cachedAuth }); } catch (e) {}
      return cachedAuth;
    }
    return { error: "no auth in page cookie" };
  } finally {
    try { await chrome.tabs.remove(tab.id); tabLog("close", authUrl); } catch (e) {}
  }
}

const GQL_HEADERS = (auth, device) => ({
  "Authorization": "OAuth " + auth,
  "Client-ID": "kimne78kx3ncx6brgo4mv6wki5h1ko",
  "X-Device-Id": device,
  "Content-Type": "text/plain; charset=UTF-8",
  "Accept": "*/*"
});

async function gqlInventory() {
  const ck = await getTwitchCookies();
  if (!ck || !ck.auth) return { error: (ck && ck.error) || "no twitch auth cookie - log in at twitch.tv" };
  const auth = ck.auth, device = ck.device;

  // 1) PERSISTED "Inventory" query - Twitch authorizes it fully; it returns
  //    gameEventDrops (the COMPLETE claimed list, incl. fully-completed campaigns)
  let invR = null;
  let usedPersisted = false;
  let persistedErr = null;
  try {
    const resp = await fetch("https://gql.twitch.tv/gql", {
      method: "POST", credentials: "include",
      headers: GQL_HEADERS(auth, device),
      body: JSON.stringify([{
        operationName: "Inventory",
        variables: { fetchRewardCampaigns: false },
        extensions: { persistedQuery: { version: 1, sha256Hash: "8337eb8541b314040b0edde0c09c5c7a2783ba1960aa9edfbf3bac16d0fec404" } }
      }])
    });
    const arr = JSON.parse(await resp.text());
    const r0 = Array.isArray(arr) ? arr[0] : arr;
    if (r0 && r0.data && r0.data.currentUser && r0.data.currentUser.inventory) {
      invR = r0.data.currentUser.inventory;
      usedPersisted = true;
    } else if (r0 && r0.errors) {
      persistedErr = JSON.stringify(r0.errors).slice(0, 150);
    }
  } catch (e) {
    persistedErr = String(e && e.message || e);
  }

  // 2) ad-hoc fallback (no gameEventDrops here - Twitch nulls it for ad-hoc calls)
  if (!invR) {
    const q1 = `query {
      currentUser {
        id
        login
        inventory {
          dropCampaignsInProgress {
            id
            name
            game { name }
            timeBasedDrops {
              id
              name
              requiredMinutesWatched
              self { currentMinutesWatched isClaimed dropInstanceID }
            }
          }
        }
      }
    }`;
    try {
      const resp2 = await fetch("https://gql.twitch.tv/gql", {
        method: "POST", credentials: "include",
        headers: GQL_HEADERS(auth, device),
        body: JSON.stringify({ query: q1 })
      });
      const data = JSON.parse(await resp2.text());
      if (data.errors) return { error: "gql: " + JSON.stringify(data.errors).slice(0, 250) };
      invR = data.data && data.data.currentUser && data.data.currentUser.inventory;
      if (!invR) return { error: "no inventory in response" };
    } catch (e) {
      return { error: "fetch failed: " + String(e && e.message || e) };
    }
  }

  const campaigns = invR.dropCampaignsInProgress;
  const diag = {
    geCount: (invR.gameEventDrops || []).length,
    campCount: (campaigns || []).length,
    hasGE: Array.isArray(invR.gameEventDrops),
    persisted: usedPersisted,
    persistedErr: persistedErr
  };

  const geName = (ge) => ge.name || (ge.benefit && ge.benefit.name) ||
    (ge.benefitEdges && ge.benefitEdges[0] && ge.benefitEdges[0].benefit && ge.benefitEdges[0].benefit.name) ||
    (ge.drop && ge.drop.name) || null;

  const drops = [];
  // gameEventDrops = complete claimed benefits list (incl. campaigns that fully
  // completed and disappeared from dropCampaignsInProgress)
  for (const ge of (invR.gameEventDrops || [])) {
    const n = geName(ge);
    if (!n) continue;
    drops.push({ id: ge.id, name: n, fromGE: true, isClaimed: true,
      earnedMinutesWatched: 0, requiredMinutesWatched: 0,
      game: { name: "Rust" }, campaign: { name: "claimed" } });
  }
  // in-progress campaigns with live per-drop minutes
  for (const camp of (campaigns || [])) {
    for (const td of (camp.timeBasedDrops || [])) {
      const tdName = td.name || (td.benefitEdges && td.benefitEdges[0] && td.benefitEdges[0].benefit && td.benefitEdges[0].benefit.name) || null;
      if (!tdName) continue;
      const self = td.self || {};
      drops.push({ id: td.id, name: tdName, isClaimed: !!self.isClaimed,
        dropInstanceID: self.dropInstanceID || null,
        earnedMinutesWatched: self.currentMinutesWatched || 0,
        requiredMinutesWatched: td.requiredMinutesWatched || 0,
        game: camp.game, campaign: { name: camp.name } });
    }
  }
  return { drops: drops, diag: diag };
}

// ---------- light background updater ----------
// claimed status + progress refresh via ONE hidden tab (no campaigns page = fast)
async function mergeInventoryData(lastScan, inv, st) {
  const claimed = inv.claimed || [];
  lastInvClaimed = claimed;
  let matched = 0;
  const unmatched = [];
  const pairs = [];
  for (const c of claimed) {
    if (isOldEventClaim(c.name)) continue; // old-event item: never marks a current drop
    // mark ALL same-name variants (general + streamer copies of one item)
    const cands = lastScan.drops.filter(d => nameMatches(d.name, c.name));
    for (const d of cands) {
      d.claimed = true; matched++;
      // audit trail: record WHICH source name claimed WHICH drop (catches bad fuzzy matches)
      if (norm(c.name) !== norm(d.name)) pairs.push(c.name + " -> " + d.name);
    }
    if (!cands.length) unmatched.push(c.name);
  }
  if (st) {
    st.unmatchedClaimed = unmatched.slice(0, 8).join(", ");
    st.claimPairs = pairs.slice(0, 12);
  }
  const progNames = [];
  for (const p of (inv.inProgress || [])) {
    const d = (lastScan.drops.filter(x => nameMatches(x.name, p.name)).length > 1)
      ? pickProgressMatch(lastScan.drops, p.name)
      : pickMatch(lastScan.drops, p.name);
    if (d) {
      d.pct = Math.max(d.pct || 0, p.percent); d.progress = d.pct + "%";
      if (p.dropInstanceID) d.dropInstanceID = p.dropInstanceID;
      progNames.push(norm(d.name));
    }
  }
  await trackReady(lastScan, progNames);
  lastScan.lastUpdated = new Date().toISOString();
  await chrome.storage.local.set({ lastScan });
  st.ok = true;
  st.matched = matched;
  st.inProgress = (inv.inProgress || []).length;
}

// a stored FAIL whose drop is confirmed claimed on the inventory is stale - flip it to ok
async function syncStaleClaimStatus(lastScan) {
  try {
    const { claimStatus } = await chrome.storage.local.get("claimStatus");
    if (!claimStatus || !/^FAIL/.test(String(claimStatus.result || "")) || !lastScan || !lastScan.drops) return;
    const d = lastScan.drops.find(x => x.claimed && nameMatches(x.name, claimStatus.name));
    if (d) {
      await chrome.storage.local.set({ claimStatus: Object.assign({}, claimStatus, { at: new Date().toISOString(), result: "ok (confirmed via inventory)" }) });
    }
  } catch (e) {}
}

async function updateClaimedAndProgress(allowTab) {
  const st = { attemptedAt: new Date().toISOString() };
  try {
    const { lastScan } = await chrome.storage.local.get("lastScan");
    if (!lastScan || !lastScan.drops || !lastScan.drops.length) {
      st.error = "no lastScan";
      await chrome.storage.local.set({ updateStatus: st });
      return;
    }
    const g = await gqlInventory();
    let inv = { claimed: [], inProgress: [] };
    if (g.drops) {
      for (const gd of g.drops) {
        const isRust = /rust/i.test((gd.game && gd.game.name) || "") || /rust/i.test(gd.campaign && gd.campaign.name || "") || /rust/i.test(gd.name || "");
        if (!isRust) continue;
        const earned = gd.earnedMinutesWatched || 0;
        const required = gd.requiredMinutesWatched || 0;
        if (gd.isClaimed) inv.claimed.push({ name: gd.name, fromGE: !!gd.fromGE });
        else if (required > 0 && earned >= required) inv.inProgress.push({ name: gd.name, percent: 100, dropInstanceID: gd.dropInstanceID || null });
        else if (required > 0 && earned > 0) inv.inProgress.push({ name: gd.name, percent: Math.min(99, Math.round(earned / required * 100)), dropInstanceID: gd.dropInstanceID || null });
      }
      st.source = "api";
      st.claimedSeen = inv.claimed.length;
      st.claimedFromGE = inv.claimed.filter(c => c.fromGE).length;
      if (g.diag) {
        st.geCount = g.diag.geCount; st.campCount = g.diag.campCount;
        st.persisted = g.diag.persisted;
        if (g.diag.persistedErr) st.apiError = "persisted: " + g.diag.persistedErr;
        if (!g.diag.persisted && !g.diag.persistedErr) st.apiError = "persisted query returned nothing";
      }
    } else {
      st.apiError = g.error || "unknown";
    }

    if (!allowTab) {
      if (st.source === "api") {
        await withState(async () => { await mergeInventoryData(lastScan, inv, st); });
        await syncStaleClaimStatus(lastScan);
      }
      st.finishedAt = new Date().toISOString();
      await chrome.storage.local.set({ updateStatus: st });
      return;
    }

    // optional authoritative tab recheck (only when enabled in settings)
    try {
      const url = INV_URL + "?cb=" + Date.now();
      const tab = await chrome.tabs.create({ url: url, active: false }); markOurTab(tab.id);
      tabLog("open", url);
      try {
        await waitTabLoad(tab.id);
        try { await chrome.tabs.reload(tab.id, { bypassCache: true }); await waitTabLoad(tab.id); } catch (e) {}
        const tabInv = await extractWithRetry(tab.id);
        const alreadyClaimed = (n) => inv.claimed.some(c => nameMatches(c.name, n));
        for (const c of (tabInv.claimed || [])) {
          if (!alreadyClaimed(c.name)) inv.claimed.push({ name: c.name });
        }
        if (!inv.inProgress.length) inv.inProgress = tabInv.inProgress || [];
        st.source = st.source ? st.source + "+tab" : "tab";
      } finally {
        try { await chrome.tabs.remove(tab.id); tabLog("close", url); } catch (e) {}
      }
    } catch (e) {
      st.tabError = String(e && e.message || e);
    }

    if (st.source) await withState(async () => { await mergeInventoryData(lastScan, inv, st); });
    await syncStaleClaimStatus(lastScan);
    updateBadge();
  } catch (e) {
    st.error = String(e && e.message || e);
  }
  st.finishedAt = new Date().toISOString();
  await chrome.storage.local.set({ updateStatus: st });
}

const BUILD_TAG = "5.30-" + Date.now();
chrome.storage.local.set({ buildTag: BUILD_TAG });
chrome.alarms.clearAll(() => {
  chrome.alarms.create("tick", { periodInMinutes: 20 / 60 });
});
let tickCount = 0;
let lastDataAt = null;
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name !== "tick" || scanning) return;
  tickCount++;
  const doLive = (tickCount % 3) === 0;   // every ~60s
  lastDataAt = new Date().toISOString();
  chrome.storage.local.set({ alarmHeartbeat: { name: a.name, at: lastDataAt, tick: tickCount, doLive: doLive } });
  startKeepalive();
  (async () => {
    // hidden-tab claimed re-check: OFF by default, every ~30 min when enabled
    const extSettings = ((await chrome.storage.local.get("extSettings")).extSettings) || {};
    const allowTab = !!extSettings.tabRecheck && (tickCount % 90) === 0;
    try { await updateClaimedAndProgress(allowTab); } catch (e) {}
    if (doLive) { try { await monitorTick(); } catch (e) {} }
    stopKeepalive();
  })();
});

// refresh shortly after browser start so claimed/progress are current
chrome.runtime.onStartup.addListener(() => {
  setTimeout(() => {
    startKeepalive();
    (async () => {
      try { await updateClaimedAndProgress(false); } catch (e) {}
      try { await monitorTick(); } catch (e) {}
      stopKeepalive();
    })();
  }, 20000);
});

// also refresh ~30s after install/reload so data is fresh immediately
chrome.runtime.onInstalled.addListener(() => {
  setTimeout(() => {
    startKeepalive();
    (async () => {
      try { await updateClaimedAndProgress(false); } catch (e) {}
      try { await monitorTick(); } catch (e) {}
      stopKeepalive();
    })();
  }, 30000);
});
