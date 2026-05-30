# Taurus Trading Bot Helper

Browser extension for renewing Schwab OAuth tokens on Android (Kiwi Browser) or desktop Chrome. Handles the full OAuth flow — generates the auth URL, opens it, intercepts the redirect automatically, exchanges the code for a token, and displays the JSON for copy-paste into cloud routines.

## Setup

### Prerequisites
- Your Schwab developer app credentials (Client ID + Client Secret) from [developer.schwab.com](https://developer.schwab.com)
- Callback URL `https://127.0.0.1:8182` registered in your Schwab app

### Install on Desktop Chrome (for testing)
1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select this folder
4. The Taurus icon appears in the toolbar

### Install on Android (Kiwi Browser)
1. Install [Kiwi Browser](https://play.google.com/store/apps/details?id=com.kiwibrowser.browser) from Play Store
2. Download this repo as a ZIP from GitHub (Code → Download ZIP)
3. Open Kiwi Browser → address bar → `kiwi://extensions`
4. Enable **Developer mode**
5. Tap **Load** (or **+ from .zip**) → select the downloaded ZIP
6. The Taurus icon appears in the toolbar

## Weekly Usage (every Sunday)

1. Tap the Taurus extension icon
2. Enter your **Client ID** and **Client Secret** (saved after first entry)
3. Tap **Authorize with Schwab**
4. Complete Schwab login + MFA + click Authorize in the opened tab
5. The tab closes automatically — token JSON appears in the popup
6. Tap **Copy to Clipboard**
7. Open your cloud routine platform → update `SCHWAB_TOKEN_JSON` in all 6 routines

## CORS Issue (if token exchange fails)

If you see *"CORS blocked by Schwab"*, Schwab's token endpoint is rejecting direct browser requests. Fix with a free Cloudflare Worker proxy:

### Deploy the proxy (~5 minutes)

1. Sign up at [cloudflare.com](https://cloudflare.com) (free)
2. Go to **Workers & Pages** → **Create** → **Create Worker**
3. Replace the default code with:

```javascript
export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST",
          "Access-Control-Allow-Headers": "Authorization, Content-Type",
        },
      });
    }
    const resp = await fetch("https://api.schwabapi.com/v1/oauth/token", {
      method: "POST",
      headers: {
        "Authorization": request.headers.get("Authorization"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: await request.text(),
    });
    const data = await resp.text();
    return new Response(data, {
      status: resp.status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  },
};
```

4. Deploy → copy your Worker URL (e.g. `https://schwab-proxy.yourname.workers.dev`)
5. Open `background.js` in this repo → change the `TOKEN_URL` constant:
```javascript
const TOKEN_URL = "https://schwab-proxy.yourname.workers.dev";
```
6. Reload the extension

## Files

| File | Purpose |
|------|---------|
| `manifest.json` | Chrome Manifest V3 config |
| `popup.html` | Extension UI |
| `popup.js` | Credential storage, auth URL generation, token display |
| `background.js` | Tab monitoring, redirect capture, token exchange |
| `icon*.png` | Extension icons |
