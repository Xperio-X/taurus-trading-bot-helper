const REDIRECT_URI = "https://127.0.0.1:8182";
const TOKEN_URL = "https://api.schwabapi.com/v1/oauth/token";

// webNavigation fires before the page loads — catches ERR_CONNECTION_REFUSED redirects
// that tabs.onUpdated misses when nothing is running on 127.0.0.1:8182
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  console.log("onBeforeNavigate:", details.url);
  if (!details.url.startsWith(REDIRECT_URI)) return;
  if (details.frameId !== 0) return; // main frame only

  const tabId = details.tabId;
  const session = await chrome.storage.session.get(["authTabId", "state", "clientId", "clientSecret"]);
  console.log("session authTabId:", session.authTabId, "tabId:", tabId);
  if (tabId !== session.authTabId) return;

  // Close the auth tab immediately
  chrome.tabs.remove(tabId);
  await chrome.storage.session.remove("authTabId");

  const params = new URL(details.url).searchParams;
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
    await storeAndNotify({ type: "TOKEN_SUCCESS", tokenJson: JSON.stringify(token, null, 2) });

  } catch (err) {
    const msg = (err.name === "TypeError")
      ? "CORS blocked by Schwab. A Cloudflare Worker proxy is needed — see README.md for setup instructions."
      : err.message;
    await storeAndNotify({ type: "TOKEN_ERROR", error: msg });
  }
});

async function storeAndNotify(msg) {
  // Store result so popup can read it even if it was closed during auth
  await chrome.storage.session.set({ pendingResult: msg });
  // Also try live message if popup happens to be open
  chrome.runtime.sendMessage(msg).catch(() => {});
}
