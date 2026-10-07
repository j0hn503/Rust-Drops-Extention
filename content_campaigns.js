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

function extractCampaigns() {
  const drops = [];
  const seen = new Set();
  const imgs = Array.from(document.querySelectorAll('img[src*="/REWARD/"]'));

  imgs.forEach((img) => {
    const name = (img.getAttribute("alt") || "").trim();
    if (!name || seen.has(name)) return;
    if (!/rust|rustoria/i.test(name)) return;

    // smallest ancestor that also contains a <strong> = the campaign block
    let block = img.parentElement;
    for (let d = 0; d < 9 && block; d++) {
      if (block.querySelector && block.querySelector("strong")) break;
      block = block.parentElement;
    }
    const strong = block && block.querySelector ? block.querySelector("strong") : null;
    const campaign = strong ? strong.textContent.trim() : "";

    // progress: role="progressbar" aria values, or % / fraction text near the card
    let percent = null;
    let pnode = img.parentElement;
    for (let d = 0; d < 9 && pnode && percent === null; d++) {
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

// The Rust campaign list is a COLLAPSED accordion - rewards are not in the DOM
// until clicked. Find the header by TEXT (stable across redesigns) and click it.
function clickRustAccordion() {
  const els = Array.from(document.querySelectorAll("p, strong, h1, h2, h3, span, div"));
  for (const el of els) {
    const own = (el.childNodes.length && el.textContent || "").replace(/\s+/g, " ").trim();
    if (!own || own.length > 60) continue;
    if (own === "Rust" || (own.startsWith("Rust") && el.parentElement && /facepunch/i.test(el.parentElement.textContent || ""))) {
      const clickable = el.closest("button, [role='button'], [role='heading']") ||
                        (el.parentElement && el.parentElement.closest("button, [role='button'], [role='heading']"));
      if (clickable) { clickable.click(); return true; }
    }
  }
  // fallback: any button whose text mentions Rust + Facepunch
  const btns = Array.from(document.querySelectorAll("button, [role='button']"));
  for (const b of btns) {
    const t = (b.innerText || "").replace(/\s+/g, " ");
    if (/\bRust\b/.test(t) && /facepunch/i.test(t)) { b.click(); return true; }
  }
  return false;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "extract") {
    (async () => {
      // 1) click the Rust accordion (retry: it may re-render)
      for (let i = 0; i < 3; i++) {
        clickRustAccordion();
        await sleepMs(1500);
      }
      // 2) expand lazy content
      await scrollToBottom();
      // 3) one more click pass in case scroll collapsed/re-rendered headers
      clickRustAccordion();
      await sleepMs(1000);
      let result = extractCampaigns();
      // retry once if nothing found
      if (result.drops.length === 0) {
        await scrollToBottom();
        clickRustAccordion();
        await sleepMs(1500);
        result = extractCampaigns();
      }
      sendResponse({ ...result, url: location.href });
    })();
    return true;
  }
});
