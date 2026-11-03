// content_directory.js - runs on twitch.tv/directory/category/rust
// Cross-check: streamers here are ONLINE and playing Rust right now.
function showDropsEnabledReminder() {
  const params = new URLSearchParams(location.search);
  if (params.get("rustDropsReminder") !== "1" || !document.body) return;

  const host = document.createElement("div");
  host.style.cssText = "position:fixed;z-index:2147483647;top:16px;left:50%;transform:translateX(-50%);";
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `
    <style>
      section {
        display:flex;align-items:flex-start;gap:14px;max-width:min(460px,calc(100vw - 32px));
        padding:14px 16px;border:1px solid #9147ff;border-radius:12px;
        background:#18181b;color:#efeff1;box-shadow:0 8px 32px #0009;
        font:14px/1.45 Arial,sans-serif;animation:enter .2s ease-out;
      }
      strong { display:block;margin-bottom:3px;color:#fff;font-size:14px; }
      p { margin:0;color:#d1d1d3; }
      button { border:0;background:transparent;color:#adadb8;font-size:20px;line-height:1;cursor:pointer; }
      @keyframes enter { from { opacity:0;transform:translateY(-8px); } to { opacity:1;transform:translateY(0); } }
    </style>
    <section role="status" aria-live="polite">
      <div><strong>To earn these Rust drops</strong>
        <p>Choose a live stream marked <b>Drops Enabled</b> on Twitch.</p></div>
      <button type="button" aria-label="Dismiss reminder">×</button>
    </section>`;
  document.body.appendChild(host);

  const dismiss = () => host.remove();
  shadow.querySelector("button").addEventListener("click", dismiss);
  setTimeout(dismiss, 12000);
}

showDropsEnabledReminder();

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
