# AccessFill Website

A dignity-first accessibility tool for navigating government, banking, and healthcare forms.

## Local Development

This is a **static site** — no build step or dependencies required. All pages are plain HTML, CSS, and JavaScript.

### Run with Python (recommended)

```bash
cd accessfill-website
python3 -m http.server 8765
```

Then open **http://localhost:8765/** in your browser.

> Any port works — `8765` is just a suggestion. Python 3 is included with macOS and most Linux distros by default.

### Alternative: Run with Node.js

```bash
cd accessfill-website
npx serve .
# or: npx http-server -p 8765
```

Then open the URL it prints (typically **http://localhost:3000/** or **http://localhost:8765/**).

### Alternative: Just open the files directly

You can also double-click `login.html` to open it in a browser. A local server is recommended because `localStorage` guards and redirects work most reliably over `http://localhost`, but the site should mostly function via `file://` too.

## Project Structure (flat, all side-by-side)

```
accessfill-website/
├── index.html                     # Root → auto-redirects: logged-in users → dashboard, guests → login
├── login.html                     # Sign-in screen (try "Quick demo — no password" for instant access)
├── dashboard.html                 # Main dashboard after login
├── onboarding.html                # First-time setup: pick accessibility profiles
├── settings.html                  # Accessibility preferences (font, contrast, language, toggles)
├── voice-guidance.html            # Voice-guided form-filling flow with consent confirmation
├── dashboard-simplified.html      # Shortcut: enables simplified UI then redirects to dashboard.html
├── dashboard-high-contrast.html   # Shortcut: enables extra-high contrast then redirects to dashboard.html
├── shared.css                     # Design tokens, motion guards, global chrome — imported by every page
├── shared.js                      # Session, auth guards, preferences, nav header/footer renderer
└── README.md                      # This file
```

## Quick End-to-End Test Flow

1. Start the server: `python3 -m http.server 8765` from inside `accessfill-website/`
2. Visit **http://localhost:8765/** → redirects to `login.html`
3. Click **"Quick demo — no password"**
4. On `onboarding.html`, click **"Skip for now"** (or pick profiles + Continue)
5. On `dashboard.html`:
   - Click **Settings** in the nav bar → opens `settings.html`
   - Click **Voice Fill** in the nav bar → opens `voice-guidance.html`
   - Click the **Dashboard** link to come back
   - Click the red **logout** button (top right) → returns to `login.html` and clears session state
6. On `login.html` again — confirm you're logged out
