const REDIRECT_URI = "https://127.0.0.1:8182";
const TOKEN_URL = "https://api.schwabapi.com/v1/oauth/token";

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url) return;
  if (!changeInfo.url.startsWith(REDIRECT_URI)) return;

  // Check this is our auth tab
  const session = await chrome.storage.session.get(["authTabId", "state", "clientId", "clientSecret"]);
  if (tabId !== session.authTabId) return;

  // Close the auth tab immediately
  chrome.tabs.remove(tabId);
  await chrome.storage.session.remove("authTabId");

  const params = new URL(changeInfo.url).searchParams;
  const code  = params.get("code");
  const state = params.get("state");

  // Verify state
  if (!code || state !== session.state) {
    notifyPopup({ type: "TOKEN_ERROR", error: "State mismatch or missing code — possible CSRF. Try again." });
    return;
  }

  // Exchange code for token
  const credentials = btoa(`${session.clientId}:${session.clientSecret}`);

  try {
    const resp = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      notifyPopup({ type: "TOKEN_ERROR", error: `HTTP ${resp.status}: ${text.slice(0, 120)}` });
      return;
    }

    const token = await resp.json();
    notifyPopup({ type: "TOKEN_SUCCESS", tokenJson: JSON.stringify(token, null, 2) });

  } catch (err) {
    // Likely a CORS error — guide the user
    if (err.name === "TypeError" && err.message.includes("fetch")) {
      notifyPopup({
        type: "TOKEN_ERROR",
        error: "CORS blocked by Schwab. A Cloudflare Worker proxy is needed — see README.md for setup instructions.",
      });
    } else {
      notifyPopup({ type: "TOKEN_ERROR", error: err.message });
    }
  }
});

function notifyPopup(msg) {
  // Send to any open popup — if popup is closed this is a no-op
  chrome.runtime.sendMessage(msg).catch(() => {});
}
