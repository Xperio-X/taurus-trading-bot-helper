const REDIRECT_URI = "https://127.0.0.1:8182";
const AUTH_URL = "https://api.schwabapi.com/v1/oauth/authorize";
const TOKEN_URL = "https://api.schwabapi.com/v1/oauth/token";

const elClientId     = document.getElementById("client-id");
const elClientSecret = document.getElementById("client-secret");
const elToggle       = document.getElementById("toggle-secret");
const elAuthorize    = document.getElementById("btn-authorize");
const elStatus       = document.getElementById("status");
const elTokenSection = document.getElementById("token-section");
const elTokenOutput  = document.getElementById("token-output");
const elCopy         = document.getElementById("btn-copy");
const elManual       = document.getElementById("manual-section");
const elRedirectUrl  = document.getElementById("redirect-url");
const elSubmitUrl    = document.getElementById("btn-submit-url");

// Load saved credentials
chrome.storage.local.get(["clientId", "clientSecret"], (data) => {
  if (data.clientId)     elClientId.value     = data.clientId;
  if (data.clientSecret) elClientSecret.value = data.clientSecret;
});

// Check for a result stored while popup was closed
chrome.storage.local.get(["pendingResult"], (data) => {
  console.log("pendingResult on open:", data.pendingResult);
  if (data.pendingResult) {
    handleResult(data.pendingResult);
    chrome.storage.local.remove("pendingResult");
  }
});

// Show/hide secret
elToggle.addEventListener("click", () => {
  const isHidden = elClientSecret.type === "password";
  elClientSecret.type = isHidden ? "text" : "password";
  elToggle.textContent = isHidden ? "hide" : "show";
});

// Authorize button
elAuthorize.addEventListener("click", async () => {
  const clientId     = elClientId.value.trim();
  const clientSecret = elClientSecret.value.trim();

  if (!clientId || !clientSecret) {
    showStatus("Client ID and Client Secret are required.", "error");
    return;
  }

  // Save credentials
  chrome.storage.local.set({ clientId, clientSecret });

  // Generate state and build auth URL
  const state = Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map(b => b.toString(16).padStart(2, "0")).join("");

  // Use local (not session) storage — session storage is unreliable in mobile browsers
  await chrome.storage.local.set({ authState: state, authClientId: clientId, authClientSecret: clientSecret });

  const url = `${AUTH_URL}?client_id=${encodeURIComponent(clientId)}`
    + `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`
    + `&response_type=code`
    + `&state=${state}`;

  // Open auth tab and store its ID
  const tab = await chrome.tabs.create({ url });
  await chrome.storage.local.set({ authTabId: tab.id });

  elAuthorize.disabled = true;
  elManual.style.display = "block";
  showStatus("Schwab login page opened — complete login, MFA, and Authorize. On mobile, paste the redirect URL below.", "info");
});

// Manual URL paste handler (mobile fallback)
elSubmitUrl.addEventListener("click", async () => {
  const rawUrl = elRedirectUrl.value.trim();
  if (!rawUrl) { showStatus("Paste the redirect URL first.", "error"); return; }

  let params;
  try { params = new URL(rawUrl).searchParams; }
  catch { showStatus("Invalid URL — paste the full address bar URL.", "error"); return; }

  const code  = params.get("code");
  const state = params.get("state");
  if (!code) { showStatus("No code found in URL.", "error"); return; }

  const stored = await chrome.storage.local.get(["authState", "authClientId", "authClientSecret"]);
  if (state !== stored.authState) {
    showStatus("State mismatch — tap Authorize again to start a fresh flow.", "error");
    return;
  }

  elSubmitUrl.disabled = true;
  showStatus("Exchanging code for token…", "info");
  await exchangeCode(code, stored.authClientId, stored.authClientSecret);
  elSubmitUrl.disabled = false;
});

async function exchangeCode(code, clientId, clientSecret) {
  const credentials = btoa(`${clientId}:${clientSecret}`);
  try {
    const resp = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      handleResult({ type: "TOKEN_ERROR", error: `HTTP ${resp.status}: ${text.slice(0, 120)}` });
      return;
    }
    const rawToken = await resp.json();
    const nowSec = Math.floor(Date.now() / 1000);
    rawToken.expires_at = nowSec + (rawToken.expires_in || 1800);
    const token = { creation_timestamp: nowSec, token: rawToken };
    handleResult({ type: "TOKEN_SUCCESS", tokenJson: JSON.stringify(token, null, 2) });
  } catch (err) {
    const msg = (err.name === "TypeError")
      ? "CORS blocked. See README.md for Cloudflare Worker proxy setup."
      : err.message;
    handleResult({ type: "TOKEN_ERROR", error: msg });
  }
}

// Listen for live message from background (popup was open during auth)
chrome.runtime.onMessage.addListener((msg) => handleResult(msg));

function handleResult(msg) {
  elAuthorize.disabled = false;
  if (msg.type === "TOKEN_SUCCESS") {
    showStatus("Token generated successfully.", "success");
    elTokenSection.style.display = "block";
    elTokenOutput.value = msg.tokenJson;
  } else if (msg.type === "TOKEN_ERROR") {
    showStatus("Error: " + msg.error, "error");
  }
}

// Copy button
elCopy.addEventListener("click", () => {
  navigator.clipboard.writeText(elTokenOutput.value).then(() => {
    elCopy.textContent = "Copied!";
    setTimeout(() => { elCopy.textContent = "Copy to Clipboard"; }, 2000);
  });
});

function showStatus(msg, type) {
  elStatus.textContent = msg;
  elStatus.className = type;
  elStatus.style.display = "block";
}
