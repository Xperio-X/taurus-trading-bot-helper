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

// Load saved credentials
chrome.storage.local.get(["clientId", "clientSecret"], (data) => {
  if (data.clientId)     elClientId.value     = data.clientId;
  if (data.clientSecret) elClientSecret.value = data.clientSecret;
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

  await chrome.storage.session.set({ state, clientId, clientSecret });

  const url = `${AUTH_URL}?client_id=${encodeURIComponent(clientId)}`
    + `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`
    + `&response_type=code`
    + `&state=${state}`;

  // Open auth tab and store its ID
  const tab = await chrome.tabs.create({ url });
  await chrome.storage.session.set({ authTabId: tab.id });

  elAuthorize.disabled = true;
  showStatus("Schwab login page opened — complete login, MFA, and Authorize.", "info");
});

// Listen for token result from background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "TOKEN_SUCCESS") {
    elAuthorize.disabled = false;
    showStatus("Token generated successfully.", "success");
    elTokenSection.style.display = "block";
    elTokenOutput.value = msg.tokenJson;
  } else if (msg.type === "TOKEN_ERROR") {
    elAuthorize.disabled = false;
    showStatus("Error: " + msg.error, "error");
  }
});

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
