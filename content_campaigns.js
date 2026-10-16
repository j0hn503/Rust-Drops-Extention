// content_campaigns.js - runs on twitch.tv/drops/campaigns
function sleepMs(ms) { return new Promise(r => setTimeout(r, ms)); }

function scrollTargets() {
  const cands = [];
  [document.scrollingElement, document.documentElement, document.body].forEach(e => { if (e) cands.push(e); });
  document.querySelectorAll("div").forEach(d => {
    if (d.scrollHeight > d.clientHeight + 200 && d.clientHeight > 300) cands.push(d);
  });
  cands.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
  return cands.slice(0, 3);
}

async function scrollToBottom() {
  const targets = scrollTargets();
  let last = 0, stable = 0;
  for (let i = 0; i < 40; i++) {
    for (const t of targets) t.scrollTop = t.scrollHeight;
    window.scrollTo(0, document.body.scrollHeight);
    await sleepMs(500);
    const h = Math.max(0, ...targets.map(t => t.scrollHeight));
    if (h === last) { if (++stable >= 3) break; } else { stable = 0; last = h; }
  }
  for (const t of targets) t.scrollTop = 0;
  window.scrollTo(0, 0);
  await sleepMs(800);
}

const NON_CHANNEL = ["directory","drops","settings","inventory","downloads","p","subscriptions","wallet","friends","messages","creatordashboard","moderator"];

function extractCampaigns(root) {
  const drops = [];
  const seen = new Set();
  const imgs = root ? Array.from(root.querySelectorAll('img[src*="/REWARD/"]')) : [];

  imgs.forEach((img) => {
    const name = (img.getAttribute("alt") || "").replace(/^Drop image for\s+/i, "").trim();
    if (!name || seen.has(name)) return;

    // smallest ancestor that also contains a <strong> = the campaign block
    let block = img.parentElement;
    for (let d = 0; d < 9 && block; d++) {
      if (root && !root.contains(block)) { block = null; break; }
      if (block.querySelector && block.querySelector("strong")) break;
      block = block.parentElement;
    }
    const strong = block && block.querySelector ? block.querySelector("strong") : null;
    const campaign = strong ? strong.textContent.trim() : "";

    // progress: role="progressbar" aria values, or % / fraction text near the card
    let percent = null;
    let pnode = img.parentElement;
    for (let d = 0; d < 9 && pnode && percent === null && (!root || root.contains(pnode)); d++) {
      const pb = pnode.querySelector ? pnode.querySelector('[role="progressbar"]') : null;
      if (pb) {
        const now = parseFloat(pb.getAttribute("aria-valuenow") || "");
        const max = parseFloat(pb.getAttribute("aria-valuemax") || "");
        if (!isNaN(now) && !isNaN(max) && max > 0) percent = Math.min(100, Math.round(now / max * 100));
        else {
          const al = pb.getAttribute("aria-label") || "";
          const am = al.match(/(\d{1,3})\s*%/);
          if (am) percent = parseInt(am[1], 10);
        }
      }
      if (percent === null && pnode.innerText) {
        const pc = pnode.innerText.match(/(\d{1,3})\s*%/);
        if (pc) percent = parseInt(pc[1], 10);
      }
      pnode = pnode.parentElement;
    }

    const streamers = [];
    if (block) {
      block.querySelectorAll('a[href^="/"]').forEach((a) => {
        const href = (a.getAttribute("href") || "").split("?")[0];
        const seg = href.split("/").filter(Boolean);
        if (seg.length !== 1) return;
        if (NON_CHANNEL.indexOf(seg[0].toLowerCase()) !== -1) return;
        const sname = (a.textContent || "").trim();
        if (!sname) return;
        const url = "https://www.twitch.tv" + href;
        if (!streamers.some(s => s.url === url)) streamers.push({ name: sname, url: url });
      });
    }

    seen.add(name);
    drops.push({ name: name, campaign: campaign, image: img.src || "", streamers: streamers, percent: percent });
  });
  return { drops: drops };
}

function findRustAccordion() {
  const els = Array.from(document.querySelectorAll("p, strong, h1, h2, h3, span, div"));
  for (const el of els) {
    const own = (el.childNodes.length && el.textContent || "").replace(/\s+/g, " ").trim();
    if (!own || own.length > 60) continue;
    if (own === "Rust" || (own.startsWith("Rust") && el.parentElement && /facepunch/i.test(el.parentElement.textContent || ""))) {
      const clickable = el.closest("button, [role='button'], [role='heading']") ||
                        (el.parentElement && el.parentElement.closest("button, [role='button'], [role='heading']"));
      if (clickable) return clickable;
    }
  }
  // fallback: any button whose text mentions Rust + Facepunch
  const btns = Array.from(document.querySelectorAll("button, [role='button']"));
  for (const b of btns) {
    const t = (b.innerText || "").replace(/\s+/g, " ");
    if (/\bRust\b/.test(t) && /facepunch/i.test(t)) return b;
  }
  return null;
}

function rustCampaignRoot(header) {
  const controlledId = header && header.getAttribute("aria-controls");
  if (controlledId) {
    const controlled = document.getElementById(controlledId);
    if (controlled) return controlled;
  }
  let node = header;
  for (let d = 0; d < 8 && node; d++, node = node.parentElement) {
    if (node.querySelector && node.querySelector('img[src*="/REWARD/"]')) return node;
  }
  return null;
}

function isAccordionExpanded(header) {
  const expanded = header && header.getAttribute("aria-expanded");
  if (expanded === "true") return true;
  if (expanded === "false") return false;
  const root = rustCampaignRoot(header);
  if (root) {
    if (root.hidden || root.getAttribute("aria-hidden") === "true") return false;
    const style = window.getComputedStyle(root);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (root.querySelector('img[src*="/REWARD/"]')) return true;
  }
  return null;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "extract") {
    (async () => {
      const header = findRustAccordion();
      if (header && isAccordionExpanded(header) !== true) header.click();
      await sleepMs(1500);
      await scrollToBottom();
      let root = rustCampaignRoot(header);
      let result = extractCampaigns(root);
      if (result.drops.length === 0 && header && isAccordionExpanded(header) === false) {
        header.click();
        await sleepMs(1500);
        await scrollToBottom();
        root = rustCampaignRoot(header);
        result = extractCampaigns(root);
      }
      if (result.drops.length === 0) {
        result.error = "Twitch has not listed a Rust category on the Drops Campaigns page yet.";
      }
      sendResponse({
        ...result,
        rustFound: !!header && result.drops.length > 0,
        error: result.drops.length === 0 ? (result.error || "Twitch has not started the Rust category yet.") : null,
        url: location.href
      });
    })();
    return true;
  }
});
