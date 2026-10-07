// content_directory.js - runs on twitch.tv/directory/category/rust
// Cross-check: streamers here are ONLINE and playing Rust right now.
function extractLiveRust() {
  const channels = [];
  document.querySelectorAll('a[href^="/"]').forEach((a) => {
    const href = (a.getAttribute("href") || "").split("?")[0];
    const seg = href.split("/").filter(Boolean);
    if (seg.length !== 1) return;
    if (/[^a-z0-9_-]/i.test(seg[0])) return;
    if (["directory","drops","settings","inventory","downloads","p","subscriptions","wallet","friends","messages","moderator","creatordashboard"].indexOf(seg[0].toLowerCase()) !== -1) return;
    // must be a live card: nearby "LIVE" indicator
    let node = a, live = false;
    for (let d = 0; d < 5 && node; d++) {
      const t = node.innerText || "";
      if (/\bLIVE\b/i.test(t) && /viewer/i.test(t)) { live = true; break; }
      node = node.parentElement;
    }
    if (live && !channels.includes(seg[0].toLowerCase())) channels.push(seg[0].toLowerCase());
  });
  return channels;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "extract") {
    (async () => {
      await new Promise(r => setTimeout(r, 2500)); // let cards render
      sendResponse({ liveRust: extractLiveRust(), url: location.href });
    })();
    return true;
  }
});
