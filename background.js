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

  console.log("code:", code ? code.slice(0, 20) + "..." : "MISSING");
  console.log("state match:", state === session.state);

  // Verify state
  if (!code || state !== session.state) {
    console.log("State/code check failed");
    await storeAndNotify({ type: "TOKEN_ERROR", error: "State mismatch or missing code — possible CSRF. Try again." });
    return;
  }

  // Exchange code for token
  const credentials = btoa(`${session.clientId}:${session.clientSecret}`);
  console.log("Fetching token...");

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

    console.log("Fetch response status:", resp.status);

    if (!resp.ok) {
      const text = await resp.text();
      console.log("Fetch error body:", text.slice(0, 200));
      await storeAndNotify({ type: "TOKEN_ERROR", error: `HTTP ${resp.status}: ${text.slice(0, 120)}` });
      return;
    }

    const rawToken = await resp.json();
    const nowSec = Math.floor(Date.now() / 1000);
    // schwab-py saves tokens as {"creation_timestamp": N, "token": {..., "expires_at": N}}
    // client_from_token_file() expects exactly this format
    rawToken.expires_at = nowSec + (rawToken.expires_in || 1800);
    const token = { creation_timestamp: nowSec, token: rawToken };
    console.log("Token received, keys:", Object.keys(rawToken));
    await storeAndNotify({ type: "TOKEN_SUCCESS", tokenJson: JSON.stringify(token, null, 2) });

  } catch (err) {
    console.log("Fetch threw:", err.name, err.message);
    const msg = (err.name === "TypeError")
      ? "CORS blocked by Schwab. A Cloudflare Worker proxy is needed — see README.md for setup instructions."
      : err.message;
    await storeAndNotify({ type: "TOKEN_ERROR", error: msg });
  }
});

async function storeAndNotify(msg) {
  // Store in local (not session) — session storage is not reliably accessible from popup
  await chrome.storage.local.set({ pendingResult: msg });
  console.log("pendingResult stored:", msg.type);
  // Also try live message if popup happens to be open
  chrome.runtime.sendMessage(msg).catch(() => {});
}
