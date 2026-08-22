/* ================================================================
   AccessFill — shared.js
   Navigation, page guards, preferences, and chrome.
   Auth is owned by supabase-web.js (AccessFillSupabase):
     real session → localStorage/sessionStorage keys af_supabase_session
     demo mode   → af_is_demo_mode + mock token (never a live JWT)
   Accessibility prefs remain in localStorage (af_prefs_*, etc.).
================================================================= */

(function () {
  'use strict';

  const PAGES = {
    root:        'index.html',
    login:       'login.html',
    onboarding:  'onboarding.html',
    dashboard:   'dashboard.html',
    settings:    'settings.html',
    savedInfo:   'saved-info.html',
    uploadDocs:  'upload-documents.html',
    voiceFlow:   'voice-guidance.html',
    voiceFill:   'voice-fill.html',
  };

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

  function sb() {
    return window.AccessFillSupabase || null;
  }

  function currentUserId() {
    const client = sb();
    if (client && client.session && client.session.user && client.session.user.id) {
      return client.session.user.id;
    }
    return 'anon';
  }

  function onboardKey() {
    return 'af_onboarded_' + currentUserId();
  }

  /* ---------- Auth (backed by AccessFillSupabase after init) ---------- */
  function getSession() {
    const client = sb();
    if (!client || !client.session) return null;
    const profile = client.profile || {};
    const user = client.session.user || {};
    const meta = user.user_metadata || {};
    return {
      name: profile.full_name || meta.full_name || user.email || 'Friend',
      email: profile.email || user.email || '',
      user: user,
      profile: profile,
      isDemoMode: !!client.isDemoMode,
    };
  }

  function isLoggedIn() {
    const client = sb();
    return !!(client && client.session && client.session.access_token);
  }

  function isDemoMode() {
    const client = sb();
    return !!(client && client.isDemoMode);
  }

  function isOnboarded() {
    return read(onboardKey(), 'false') === 'true';
  }

  function afterAuth(result, { isNewUser } = {}) {
    if (!result || !result.success || result.needsConfirmation) return null;
    if (isNewUser || result.isNewUser || !isOnboarded()) return PAGES.onboarding;
    return PAGES.dashboard;
  }

  async function login({ name, email, password, remember, mode }) {
    const client = sb();
    if (!client) return { success: false, error: 'Auth client not loaded.' };

    if (mode === 'demo') {
      const result = await client.signInDemo();
      return Object.assign({ next: afterAuth(result, { isNewUser: !isOnboarded() }) }, result);
    }

    if (mode === 'signup') {
      const result = await client.signUp(email, password, name || '', { remember: remember !== false });
      return Object.assign({ next: afterAuth(result, { isNewUser: true }) }, result);
    }

    const result = await client.signInWithPassword(email, password, { remember: remember !== false });
    return Object.assign({ next: afterAuth(result) }, result);
  }

  async function logout() {
    const client = sb();
    if (client) await client.signOut();
    try {
      localStorage.removeItem('af_session');
      localStorage.removeItem('af_profiles');
    } catch (_) {}
    return PAGES.login;
  }

  function completeOnboarding(selectedProfiles) {
    if (Array.isArray(selectedProfiles)) writeJSON('af_profiles', selectedProfiles);
    write(onboardKey(), 'true');
    write('af_onboarded', 'true');
    return PAGES.dashboard;
  }

  async function ensureAuthInit() {
    const client = sb();
    if (client) await client.init();
  }

  /* ---------- Preferences (applied on every page load) ---------- */
  function applyPreferences() {
    const userAnim = read('af_animations', null);
    const osReduces = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const animOff = (userAnim === 'off') || (userAnim == null && osReduces);
    if (document.body) document.body.classList.toggle('no-anim', animOff);
    document.documentElement.setAttribute('data-animations', animOff ? 'off' : 'on');

    const fs = read('af_prefs_fontSize', 'medium');
    const remBySize = { small: '16px', medium: '18px', large: '21px', xlarge: '24px' };
    document.documentElement.style.fontSize = remBySize[fs] || remBySize.medium;
    document.documentElement.setAttribute('data-font-size', fs);

    const c = read('af_prefs_contrast', 'normal');
    document.documentElement.setAttribute('data-contrast', c);

    const rawLang = read('af_prefs_language', 'en');
    document.documentElement.setAttribute('lang', rawLang === 'kn' ? 'kn' : 'en');

    const simp = read('af_simplified', 'off');
    document.documentElement.setAttribute('data-simplified-ui', simp);

    document.documentElement.setAttribute('data-voice-guidance', read('af_prefs_voice', 'off'));
    document.documentElement.setAttribute('data-demo-mode', isDemoMode() ? 'true' : 'false');
  }

  /* ---------- Guard: pages that need auth call await guardAuth(<currentPageKey>) ---------- */
  const PUBLIC_PAGES = new Set(['login', 'root']);
  async function guardAuth(currentPageKey) {
    await ensureAuthInit();
    applyPreferences();

    if (PUBLIC_PAGES.has(currentPageKey)) {
      if (currentPageKey === 'login' && isLoggedIn()) {
        location.replace(url(isOnboarded() ? 'dashboard' : 'onboarding'));
        return true;
      }
      return false;
    }

    if (!isLoggedIn()) {
      location.replace(url('login') + '?next=' + encodeURIComponent(currentPageKey));
      return true;
    }
    if (currentPageKey !== 'onboarding' && !isOnboarded()) {
      location.replace(url('onboarding'));
      return true;
    }
    if (currentPageKey === 'onboarding' && isOnboarded()) {
      location.replace(url('dashboard'));
      return true;
    }
    return false;
  }

  function markConsentSeen(fieldId) {
    const key = 'af_consent_' + (fieldId || 'global');
    const n = Number(read(key, '0')) + 1;
    write(key, String(n));
    return n;
  }

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
    const rawLang = read('af_prefs_language', 'en');
    return {
      fontSize:   read('af_prefs_fontSize', 'medium'),
      contrast:   read('af_prefs_contrast', 'normal'),
      language:   rawLang === 'kn' ? 'kn' : 'en',
      voice:      read('af_prefs_voice', 'off') === 'on',
      animations: read('af_animations', null) === null
                    ? !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
                    : read('af_animations', 'on') === 'on',
      simplified: read('af_simplified', 'off') === 'on',
    };
  }

  function qs(name, fallback) {
    try {
      const u = new URL(location.href);
      const v = u.searchParams.get(name);
      return v == null ? fallback : v;
    } catch (_) { return fallback; }
  }

  function renderHeader(pageKey) {
    const el = document.getElementById('af-header');
    if (!el) return;
    const session = getSession() || { name: 'Guest', isDemoMode: false };
    const displayName = (sb() && sb().getDisplayName && sb().getDisplayName()) || session.name || 'Guest';
    const demo = isDemoMode();
    const pageClass = (k) => pageKey === k
      ? 'min-h-touch-target min-w-[96px] flex items-center justify-center px-4 rounded-xl text-primary font-bold bg-primary-container'
      : 'text-label-md font-label-md text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors min-h-touch-target min-w-[96px] flex items-center justify-center px-4 rounded-xl';

    const demoBadge = demo
      ? `<span class="af-demo-badge inline-flex items-center gap-1.5 rounded-full border-2 border-on-info-container/20 bg-info-container px-3 py-1 text-[12px] font-bold tracking-wide text-on-info-container uppercase">Demo mode</span>`
      : '';

    const signedInLabel = demo ? 'Mock profile' : 'Signed in';

    el.outerHTML = `
<header class="fixed top-0 w-full z-50 bg-surface-low/95 backdrop-blur-sm border-b-2 border-border-soft">
  ${demo ? `<div class="af-demo-banner w-full bg-info-container border-b-2 border-on-info-container/15 text-on-info-container text-center font-label-md text-[14px] py-2 px-4">Demo mode — this is mock data, not a real AccessFill account.</div>` : ''}
  <div class="h-20 max-w-max-width mx-auto px-gutter flex items-center justify-between">
    <div class="flex items-center gap-4">
      <a href="${url('dashboard')}" class="flex items-center gap-4 no-underline">
        <div class="w-10 h-10 rounded-xl bg-primary-container flex items-center justify-center">
          <span class="material-symbols-outlined text-on-primary-container text-[24px]" style="font-variation-settings: 'FILL' 1;">featured_seasonal_and_gifts</span>
        </div>
        <span class="font-headline-md text-headline-md text-on-surface">AccessFill</span>
      </a>
      ${demoBadge}
    </div>
    <nav class="hidden md:flex items-center gap-2">
      <a class="${pageClass('dashboard')}"  href="${url('dashboard')}">Dashboard</a>
      <a class="${pageClass('savedInfo')}" href="${url('savedInfo')}">Saved Info</a>
      <a class="${pageClass('uploadDocs')}" href="${url('uploadDocs')}">Upload</a>
      <a class="${pageClass('voiceFlow')}" href="${url('voiceFlow')}">Voice Fill</a>
      <a class="${pageClass('settings')}"   href="${url('settings')}">Settings</a>
    </nav>
    <div class="flex items-center gap-3">
      <div class="hidden sm:flex flex-col items-end leading-tight mr-2 simplified-hide">
        <span class="font-label-md text-label-md text-on-surface">${escapeHtml(displayName)}</span>
        <span class="text-[14px] text-on-surface-variant">${signedInLabel}</span>
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

    document.getElementById('af-logout-btn').addEventListener('click', async () => {
      const next = await logout();
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

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function wireMotionMQ() {
    if (!window.matchMedia) return;
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => applyPreferences();
    if (mql.addEventListener) mql.addEventListener('change', onChange);
    else if (mql.addListener) mql.addListener(onChange);
  }

  /* ================================================================
     Shared TTS utility — single implementation used by field-explain.js
     and chat-widget.js. Previously duplicated in both; now canonical here.

     AF.speakText(text, lang, opts?)
       text    — string to speak
       lang    — 'en' | 'kn'
       opts    — optional object:
           noteEl      HTMLElement | null  — shown/hidden with voice-missing warning
           onBusy      function(bool)      — called with true when TTS starts, false when done
           audioState  object              — { audio, audioUrl } refs managed by caller
                                             so each call-site has its own audio element
                                             (prevents field-explain and chat clobbering each other)

     Returns a Promise that resolves when playback has finished (or fallen
     back to browser speech and that utterance ended). Callers that need
     sequential behaviour (prompt, then listen) should await it.
  ================================================================ */

  // Shared voice-loading promise — avoids multiple concurrent voiceschanged waits
  let _voicesReady = false;
  function _ensureVoices() {
    return new Promise(function (resolve) {
      if (!window.speechSynthesis) { resolve([]); return; }
      const existing = speechSynthesis.getVoices();
      if (existing.length || _voicesReady) { _voicesReady = true; resolve(existing); return; }
      const done = function () {
        _voicesReady = true;
        speechSynthesis.removeEventListener('voiceschanged', done);
        resolve(speechSynthesis.getVoices());
      };
      speechSynthesis.addEventListener('voiceschanged', done);
      setTimeout(done, 600);  // fallback if event never fires
    });
  }

  function _findVoice(voices, lang) {
    const target = lang === 'kn' ? 'kn' : 'en';
    return (voices || []).find(function (v) {
      return String(v.lang || '').toLowerCase().indexOf(target) === 0;
    }) || null;
  }

  // Per-call-site audio state factory — callers pass in their own state
  // object so field-explain and chat-widget each control their own playback.
  function _makeTtsState() {
    return {
      audio: null,
      audioUrl: null,
      isPlaying: false,
      activeBtn: null,
      currentText: null,
      onStateChange: null, // function(isPlaying, activeBtn)
    };
  }

  function _notifyStateChange(state) {
    if (state && typeof state.onStateChange === 'function') {
      try { state.onStateChange(state.isPlaying, state.activeBtn); } catch (_) {}
    }
  }

  function _stopTtsState(state) {
    if (!state) return;
    const wasPlaying = state.isPlaying;
    const oldBtn = state.activeBtn;
    state.isPlaying = false;
    state.activeBtn = null;
    state.currentText = null;

    if (state.audio) {
      try {
        state.audio.pause();
        state.audio.currentTime = 0;
        state.audio.removeAttribute('src');
        state.audio.load();
      } catch (_) {}
    }
    if (state.audioUrl) {
      try { URL.revokeObjectURL(state.audioUrl); } catch (_) {}
      state.audioUrl = null;
    }
    if (window.speechSynthesis) {
      try { speechSynthesis.cancel(); } catch (_) {}
    }

    if (wasPlaying || oldBtn) {
      _notifyStateChange(state);
    }
  }

  function _b64ToBlob(b64, mime) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime || 'audio/wav' });
  }

  function _playBlobOnState(state, blob, opts) {
    _stopTtsState(state);
    const options = opts || {};
    state.activeBtn = options.btn || null;
    state.currentText = options.text || null;
    state.audioUrl = URL.createObjectURL(blob);
    if (!state.audio) state.audio = new Audio();

    return new Promise(function (resolve) {
      var settled = false;
      const finish = function () {
        if (settled) return;
        settled = true;
        if (state.isPlaying) {
          state.isPlaying = false;
          state.currentText = null;
          _notifyStateChange(state);
        }
        resolve();
      };

      state.audio.onplay = function () {
        state.isPlaying = true;
        _notifyStateChange(state);
      };
      state.audio.onended = finish;
      state.audio.onerror = finish;
      state.audio.onpause = function () {
        if (state.audio && !state.audio.ended) finish();
      };

      state.audio.src = state.audioUrl;
      const p = state.audio.play();
      if (p && typeof p.catch === 'function') p.catch(function () { finish(); });
    });
  }

  // Shared TTS cache — keyed 'lang::text', shared across call-sites because
  // the same text+lang will always produce the same audio
  const _ttsCache = Object.create(null);

  async function speakText(text, lang, opts) {
    const clipped = String(text || '').trim();
    if (!clipped) return;

    const options   = opts || {};
    const noteEl    = options.noteEl   || null;
    const onBusy    = options.onBusy   || null;
    const state     = options.audioState || _makeTtsState();
    const btn       = options.btn || null;

    // If audio is ALREADY playing on this state for the same button / text, toggle OFF (stop)
    if (state.isPlaying && (state.activeBtn === btn || state.currentText === clipped)) {
      _stopTtsState(state);
      return;
    }

    _stopTtsState(state);
    if (window.speechSynthesis) {
      try { speechSynthesis.cancel(); } catch (_) {}
    }

    const targetLang = lang === 'kn' ? 'kn' : 'en';
    const cacheKey = targetLang + '::' + clipped;
    const cached = _ttsCache[cacheKey];
    if (cached) {
      await _playBlobOnState(state, _b64ToBlob(cached.b64, cached.mime), { btn, text: clipped });
      return;
    }

    const clientSb = window.AccessFillSupabase;
    if (clientSb && typeof clientSb.invokeTextToSpeech === 'function') {
      if (onBusy) onBusy(true);
      try {
        const result = await clientSb.invokeTextToSpeech({ text: clipped, language: targetLang });
        if (result && result.success && result.audioBase64) {
          _ttsCache[cacheKey] = { b64: result.audioBase64, mime: result.mimeType || 'audio/wav' };
          if (onBusy) onBusy(false);
          await _playBlobOnState(state, _b64ToBlob(result.audioBase64, result.mimeType), { btn, text: clipped });
          return;
        }
        // TTS call succeeded but returned no audio (demo mode, rate limit, etc.)
        console.log('[AccessFill TTS] gemini unavailable, using browser voice', {
          error: result && result.error,
          demo:  result && result.demo,
        });
      } catch (err) {
        const logErr = clientSb.sanitizeLogPayload ? clientSb.sanitizeLogPayload(err) : { message: err && err.message };
        console.error('[AccessFill TTS] invokeTextToSpeech threw', logErr);
      }
      if (onBusy) onBusy(false);
    }

    // Browser speechSynthesis fallback — wait for voices to be ready first
    if (!window.speechSynthesis) {
      if (noteEl) {
        noteEl.hidden = false;
        noteEl.textContent = targetLang === 'kn'
          ? 'ಈ ಸಾಧನದಲ್ಲಿ ಕನ್ನಡ ಧ್ವನಿ ಲಭ್ಯವಿಲ್ಲ — ಪಠ್ಯ ಮಾತ್ರ ತೋರಿಸಲಾಗುತ್ತಿದೆ'
          : 'Voice not available on this device — showing text only';
      }
      return;
    }

    speechSynthesis.cancel();
    const voices = await _ensureVoices();
    const utt = new SpeechSynthesisUtterance(clipped);

    if (targetLang === 'kn') {
      const knVoice = _findVoice(voices, 'kn');
      if (!knVoice) {
        if (noteEl) {
          noteEl.hidden = false;
          noteEl.textContent = 'ಈ ಸಾಧನದಲ್ಲಿ ಕನ್ನಡ ಧ್ವನಿ ಲಭ್ಯವಿಲ್ಲ — ಪಠ್ಯ ಮಾತ್ರ ತೋರಿಸಲಾಗುತ್ತಿದೆ';
        }
        utt.lang = 'en-US';
        const enVoice = _findVoice(voices, 'en');
        if (enVoice) utt.voice = enVoice;
      } else {
        if (noteEl) noteEl.hidden = true;
        utt.lang = knVoice.lang || 'kn-IN';
        utt.voice = knVoice;
      }
    } else {
      if (noteEl) noteEl.hidden = true;
      utt.lang = 'en-US';
      const enVoice = _findVoice(voices, 'en');
      if (enVoice) utt.voice = enVoice;
    }

    return new Promise(function (resolve) {
      utt.onstart = function () {
        state.isPlaying = true;
        state.activeBtn = btn;
        state.currentText = clipped;
        _notifyStateChange(state);
      };
      utt.onend = function () {
        state.isPlaying = false;
        state.activeBtn = null;
        state.currentText = null;
        _notifyStateChange(state);
        resolve();
      };
      utt.onerror = function () {
        state.isPlaying = false;
        state.activeBtn = null;
        state.currentText = null;
        _notifyStateChange(state);
        resolve();
      };

      try {
        speechSynthesis.speak(utt);
      } catch (_) {
        state.isPlaying = false;
        state.activeBtn = null;
        state.currentText = null;
        _notifyStateChange(state);
        if (noteEl) {
          noteEl.hidden = false;
          noteEl.textContent = 'Voice not available on this device — showing text only';
        }
        resolve();
      }
    });
  }

  window.AF = {
    PAGES, url,
    getSession, isLoggedIn, isOnboarded, isDemoMode, login, logout, completeOnboarding,
    ensureAuthInit,
    applyPreferences, savePrefs, readPrefs,
    guardAuth, renderHeader, renderFooter,
    markConsentSeen, qs, escapeHtml,
    wireMotionMQ,
    // TTS — single shared implementation; field-explain.js and chat-widget.js both delegate here
    speakText,
    makeTtsState:  _makeTtsState,
    stopTtsState:  _stopTtsState,
    isTtsPlaying:  function (state) { return !!(state && state.isPlaying); },
  };
})();

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
