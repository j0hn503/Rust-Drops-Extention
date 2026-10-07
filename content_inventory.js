// content_inventory.js - runs on twitch.tv/drops/inventory
const ALT_PREFIX = "Drop image for ";
const TIME_AGO_RE = /^(just now|\d+\s+(second|minute|hour|day|week|month|year)s?\s+ago|yesterday)$/i;
const PCT_RE = /(\d{1,3})\s*%/;
const FRAC_RE = /(\d+)\s*\/\s*(\d+)/;

function sleepMs(ms) { return new Promise(r => setTimeout(r, ms)); }

// Twitch scrolls an INNER container, not window. Find the real scrollable elements.
function scrollTargets() {
  const cands = [];
  [document.scrollingElement, document.documentElement, document.body].forEach(e => { if (e) cands.push(e); });
  document.querySelectorAll("div").forEach(d => {
    if (d.scrollHeight > d.clientHeight + 200 && d.clientHeight > 300) cands.push(d);
  });
  cands.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
  return cands.slice(0, 3);
}

async function clickLoadMore() {
  // claimed grid paginates behind a "Load More" button - click until gone
  for (let i = 0; i < 15; i++) {
    const btn = Array.from(document.querySelectorAll("button")).find((b) =>
      /^load more/i.test((b.innerText || "").trim()) && b.offsetParent !== null);
    if (!btn) break;
    btn.click();
    await sleepMs(1200);
  }
}

async function scrollToBottom() {
  await clickLoadMore(); // reveal all claimed cards first
  const targets = scrollTargets();
  let last = 0, stable = 0;
  for (let i = 0; i < 50; i++) {
    for (const t of targets) t.scrollTop = t.scrollHeight;
    window.scrollTo(0, document.body.scrollHeight);
    await sleepMs(600);
    const h = Math.max(0, ...targets.map(t => t.scrollHeight));
    if (h === last) { if (++stable >= 4) break; } else { stable = 0; last = h; }
  }
  await sleepMs(1000);
}

function percentFromBar(node) {
  if (!node || !node.querySelector) return null;
  const pb = node.querySelector('[role="progressbar"]');
  if (!pb) return null;
  const now = parseFloat(pb.getAttribute("aria-valuenow") || "");
  const max = parseFloat(pb.getAttribute("aria-valuemax") || "");
  if (!isNaN(now) && !isNaN(max) && max > 0) return Math.min(100, Math.round(now / max * 100));
  const al = pb.getAttribute("aria-label") || "";
  const m = al.match(/(\d{1,3})\s*%/);
  if (m) return parseInt(m[1], 10);
  const m2 = al.match(/(\d+)\s*of\s*(\d+)/i) || al.match(/(\d+)\s*\/\s*(\d+)/);
  if (m2 && Number(m2[2]) > 0) return Math.min(100, Math.round(Number(m2[1]) / Number(m2[2]) * 100));
  return null;
}

function nearInfo(img) {
  // walk ancestors: timestamp => claimed, progressbar/% => in progress
  let node = img, ago = null, percent = null;
  for (let d = 0; d < 9 && node; d++) {
    const text = node.innerText || "";
    if (ago === null) {
      const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
      const hit = lines.find(l => TIME_AGO_RE.test(l));
      if (hit) ago = hit;
    }
    if (percent === null) {
      percent = percentFromBar(node);
      if (percent === null) {
        const fr = text.match(FRAC_RE);
        const pc = text.match(PCT_RE);
        if (fr && Number(fr[2]) > 0) percent = Math.round(Number(fr[1]) / Number(fr[2]) * 100);
        else if (pc) percent = parseInt(pc[1], 10);
      }
    }
    if (ago && percent !== null) break;
    node = node.parentElement;
  }
  return { ago: ago, percent: percent };
}

// In-progress cards look DIFFERENT from claimed cards:
// img alt is just "Reward Image Icon" (not "Drop image for X"),
// name is a plain <p> in the same cell, progress is role="progressbar".
function extractInProgressBars() {
  const out = [];
  document.querySelectorAll('[role="progressbar"]').forEach((pb) => {
    const now = parseFloat(pb.getAttribute("aria-valuenow") || "");
    const max = parseFloat(pb.getAttribute("aria-valuemax") || "100");
    if (isNaN(now) || now <= 0) return;
    const pct = Math.min(100, Math.round(now / (max || 100) * 100));
    if (pct >= 100 || pct <= 0) return;
    // cell = smallest ancestor that also contains an image
    let cell = pb.parentElement;
    for (let d = 0; d < 6 && cell; d++) { if (cell.querySelector && cell.querySelector("img")) break; cell = cell.parentElement; }
    if (!cell) return;
    let name = null;
    (cell.querySelectorAll("p") || []).forEach((p) => {
      if (name) return;
      const t = (p.textContent || "").trim();
      if (!t || t.length < 3 || t.length > 60) return;
      if (/%|minute|hour|Day|no longer available|watch/i.test(t)) return;
      name = t;
    });
    if (name && !out.some(o => o.name === name)) out.push({ name: name, percent: pct });
  });
  return out;
}

function extractAll() {
  const claimed = [], inProgress = [];
  const seen = new Set();
  document.querySelectorAll("img[alt]").forEach((img) => {
    const alt = (img.getAttribute("alt") || "").trim();
    if (!alt.startsWith(ALT_PREFIX)) return;
    const name = alt.slice(ALT_PREFIX.length).trim();
    if (!name || seen.has(name)) return;
    const info = nearInfo(img);
    if (info.ago) { seen.add(name); claimed.push({ name: name, image: img.src || "", ago: info.ago }); }
    else if (info.percent !== null && info.percent < 100) {
      seen.add(name);
      inProgress.push({ name: name, image: img.src || "", percent: info.percent });
    }
  });
  // add progress-bar-based items (covers cards without "Drop image for" alt)
  for (const p of extractInProgressBars()) {
    if (!inProgress.some(x => x.name === p.name)) inProgress.push(p);
  }
  return { claimed: claimed, inProgress: inProgress };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "extract") {
    (async () => {
      await scrollToBottom();
      const data = extractAll(); // extract at bottom where all cards are loaded
      for (const t of scrollTargets()) t.scrollTop = 0;
      sendResponse({ ...data, url: location.href });
    })();
    return true;
  }
  if (request.action === "claimAll") {
    (async () => {
      const clicked = [];
      for (let round = 0; round < 5; round++) {
        const btns = [];
        document.querySelectorAll("button, [role='button']").forEach((b) => {
          const t = (b.innerText || "").trim();
          if (/^claim/i.test(t) && !b.disabled && b.offsetParent !== null) btns.push(t);
        });
        if (btns.length === 0) break;
        for (const t of btns) {
          const el = Array.from(document.querySelectorAll("button, [role='button']"))
            .find(b => (b.innerText || "").trim() === t && !b.disabled && b.offsetParent !== null);
          if (el) { el.click(); clicked.push(t); await sleepMs(1200); }
        }
        await sleepMs(1500);
      }
      sendResponse({ clicked: clicked });
    })();
    return true;
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "claimDropByName") {
    (async () => {
      const target = (request.name || "").toLowerCase();
      const btns = Array.from(document.querySelectorAll("button, [role='button']"))
        .filter(b => /^claim/i.test((b.innerText || "").trim()) && !b.disabled && b.offsetParent !== null);
      let clicked = false;
      for (const b of btns) {
        let node = b, claimed = false;
        for (let d = 0; d < 8 && node; d++) {
          const t = (node.innerText || "").toLowerCase();
          if (t.indexOf(target) !== -1) { claimed = true; break; }
          node = node.parentElement;
        }
        if (claimed) { clicked = true; b.click(); await new Promise(r => setTimeout(r, 1200)); }
      }
      sendResponse({ ok: true, clicked: clicked });
    })();
    return true;
  }
});
