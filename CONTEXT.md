# Taurus Trading Bot Helper — Full Context

Read this file at the start of any session working on this extension. It covers all decisions, fixes, current state, and pending work.

---

## What This Is

A Chrome Manifest V3 browser extension that handles Schwab OAuth token renewal for the Taurus Trading Bot. The bot runs on Claude Code Cloud routines and needs a fresh Schwab `refresh_token` every 7 days (Schwab's hard limit). The extension handles the full OAuth flow and outputs token JSON ready to paste into the cloud environment.

**Repo:** https://github.com/Xperio-X/taurus-trading-bot-helper  
**Local path:** `D:\Claude Code\taurus-trading-bot-helper`  
**Main Trading Bot repo:** `C:\Trading Bot`

---

## Architecture

### Files

| File | Purpose |
|------|---------|
| `manifest.json` | MV3 config — permissions, service worker, popup |
| `popup.html` | Dark UI — credentials form, Authorize button, manual URL paste, token output |
| `popup.js` | Credential storage, auth flow initiation, manual URL exchange, token display |
| `background.js` | Service worker — intercepts redirect via webNavigation, exchanges code for token |
| `icon*.png` | Extension icons (16, 48, 128) |
| `README.md` | Install + usage instructions, CORS fallback |

### OAuth Flow

Schwab uses three-legged OAuth:

1. Extension builds auth URL: `https://api.schwabapi.com/v1/oauth/authorize?client_id=...&redirect_uri=https://127.0.0.1:8182&response_type=code&state=<random>`
2. User completes Schwab login + MFA + clicks Authorize in opened tab
3. Schwab redirects to `https://127.0.0.1:8182?code=XXX&state=YYY`
4. Extension captures code, POSTs to `https://api.schwabapi.com/v1/oauth/token` with Basic auth
5. Raw token wrapped in schwab-py format and displayed for copy

### Token Format

schwab-py's `client_from_token_file()` requires this exact nested structure:

```json
{
  "creation_timestamp": 1748000000,
  "token": {
    "expires_in": 1800,
    "token_type": "Bearer",
    "scope": "...",
    "refresh_token": "...",
    "access_token": "...",
    "id_token": "...",
    "expires_at": 1748001800
  }
}
```

- Raw Schwab API returns only `expires_in`, not `expires_at` — extension adds it: `nowSec + expires_in`
- The outer `creation_timestamp` wrapper is required — raw flat JSON will fail `client_from_token_file()`
- access_token TTL: 30 min (auto-refreshed by schwab-py)
- refresh_token TTL: **7 days** — this is why weekly renewal is required
- Generating a new token **invalidates the previous one immediately**

---

## Storage Design

### Why `chrome.storage.local` (not `session`) for auth state

`chrome.storage.session` is not reliably accessible across contexts in mobile browsers (Lemur, Kiwi). All auth state uses `chrome.storage.local`:

| Key | Value | Cleaned up |
|-----|-------|-----------|
| `clientId` | Saved credential | Never (persists for convenience) |
| `clientSecret` | Saved credential | Never |
| `authState` | Random hex state for CSRF check | On success or new auth |
| `authClientId` | Client ID for current auth flow | On success |
| `authClientSecret` | Client secret for current auth flow | On success |
| `authTabId` | Tab ID of opened Schwab auth tab | After redirect captured |
| `pendingResult` | TOKEN_SUCCESS or TOKEN_ERROR from background | After popup reads it |

### Why two code paths for token exchange

**Background.js (desktop Chrome):** `webNavigation.onBeforeNavigate` fires before the page loads, reliably capturing the `127.0.0.1:8182?code=...` redirect even when connection is refused. Works on desktop Chrome. Unreliable on mobile.

**Popup.js manual fallback (mobile):** On mobile browsers (Lemur, Kiwi), `webNavigation` doesn't fire reliably. User copies the redirect URL from the address bar and pastes it into the popup. `popup.js` does the token exchange directly using `fetch()`.

---

## Mobile Browser Support

### Tested and Working: Lemur Browser (Android)
- Play Store: search "Lemur Browser"
- `chrome://extensions` → Developer mode → Load from ZIP
- Uses the manual URL paste flow (see below)

### Kiwi Browser — Abandoned
- Kiwi Browser v94 (latest available on the test device) does not show the Developer mode toggle
- Updating via Play Store didn't resolve it
- **Use Lemur Browser instead**

---

## Weekly Usage Flow (Every Sunday)

### Desktop Chrome
1. Tap extension icon → enter credentials (saved after first entry) → **Authorize with Schwab**
2. Complete Schwab login + MFA + Authorize in opened tab
3. Tab closes automatically → token JSON appears in popup
4. **Copy to Clipboard**
5. Claude Cloud → "Trading Bot" environment → update `SCHWAB_TOKEN_JSON` → Save

### Mobile (Lemur Browser on Android)
1. Tap extension icon → enter credentials → **Authorize with Schwab**
2. Complete Schwab login + MFA + Authorize in opened tab
3. Schwab redirects to `127.0.0.1` error page — **copy the full URL from the address bar**
4. Tap extension icon again (popup reopens showing paste field automatically)
5. Paste URL into textarea → **Get Token from URL**
6. Token appears → **Copy to Clipboard**
7. Claude Cloud → "Trading Bot" environment → update `SCHWAB_TOKEN_JSON` → Save

**Note:** All 6 Claude Cloud routines share one environment named "Trading Bot". One update covers everything.

---

## Cloud Environment

All cloud routines share the **"Trading Bot"** environment in Claude Cloud. Env vars set there:

- `SCHWAB_CLIENT_ID` — static, from Schwab developer portal
- `SCHWAB_CLIENT_SECRET` — static, from Schwab developer portal
- `SCHWAB_TOKEN_JSON` — **updated weekly**
- `ALPACA_API_KEY`, `ALPACA_SECRET_KEY`, `ALPACA_ENDPOINT`, `ALPACA_DATA_ENDPOINT`
- `RESEND_API_KEY`, `EMAIL_TO`

**Schwab app settings (developer.schwab.com):**
- API product: Accounts and Trading Production
- Callback URL: `https://127.0.0.1:8182`

---

## Key Bugs Fixed (History)

### 1. No token after desktop auth
**Symptom:** Auth completed but popup was empty.  
**Cause:** Popup closed when user switched to Schwab tab; background message was lost.  
**Fix:** `storeAndNotify()` writes result to `chrome.storage.local` before sending runtime message. Popup reads `pendingResult` on open.

### 2. `tabs.onUpdated` missing redirect on 127.0.0.1
**Symptom:** Redirect fired `onUpdated` but code was never extracted.  
**Cause:** `127.0.0.1:8182` gets connection refused before `tabs.onUpdated` fires with the URL.  
**Fix:** Switched to `chrome.webNavigation.onBeforeNavigate` which fires *before* the page load attempt. Added `webNavigation` permission to manifest.

### 3. Token missing `expires_at`
**Symptom:** `client_from_token_file()` failed — key not found.  
**Cause:** Raw Schwab API returns `expires_in` only; schwab-py expects `expires_at` (Unix timestamp).  
**Fix:** `rawToken.expires_at = Math.floor(Date.now() / 1000) + (rawToken.expires_in || 1800)`

### 4. Wrong token format (flat vs nested)
**Symptom:** schwab-py `client_from_token_file()` rejected token.  
**Cause:** Extension produced flat JSON; schwab-py expects `{creation_timestamp, token: {...}}`.  
**Fix:** `const token = { creation_timestamp: nowSec, token: rawToken }`

### 5. `chrome.storage.session` unreliable on mobile
**Symptom:** Background couldn't read auth state; token exchange failed silently.  
**Cause:** `chrome.storage.session` not reliably accessible across popup/service-worker contexts in mobile Chromium builds.  
**Fix:** Switched all auth state to `chrome.storage.local` with explicit key names (`authState`, `authClientId`, `authClientSecret`, `authTabId`).

### 6. Manual paste section not visible when popup reopens on mobile
**Symptom:** User copied redirect URL but paste field wasn't visible after reopening popup.  
**Cause:** Manual section only shown after clicking Authorize; popup closes when switching tabs.  
**Fix:** On popup open, check if `authState` exists in local storage → if yes, show manual section immediately with "Auth in progress" message.

---

## CORS Fallback

No CORS error has been observed in testing — Schwab's token endpoint currently allows direct fetch from the extension. If CORS appears in future:

Deploy a Cloudflare Worker proxy (instructions in `README.md`) and change `TOKEN_URL` in `background.js`:
```javascript
const TOKEN_URL = "https://schwab-proxy.yourname.workers.dev";
```

---

## Pending / Future Work

- **Nothing blocking** — extension is fully functional on desktop Chrome and Lemur Browser (Android)
- **Kiwi Browser** — abandoned; Lemur is the mobile solution
- If Schwab ever changes the callback URL whitelist format, update the registered URL in the Schwab developer portal and `REDIRECT_URI` in both `background.js` and `popup.js`
- If schwab-py changes its token format, update the wrapping logic in both `background.js` and `popup.js`'s `exchangeCode()` function

---

## Commit History (key milestones)

| Commit | Summary |
|--------|---------|
| Initial | Basic extension with tabs.onUpdated |
| Fix redirect | Switch to webNavigation.onBeforeNavigate |
| Fix token format | Add expires_at + creation_timestamp wrapper |
| Mobile fallback | Manual URL paste + session→local storage migration |
| Mobile UX fix | Show paste section on popup reopen if auth in progress |
