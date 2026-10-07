// content_auth.js - reads the auth cookie the same way the Twitch page does
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getAuth") {
    const out = {};
    document.cookie.split("; ").forEach((entry) => {
      const kv = entry.split("=");
      if (kv[0] === "auth-token") out.auth = kv.slice(1).join("=");
      if (kv[0] === "unique_id") out.device = kv.slice(1).join("=");
    });
    sendResponse(out);
    return true;
  }
});
