/* ================================================================
   AccessFill — shared.js
   Frontend-only state, persistence, navigation, and page guards.
   Keys (all localStorage):
     af_session         → { name, email, firstLogin:bool }  or null if logged out
     af_onboarded       → 'true' if user completed onboarding
     af_profiles        → array of selected accessibility profile slugs (from onboarding cards)
     af_prefs_fontSize  → small | medium | large | xlarge
     af_prefs_contrast  → normal | high | extra-high
     af_prefs_language  → en | hi | kn
     af_prefs_voice     → 'on' | 'off'
     af_animations      → 'on' | 'off'        (Animations toggle)
     af_simplified      → 'on' | 'off'        (Simplified UI toggle)
================================================================= */

(function () {
  'use strict';

  const PAGES = {
    root:        'index.html',
    login:       'login.html',
    onboarding:  'onboarding.html',
    dashboard:   'dashboard.html',
    settings:    'settings.html',
    voiceFlow:   'voice-guidance.html',
  };

  // Resolve a page key to a URL relative to the flat folder (all files live side-by-side).
  function url(pageKey) {
    const base = document.currentScript && document.currentScript.src
      ? new URL('.', new URL(document.currentScript.src)).pathname
      : (function () {
          const p = location.pathname;
          const lastSlash = p.lastIndexOf('/');
          return lastSlash >= 0 ? p.slice(0, lastSlash + 1) : '/';
        })();
    return base + (PAGES[pageKey] || pageKey);
  }

  function read(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : v;
    } catch (_) { return fallback; }
  }
  function write(key, val) {
    try { localStorage.setItem(key, val); } catch (_) {}
  }
  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) { return fallback; }
  }
  function writeJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) {}
  }

  /* ---------- Auth ---------- */
  function getSession()      { return readJSON('af_session', null); }
  function isLoggedIn()      { return !!getSession(); }
  function isOnboarded()     { return read('af_onboarded', 'false') === 'true'; }
  function login({ name, email }) {
    const existing = getSession();
    const firstLogin = !existing;
    writeJSON('af_session', { name: name || 'Friend', email: email || '', firstLogin });
    // First-time loginers go to onboarding; returning users skip to dashboard.
    return firstLogin ? PAGES.onboarding : PAGES.dashboard;
  }
  function logout() {
    try {
      localStorage.removeItem('af_session');
      // Keep preferences (font/contrast/language) — only drop session + onboarding flag
      // so the user can pick back up if they log in again. But clear profiles
      // so onboarding re-prompts cleanly on a fresh login.
      localStorage.removeItem('af_profiles');
      localStorage.removeItem('af_onboarded');
    } catch (_) {}
    return PAGES.login;
  }
  function completeOnboarding(selectedProfiles) {
    if (Array.isArray(selectedProfiles)) writeJSON('af_profiles', selectedProfiles);
    write('af_onboarded', 'true');
    return PAGES.dashboard;
  }

  /* ---------- Preferences (applied on every page load) ---------- */
  function applyPreferences() {
    // Animations
    const userAnim = read('af_animations', null); // null = not explicitly set by user yet
    const osReduces = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const animOff = (userAnim === 'off') || (userAnim == null && osReduces);
    document.body.classList.toggle('no-anim', animOff);
    document.documentElement.setAttribute('data-animations', animOff ? 'off' : 'on');

    // Font size → scale the html font-size rem base, plus tag body
    const fs = read('af_prefs_fontSize', 'medium');
    const remBySize = { small: '16px', medium: '18px', large: '21px', xlarge: '24px' };
    document.documentElement.style.fontSize = remBySize[fs] || remBySize.medium;
    document.documentElement.setAttribute('data-font-size', fs);

    // Contrast
    const c = read('af_prefs_contrast', 'normal');
    document.documentElement.setAttribute('data-contrast', c);

    // Language (store only — real i18n needs backend; useful for downstream)
    document.documentElement.setAttribute('lang', read('af_prefs_language', 'en'));

    // Simplified UI
    const simp = read('af_simplified', 'off');
    document.documentElement.setAttribute('data-simplified-ui', simp);

    // Voice flag (stored, for downstream consumers)
    document.documentElement.setAttribute('data-voice-guidance', read('af_prefs_voice', 'off'));
  }

  /* ---------- Guard: pages that need auth call guardAuth(<currentPageKey>) ---------- */
  const PUBLIC_PAGES = new Set(['login', 'root']);
  function guardAuth(currentPageKey) {
    if (PUBLIC_PAGES.has(currentPageKey)) return;
    if (!isLoggedIn()) {
      location.replace(url('login') + '?next=' + encodeURIComponent(currentPageKey));
      return true;
    }
    // Onboarding guard: logged-in but not onboarded → route to onboarding once.
    if (currentPageKey !== 'onboarding' && !isOnboarded()) {
      location.replace(url('onboarding'));
      return true;
    }
    // If onboarded user somehow landed on onboarding again → skip to dashboard.
    if (currentPageKey === 'onboarding' && isOnboarded()) {
      location.replace(url('dashboard'));
      return true;
    }
    return false;
  }

  /* ---------- Consent/sensitive confirmation flag (used by voice flow tooltip) ---------- */
  function markConsentSeen(fieldId) {
    const key = 'af_consent_' + (fieldId || 'global');
    const n = Number(read(key, '0')) + 1;
    write(key, String(n));
    return n;
  }

  /* ---------- Helpers used by Settings + Onboarding submit handlers ---------- */
  function savePrefs(patch) {
    if ('fontSize'  in patch) write('af_prefs_fontSize', patch.fontSize);
    if ('contrast'  in patch) write('af_prefs_contrast', patch.contrast);
    if ('language'  in patch) write('af_prefs_language', patch.language);
    if ('voice'     in patch) write('af_prefs_voice',    patch.voice ? 'on' : 'off');
    if ('animations'in patch) write('af_animations',     patch.animations ? 'on' : 'off');
    if ('simplified'in patch) write('af_simplified',     patch.simplified ? 'on' : 'off');
    applyPreferences();
  }

  function readPrefs() {
    return {
      fontSize:   read('af_prefs_fontSize', 'medium'),
      contrast:   read('af_prefs_contrast', 'normal'),
      language:   read('af_prefs_language', 'en'),
      voice:      read('af_prefs_voice', 'off') === 'on',
      animations: read('af_animations', null) === null
                    ? !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
                    : read('af_animations', 'on') === 'on',
      simplified: read('af_simplified', 'off') === 'on',
    };
  }

  /* ---------- Read a URL query param ---------- */
  function qs(name, fallback) {
    try {
      const u = new URL(location.href);
      const v = u.searchParams.get(name);
      return v == null ? fallback : v;
    } catch (_) { return fallback; }
  }

  /* ---------- Nav header/footer renderer.
     A page drops <div id="af-header" data-page="dashboard"></div> and this fills it.
     Keeps every page's top nav identical without duplicating markup.
  ------------------------------------------------------------------ */
  function renderHeader(pageKey) {
    const el = document.getElementById('af-header');
    if (!el) return;
    const session = getSession() || { name: 'Guest' };
    const pageClass = (k) => pageKey === k
      ? 'min-h-touch-target min-w-[120px] flex items-center justify-center px-6 rounded-xl text-primary font-bold bg-primary-container'
      : 'text-label-md font-label-md text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors min-h-touch-target min-w-[120px] flex items-center justify-center px-6 rounded-xl';

    el.outerHTML = `
<header class="fixed top-0 w-full z-50 bg-surface-low/95 backdrop-blur-sm border-b-2 border-border-soft">
  <div class="h-20 max-w-max-width mx-auto px-gutter flex items-center justify-between">
    <div class="flex items-center gap-4">
      <a href="${url('dashboard')}" class="flex items-center gap-4 no-underline">
        <div class="w-10 h-10 rounded-xl bg-primary-container flex items-center justify-center">
          <span class="material-symbols-outlined text-on-primary-container text-[24px]" style="font-variation-settings: 'FILL' 1;">featured_seasonal_and_gifts</span>
        </div>
        <span class="font-headline-md text-headline-md text-on-surface">AccessFill</span>
      </a>
    </div>
    <nav class="hidden md:flex items-center gap-4">
      <a class="${pageClass('dashboard')}"  href="${url('dashboard')}">Dashboard</a>
      <a class="${pageClass('voiceFlow')}" href="${url('voiceFlow')}">Voice Fill</a>
      <a class="${pageClass('settings')}"   href="${url('settings')}">Settings</a>
    </nav>
    <div class="flex items-center gap-3">
      <div class="hidden sm:flex flex-col items-end leading-tight mr-2 simplified-hide">
        <span class="font-label-md text-label-md text-on-surface">${escapeHtml(session.name)}</span>
        <span class="text-[14px] text-on-surface-variant">Signed in</span>
      </div>
      <div class="w-11 h-11 rounded-full border-2 border-outline-variant bg-surface-container flex items-center justify-center" aria-label="Profile">
        <span class="material-symbols-outlined text-on-surface-variant text-[24px]">person</span>
      </div>
      <button id="af-logout-btn"
        class="min-w-touch-target min-h-touch-target flex items-center justify-center rounded-xl transition-colors border-2 border-destructive/60 text-destructive hover:bg-destructive hover:text-on-destructive focus:shadow-focus-ring focus:outline-none"
        aria-label="Sign out" title="Sign out (this is the destructive action color)">
        <span class="material-symbols-outlined text-[24px]">logout</span>
      </button>
    </div>
  </div>
</header>`;

    document.getElementById('af-logout-btn').addEventListener('click', () => {
      const next = logout();
      location.replace(url(next));
    });
  }

  function renderFooter() {
    const el = document.getElementById('af-footer');
    if (!el) return;
    el.outerHTML = `
<footer class="w-full bg-surface-low border-t-2 border-border-soft py-margin-desktop mt-auto">
  <div class="max-w-max-width mx-auto px-gutter flex flex-col md:flex-row justify-between items-center gap-stack-gap text-on-surface-variant text-label-md">
    <div class="flex items-center gap-3">
      <div class="w-7 h-7 rounded-lg bg-primary-container flex items-center justify-center">
        <span class="material-symbols-outlined text-on-primary-container text-[16px]" style="font-variation-settings: 'FILL' 1;">featured_seasonal_and_gifts</span>
      </div>
      <span>© 2024 AccessFill. Built for everyone.</span>
    </div>
    <div class="flex gap-10">
      <a class="hover:text-primary transition-colors underline-offset-4 hover:underline" href="#">Privacy</a>
      <a class="hover:text-primary transition-colors underline-offset-4 hover:underline" href="#">Terms</a>
    </div>
  </div>
</footer>`;
  }

  /* ---------- tiny string escape for innerHTML user strings ---------- */
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ---------- Wire OS-level reduce-motion live changes into body.no-anim ---------- */
  function wireMotionMQ() {
    if (!window.matchMedia) return;
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => applyPreferences();
    if (mql.addEventListener) mql.addEventListener('change', onChange);
    else if (mql.addListener) mql.addListener(onChange);
  }

  /* ---------- Public API: window.AF ---------- */
  window.AF = {
    PAGES, url,
    // auth
    getSession, isLoggedIn, isOnboarded, login, logout, completeOnboarding,
    // prefs
    applyPreferences, savePrefs, readPrefs,
    // guards / rendering
    guardAuth, renderHeader, renderFooter,
    // misc
    markConsentSeen, qs, escapeHtml,
    wireMotionMQ,
  };
})();

/* Auto-apply preferences as soon as this script loads (before DOMContentLoaded is fine;
   body may not exist yet for no-anim toggling, so we also re-apply at DOMContentLoaded). */
(function autoApply() {
  function run() {
    window.AF.applyPreferences();
    window.AF.wireMotionMQ();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
