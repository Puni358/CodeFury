/**
 * AccessFill — browser Supabase client (website)
 *
 * Port of the Chrome extension supabaseClient.js:
 *   same project URL + anon key, same profiles / sensitive_ids RLS upserts,
 *   localStorage (or sessionStorage when "keep me signed in" is off)
 *   instead of chrome.storage.local.
 *
 * Demo mode uses a mock token that is NEVER sent to live APIs.
 */
(function (global) {
  'use strict';

  const SUPABASE_CONFIG = {
    url: "https://aviioibehxmkjwnoekjt.supabase.co",
    anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2aWlvaWJlaHhta2p3bm9la2p0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcyODM2MjYsImV4cCI6MjEwMjg1OTYyNn0.3jy4_F-Dk3PK8P-zKuysPq8CfzrKbARyP5Zufb02Twc"
  };

  const STORAGE_KEYS = {
    session: 'af_supabase_session',
    profile: 'af_user_profile',
    demo: 'af_is_demo_mode',
  };

  const isLiveConfigured = Boolean(
    SUPABASE_CONFIG.url &&
    SUPABASE_CONFIG.anonKey &&
    !SUPABASE_CONFIG.url.includes("xyzexample") &&
    !SUPABASE_CONFIG.anonKey.includes("...")
  );

  const SENSITIVE_LOG_KEYS = [
    'aadhaar_number', 'pan_number', 'phone', 'emergency_contact_phone',
    'full_name', 'date_of_birth', 'address', 'address_line1', 'address_line2',
    'email', 'storage_path'
  ];

  function sanitizeLogPayload(data) {
    if (data == null) return data;
    if (Array.isArray(data)) return data.map(sanitizeLogPayload);
    if (typeof data !== 'object') return data;
    if (data instanceof Error) {
      return { name: data.name, message: data.message };
    }
    const sanitized = {};
    for (const key of Object.keys(data)) {
      if (SENSITIVE_LOG_KEYS.includes(key) && data[key]) {
        sanitized[key] = '[REDACTED_PII]';
      } else if (data[key] && typeof data[key] === 'object') {
        sanitized[key] = sanitizeLogPayload(data[key]);
      } else {
        sanitized[key] = data[key];
      }
    }
    return sanitized;
  }

  function formatApiError(data, status) {
    if (!data || typeof data !== 'object') return 'HTTP ' + status;
    const parts = [data.message, data.error, data.hint, data.details, data.code, data.msg, data.error_description]
      .filter(Boolean);
    const text = parts.join(' — ');
    return text ? (status ? `HTTP ${status}: ${text}` : text) : ('HTTP ' + status);
  }

  const DEFAULT_MOCK_PROFILE = {
    user_id: "demo-user-123",
    full_name: "Aarav Sharma",
    email: "aarav.sharma.demo@accessfill.local",
    phone: "9876543210",
    date_of_birth: "1992-05-15",
    address_line1: "Flat 302, Green Avenue",
    address_line2: "MG Road, Indiranagar",
    city: "Bengaluru",
    state: "Karnataka",
    zip: "560001",
    preferred_language: "en",
    emergency_contact_name: "Priya Sharma",
    emergency_contact_phone: "9812345678",
    aadhaar_number: "5482-9102-4738",
    pan_number: "ABCDE1234F",
    isDemo: true
  };

  function readStore(store, key) {
    try {
      const raw = store.getItem(key);
      if (raw == null) return undefined;
      return JSON.parse(raw);
    } catch (_) {
      return undefined;
    }
  }

  function writeStore(store, key, value) {
    try {
      store.setItem(key, JSON.stringify(value));
    } catch (_) {}
  }

  function removeStore(store, key) {
    try { store.removeItem(key); } catch (_) {}
  }

  function loadPersistedAuth() {
    const from = (store) => ({
      supabaseSession: readStore(store, STORAGE_KEYS.session),
      userProfile: readStore(store, STORAGE_KEYS.profile),
      isDemoMode: !!readStore(store, STORAGE_KEYS.demo),
      remember: store === localStorage,
    });
    try {
      const ephemeral = from(sessionStorage);
      if (ephemeral.supabaseSession) return ephemeral;
    } catch (_) {}
    try {
      return from(localStorage);
    } catch (_) {
      return { supabaseSession: undefined, userProfile: undefined, isDemoMode: false, remember: true };
    }
  }

  function persistAuth({ session, profile, isDemoMode, remember }) {
    const primary = remember ? localStorage : sessionStorage;
    const other = remember ? sessionStorage : localStorage;
    writeStore(primary, STORAGE_KEYS.session, session);
    writeStore(primary, STORAGE_KEYS.profile, profile);
    writeStore(primary, STORAGE_KEYS.demo, !!isDemoMode);
    removeStore(other, STORAGE_KEYS.session);
    removeStore(other, STORAGE_KEYS.profile);
    removeStore(other, STORAGE_KEYS.demo);
    try { localStorage.removeItem('af_session'); } catch (_) {}
  }

  function clearPersistedAuth() {
    [localStorage, sessionStorage].forEach((store) => {
      try {
        removeStore(store, STORAGE_KEYS.session);
        removeStore(store, STORAGE_KEYS.profile);
        removeStore(store, STORAGE_KEYS.demo);
      } catch (_) {}
    });
    try { localStorage.removeItem('af_session'); } catch (_) {}
  }

  class SupabaseClientAdapter {
    constructor() {
      this.session = null;
      this.profile = null;
      this.isDemoMode = false;
      this.rememberMe = true;
      this._initPromise = null;
    }

    async init() {
      if (this._initPromise) return this._initPromise;
      this._initPromise = this._doInit();
      return this._initPromise;
    }

    async _doInit() {
      const stored = loadPersistedAuth();
      this.rememberMe = stored.remember !== false;

      if (stored.supabaseSession && stored.supabaseSession.access_token) {
        this.session = stored.supabaseSession;
        this.isDemoMode = !!stored.isDemoMode;

        if (!this.isDemoMode && isLiveConfigured) {
          try {
            this.profile = await this.fetchFullUserProfileRLS();
          } catch (_) {
            this.profile = stored.userProfile || null;
          }
        } else {
          this.profile = stored.userProfile || (this.isDemoMode ? DEFAULT_MOCK_PROFILE : null);
        }

        return { session: this.session, profile: this.profile, isDemoMode: this.isDemoMode };
      }

      return { session: null, profile: null, isDemoMode: false };
    }

    _persist() {
      persistAuth({
        session: this.session,
        profile: this.profile,
        isDemoMode: this.isDemoMode,
        remember: this.rememberMe,
      });
    }

    async signUp(email, password, fullName = '', options) {
      if (!email || !password) return { success: false, error: "Email and password are required." };
      if (password.length < 6) return { success: false, error: "Password must be at least 6 characters long." };
      this.rememberMe = !options || options.remember !== false;

      if (isLiveConfigured) {
        try {
          console.log("[AccessFill Supabase] POST /auth/v1/signup");
          const response = await fetch(`${SUPABASE_CONFIG.url}/auth/v1/signup`, {
            method: 'POST',
            headers: {
              'apikey': SUPABASE_CONFIG.anonKey,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, password, data: { full_name: fullName } })
          });

          const data = await response.json();
          if (!response.ok) {
            const errMsg = data.msg || data.message || data.error_description || `Supabase error (${response.status})`;
            return { success: false, error: errMsg };
          }

          if (data.access_token) {
            this.session = {
              access_token: data.access_token,
              refresh_token: data.refresh_token,
              expires_in: data.expires_in,
              user: data.user
            };
            this.isDemoMode = false;

            await this.saveFullUserProfileRLS({
              full_name: fullName || email.split('@')[0],
              email: email,
              preferred_language: 'en'
            });

            this.profile = await this.fetchFullUserProfileRLS();
            this._persist();
            return { success: true, session: this.session, profile: this.profile, isDemoMode: false, isNewUser: true };
          }

          if (data.id || data.user) {
            return { success: true, needsConfirmation: true, message: "Check your email for a confirmation link, then sign in." };
          }
        } catch (err) {
          return { success: false, error: err.message || "Network error connecting to Supabase." };
        }
      }

      return { success: false, error: "Supabase is not configured." };
    }

    async signInWithPassword(email, password, options) {
      if (!email || !password) return { success: false, error: "Email and password are required." };
      this.rememberMe = !options || options.remember !== false;

      if (isLiveConfigured) {
        try {
          console.log("[AccessFill Supabase] POST /auth/v1/token?grant_type=password");
          const response = await fetch(`${SUPABASE_CONFIG.url}/auth/v1/token?grant_type=password`, {
            method: 'POST',
            headers: {
              'apikey': SUPABASE_CONFIG.anonKey,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, password })
          });

          const data = await response.json();
          if (!response.ok) {
            const errMsg = data.error_description || data.msg || data.message || "Invalid login credentials";
            return { success: false, error: errMsg };
          }

          this.session = {
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            expires_in: data.expires_in,
            user: data.user
          };
          this.isDemoMode = false;
          this.profile = await this.fetchFullUserProfileRLS();
          this._persist();
          return { success: true, session: this.session, profile: this.profile, isDemoMode: false };
        } catch (err) {
          return { success: false, error: err.message || "Network error connecting to Supabase." };
        }
      }

      return { success: false, error: "Supabase is not configured." };
    }

    /**
     * Isolated mock session — no live JWT, never mixed with real auth storage after signOut.
     */
    async signInDemo() {
      const mockSession = {
        access_token: "mock-demo-token-" + Date.now(),
        user: { id: "demo-user-123", email: "aarav.sharma.demo@accessfill.local" }
      };

      this.session = mockSession;
      this.isDemoMode = true;
      this.rememberMe = true;
      this.profile = { ...DEFAULT_MOCK_PROFILE, isDemo: true };
      this._persist();
      return { success: true, session: this.session, profile: this.profile, isDemoMode: true };
    }

    async fetchProfileRLS() {
      if (this.isDemoMode || !isLiveConfigured || !this.session || !this.session.access_token) return null;
      if (String(this.session.access_token).indexOf('mock-') === 0) return null;

      try {
        const response = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/profiles?select=*`, {
          method: 'GET',
          headers: {
            'apikey': SUPABASE_CONFIG.anonKey,
            'Authorization': `Bearer ${this.session.access_token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          }
        });

        if (response.ok) {
          const rows = await response.json();
          if (Array.isArray(rows) && rows.length > 0) return rows[0];
        }
      } catch (err) {
        console.warn("[AccessFill Supabase] profiles table fetch error:", err.message);
      }
      return null;
    }

    async fetchSensitiveIdsRLS() {
      if (this.isDemoMode || !isLiveConfigured || !this.session || !this.session.access_token) return null;
      if (String(this.session.access_token).indexOf('mock-') === 0) return null;

      try {
        const response = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/sensitive_ids?select=*`, {
          method: 'GET',
          headers: {
            'apikey': SUPABASE_CONFIG.anonKey,
            'Authorization': `Bearer ${this.session.access_token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          }
        });

        if (response.ok) {
          const rows = await response.json();
          if (Array.isArray(rows) && rows.length > 0) return rows[0];
        }
      } catch (err) {
        console.warn("[AccessFill Supabase] sensitive_ids table fetch error:", err.message);
      }
      return null;
    }

    async fetchFullUserProfileRLS() {
      if (this.isDemoMode) return this.profile || DEFAULT_MOCK_PROFILE;

      const profileRow = await this.fetchProfileRLS() || {};
      const sensitiveRow = await this.fetchSensitiveIdsRLS() || {};

      const fullProfile = {
        user_id: this.session && this.session.user ? this.session.user.id : undefined,
        full_name: profileRow.full_name || (this.session && this.session.user && this.session.user.user_metadata && this.session.user.user_metadata.full_name) || '',
        email: profileRow.email || (this.session && this.session.user && this.session.user.email) || '',
        phone: profileRow.phone || '',
        date_of_birth: profileRow.date_of_birth || '',
        address_line1: profileRow.address_line1 || '',
        address_line2: profileRow.address_line2 || '',
        city: profileRow.city || '',
        state: profileRow.state || '',
        zip: profileRow.zip || '',
        preferred_language: profileRow.preferred_language || 'en',
        emergency_contact_name: profileRow.emergency_contact_name || '',
        emergency_contact_phone: profileRow.emergency_contact_phone || '',
        aadhaar_number: sensitiveRow.aadhaar_number || '',
        pan_number: sensitiveRow.pan_number || '',
        isDemo: false
      };

      this.profile = fullProfile;
      this._persist();
      return fullProfile;
    }

    async saveFullUserProfileRLS(formData) {
      if (this.isDemoMode || !isLiveConfigured || !this.session || !this.session.access_token ||
          String(this.session.access_token).indexOf('mock-') === 0) {
        this.profile = { ...this.profile, ...formData, isDemo: this.isDemoMode };
        this._persist();
        return { success: true, profile: this.profile };
      }

      const userId = this.session.user.id;

      const profilePayload = {
        user_id: userId,
        full_name: formData.full_name || '',
        email: formData.email || this.session.user.email || '',
        phone: formData.phone || '',
        date_of_birth: formData.date_of_birth || null,
        address_line1: formData.address_line1 || '',
        address_line2: formData.address_line2 || '',
        city: formData.city || '',
        state: formData.state || '',
        zip: formData.zip || '',
        preferred_language: formData.preferred_language || 'en',
        emergency_contact_name: formData.emergency_contact_name || '',
        emergency_contact_phone: formData.emergency_contact_phone || ''
      };

      const sensitivePayload = {
        user_id: userId,
        aadhaar_number: formData.aadhaar_number || '',
        pan_number: formData.pan_number || ''
      };

      console.log("[AccessFill Upsert] Sending `profiles` table payload:", sanitizeLogPayload(profilePayload));
      console.log("[AccessFill Upsert] Sending `sensitive_ids` table payload:", sanitizeLogPayload(sensitivePayload));

      let profileOk = false;
      let sensitiveOk = false;

      try {
        const res1 = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/profiles?on_conflict=user_id`, {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_CONFIG.anonKey,
            'Authorization': `Bearer ${this.session.access_token}`,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates,return=representation'
          },
          body: JSON.stringify(profilePayload)
        });

        const res1Data = await res1.json().catch(() => null);
        console.log("[AccessFill Upsert Response] profiles table HTTP " + res1.status + " keys:",
          res1Data && typeof res1Data === 'object' ? Object.keys(Array.isArray(res1Data) ? (res1Data[0] || {}) : res1Data) : []);

        if (res1.ok) {
          profileOk = true;
        } else {
          console.error("[AccessFill Upsert Error] profiles table failed:", sanitizeLogPayload(res1Data));
          return {
            success: false,
            error: `Profiles table error: ${formatApiError(res1Data, res1.status)}`
          };
        }
      } catch (err1) {
        console.error("[AccessFill Network Error] profiles table upsert failed:", sanitizeLogPayload(err1));
        return { success: false, error: `Profiles network error: ${err1.message}` };
      }

      try {
        const res2 = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/sensitive_ids?on_conflict=user_id`, {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_CONFIG.anonKey,
            'Authorization': `Bearer ${this.session.access_token}`,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates,return=representation'
          },
          body: JSON.stringify(sensitivePayload)
        });

        const res2Data = await res2.json().catch(() => null);
        console.log("[AccessFill Upsert Response] sensitive_ids table HTTP " + res2.status + " keys:",
          res2Data && typeof res2Data === 'object' ? Object.keys(Array.isArray(res2Data) ? (res2Data[0] || {}) : res2Data) : []);

        if (res2.ok) {
          sensitiveOk = true;
        } else {
          console.error("[AccessFill Upsert Error] sensitive_ids table failed:", sanitizeLogPayload(res2Data));
          return {
            success: false,
            error: `Sensitive IDs table error: ${formatApiError(res2Data, res2.status)}`
          };
        }
      } catch (err2) {
        console.error("[AccessFill Network Error] sensitive_ids table upsert failed:", sanitizeLogPayload(err2));
        return { success: false, error: `Sensitive IDs network error: ${err2.message}` };
      }

      if (profileOk && sensitiveOk) {
        console.log("[AccessFill Verification] Both upserts succeeded. Re-fetching persisted data from Supabase...");
        const verifiedProfile = await this.fetchFullUserProfileRLS();
        return { success: true, profile: verifiedProfile };
      }

      return { success: false, error: "Failed to persist profile to database." };
    }

    async signOut() {
      if (!this.isDemoMode && this.session && this.session.access_token &&
          String(this.session.access_token).indexOf('mock-') !== 0) {
        try {
          await fetch(`${SUPABASE_CONFIG.url}/auth/v1/logout`, {
            method: 'POST',
            headers: {
              'apikey': SUPABASE_CONFIG.anonKey,
              'Authorization': `Bearer ${this.session.access_token}`,
              'Content-Type': 'application/json'
            }
          });
        } catch (_) {}
      }

      this.session = null;
      this.profile = null;
      this.isDemoMode = false;
      this._initPromise = null;
      clearPersistedAuth();
      return { success: true };
    }

    getDisplayName() {
      const p = this.profile || {};
      const meta = this.session && this.session.user && this.session.user.user_metadata;
      return p.full_name || (meta && meta.full_name) || (this.session && this.session.user && this.session.user.email) || 'Friend';
    }

    maskSensitiveData(fieldKey, value) {
      if (!value) return 'Not Provided';
      if (fieldKey === 'aadhaar_number') {
        const clean = String(value).replace(/[\s-]/g, '');
        if (clean.length >= 4) return 'XXXX-XXXX-' + clean.slice(-4);
        return 'XXXX-XXXX-****';
      }
      if (fieldKey === 'pan_number') {
        if (value.length >= 5) return 'XXXXXX' + value.slice(-4);
        return 'XXXXXX****';
      }
      if (fieldKey === 'phone' || fieldKey === 'emergency_contact_phone') {
        if (value.length >= 4) return 'XXXXXX' + value.slice(-4);
        return 'XXXXXX****';
      }
      return value;
    }

    isLiveSession() {
      return !this.isDemoMode && isLiveConfigured && this.session && this.session.access_token &&
        String(this.session.access_token).indexOf('mock-') !== 0;
    }

    getUserId() {
      return this.session && this.session.user && this.session.user.id;
    }

    _authHeaders(extra) {
      return Object.assign({
        'apikey': SUPABASE_CONFIG.anonKey,
        'Authorization': 'Bearer ' + this.session.access_token
      }, extra || {});
    }

    emptyExtractedFields() {
      return {
        document_type: null,
        full_name: null,
        date_of_birth: null,
        aadhaar_number: null,
        pan_number: null,
        address: null,
        address_line1: null
      };
    }

    overlayNonEmpty(existing, patch) {
      const out = Object.assign({}, existing || {});
      Object.keys(patch || {}).forEach((key) => {
        const v = patch[key];
        if (v != null && String(v).trim() !== '') out[key] = v;
      });
      return out;
    }

    /**
     * Upload to private bucket `id-documents`.
     * Path MUST be `${auth.uid()}/${filename}` for Storage RLS.
     */
    async uploadIdDocument(file) {
      if (!this.isLiveSession()) {
        console.log("[AccessFill Storage] skip upload (demo or no live session)");
        return { success: false, demo: true, error: "Demo mode — files are not uploaded to Storage." };
      }
      const userId = this.getUserId();
      const original = (file && file.name) ? file.name : 'document.jpg';
      const safeName = original.replace(/[^\w.\-]+/g, '_').replace(/^\.+/, '') || 'document.jpg';
      const storagePath = userId + '/' + Date.now() + '-' + safeName;
      const encodedPath = storagePath.split('/').map(encodeURIComponent).join('/');

      console.log("[AccessFill Storage] upload start", { bucket: 'id-documents', pathShape: '<user_id>/<filename>' });

      try {
        const res = await fetch(SUPABASE_CONFIG.url + '/storage/v1/object/id-documents/' + encodedPath, {
          method: 'POST',
          headers: this._authHeaders({
            'Content-Type': (file && file.type) || 'application/octet-stream',
            'x-upsert': 'false'
          }),
          body: file
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          console.error("[AccessFill Storage] upload failed", { status: res.status, keys: data && Object.keys(data) });
          console.error("[AccessFill Storage] upload error object:", sanitizeLogPayload(data));
          return { success: false, error: formatApiError(data, res.status) };
        }
        console.log("[AccessFill Storage] upload ok");
        return { success: true, storagePath: storagePath };
      } catch (err) {
        console.error("[AccessFill Storage] upload network error:", sanitizeLogPayload(err));
        return { success: false, error: err.message || 'Network error uploading document.' };
      }
    }

    async invokeExtractIdDocument(storagePath) {
      if (!this.isLiveSession()) {
        console.log("[AccessFill Extract] skip (demo)");
        return { success: false, demo: true, fields: this.emptyExtractedFields(), error: 'extract_skipped_demo' };
      }
      console.log("[AccessFill Extract] invoking extract-id-document");
      try {
        const res = await fetch(SUPABASE_CONFIG.url + '/functions/v1/extract-id-document', {
          method: 'POST',
          headers: this._authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ storage_path: storagePath })
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data || !data.success) {
          console.error("[AccessFill Extract] failed", {
            status: res.status,
            keys: data && data.fields ? Object.keys(data.fields) : [],
            error: data && data.error
          });
          if (data) console.error("[AccessFill Extract] error object:", sanitizeLogPayload(data));
          return {
            success: false,
            fields: this.emptyExtractedFields(),
            error: (data && data.error) || formatApiError(data, res.status)
          };
        }
        const keysFound = Object.keys(data.fields || {}).filter((k) => data.fields[k] != null && data.fields[k] !== '');
        console.log("[AccessFill Extract] ok", { keysFound: keysFound });
        return { success: true, fields: Object.assign(this.emptyExtractedFields(), data.fields || {}) };
      } catch (err) {
        console.error("[AccessFill Extract] network error:", sanitizeLogPayload(err));
        return { success: false, fields: this.emptyExtractedFields(), error: err.message };
      }
    }

    /**
     * Ask Gemini (via Edge Function) to explain an unknown field.
     * Sends only field_key / field_label / language — never field values.
     */
    async invokeExplainFormField({ fieldKey, fieldLabel, language }) {
      const key = String(fieldKey || '').slice(0, 80);
      const label = String(fieldLabel || '').slice(0, 120);
      const lang = language === 'kn' ? 'kn' : 'en';
      console.log("[AccessFill Explain] invoke", { field_key: key, language: lang });
      if (!this.isLiveSession()) {
        return { success: false, demo: true, error: 'explain_skipped_demo' };
      }
      try {
        const res = await fetch(SUPABASE_CONFIG.url + '/functions/v1/explain-form-field', {
          method: 'POST',
          headers: this._authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ field_key: key, field_label: label, language: lang })
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data || !data.explanation) {
          console.error("[AccessFill Explain] failed", { status: res.status, error: data && data.error });
          if (data) console.error("[AccessFill Explain] error object:", sanitizeLogPayload(data));
          return { success: false, error: (data && data.error) || formatApiError(data, res.status) };
        }
        console.log("[AccessFill Explain] ok", { field_key: key, language: lang });
        return { success: true, explanation: String(data.explanation) };
      } catch (err) {
        console.error("[AccessFill Explain] network error:", sanitizeLogPayload(err));
        return { success: false, error: err.message };
      }
    }

    /**
     * Gemini neural TTS via Edge Function.
     * Sends explanation text + language only — never form field VALUES.
     */
    async invokeTextToSpeech({ text, language }) {
      const lang = language === 'kn' ? 'kn' : 'en';
      const clipped = String(text || '').trim().slice(0, 800);
      console.log("[AccessFill TTS] invoke", { language: lang, text_len: clipped.length });
      if (!clipped) return { success: false, error: 'empty_text' };
      if (!this.isLiveSession()) {
        return { success: false, demo: true, error: 'tts_skipped_demo' };
      }
      try {
        const res = await fetch(SUPABASE_CONFIG.url + '/functions/v1/text-to-speech', {
          method: 'POST',
          headers: this._authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ text: clipped, language: lang })
        });
        const data = await res.json().catch(() => null);
        const b64 = data && (data.audio_base64 || data.audioBase64);
        if (!res.ok || !b64) {
          console.error("[AccessFill TTS] failed", { status: res.status, error: data && data.error });
          if (data) console.error("[AccessFill TTS] error object:", sanitizeLogPayload(data));
          return { success: false, error: (data && data.error) || formatApiError(data, res.status) };
        }
        console.log("[AccessFill TTS] ok", { language: lang, mime: data.mime_type || data.mimeType });
        return {
          success: true,
          audioBase64: b64,
          mimeType: data.mime_type || data.mimeType || 'audio/wav'
        };
      } catch (err) {
        console.error("[AccessFill TTS] network error:", sanitizeLogPayload(err));
        return { success: false, error: err.message };
      }
    }

    async insertUploadedDocument({ documentType, storagePath, extractedFields, confirmed }) {
      if (!this.isLiveSession()) {
        const row = {
          id: 'demo-doc-' + Date.now(),
          user_id: this.getUserId(),
          document_type: documentType || 'other',
          storage_path: storagePath || 'demo/local',
          extracted_fields: extractedFields || {},
          confirmed: !!confirmed
        };
        try {
          const list = JSON.parse(localStorage.getItem('af_demo_uploaded_documents') || '[]');
          list.push(row);
          localStorage.setItem('af_demo_uploaded_documents', JSON.stringify(list));
        } catch (_) {}
        console.log("[AccessFill Documents] demo insert only (local)", { keys: Object.keys(extractedFields || {}) });
        return { success: true, demo: true, row: row };
      }

      const payload = {
        user_id: this.getUserId(),
        document_type: documentType || 'other',
        storage_path: storagePath,
        extracted_fields: extractedFields || {},
        confirmed: !!confirmed
      };
      console.log("[AccessFill Documents] insert uploaded_documents", { keys: Object.keys(extractedFields || {}) });

      try {
        const res = await fetch(SUPABASE_CONFIG.url + '/rest/v1/uploaded_documents', {
          method: 'POST',
          headers: this._authHeaders({
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
          }),
          body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          console.error("[AccessFill Documents] insert failed:", sanitizeLogPayload(data));
          return { success: false, error: formatApiError(data, res.status) };
        }
        const row = Array.isArray(data) ? data[0] : data;
        console.log("[AccessFill Documents] insert ok", { hasId: !!(row && row.id) });
        return { success: true, row: row };
      } catch (err) {
        console.error("[AccessFill Documents] insert network error:", sanitizeLogPayload(err));
        return { success: false, error: err.message };
      }
    }

    async confirmUploadedDocument(id, extractedFields) {
      if (!this.isLiveSession()) {
        try {
          const list = JSON.parse(localStorage.getItem('af_demo_uploaded_documents') || '[]');
          const next = list.map((r) => r.id === id ? Object.assign({}, r, { confirmed: true, extracted_fields: extractedFields }) : r);
          localStorage.setItem('af_demo_uploaded_documents', JSON.stringify(next));
        } catch (_) {}
        console.log("[AccessFill Documents] demo confirm only (local)");
        return { success: true, demo: true };
      }

      console.log("[AccessFill Documents] confirm uploaded_documents");
      try {
        const res = await fetch(SUPABASE_CONFIG.url + '/rest/v1/uploaded_documents?id=eq.' + encodeURIComponent(id), {
          method: 'PATCH',
          headers: this._authHeaders({
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
          }),
          body: JSON.stringify({
            confirmed: true,
            extracted_fields: extractedFields,
            updated_at: new Date().toISOString()
          })
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          console.error("[AccessFill Documents] confirm failed:", sanitizeLogPayload(data));
          return { success: false, error: formatApiError(data, res.status) };
        }
        console.log("[AccessFill Documents] confirm ok");
        return { success: true, row: Array.isArray(data) ? data[0] : data };
      } catch (err) {
        console.error("[AccessFill Documents] confirm network error:", sanitizeLogPayload(err));
        return { success: false, error: err.message };
      }
    }
  }

  global.AccessFillSupabase = new SupabaseClientAdapter();
  global.AccessFillSupabase.sanitizeLogPayload = sanitizeLogPayload;
  global.AccessFillSupabaseConfig = SUPABASE_CONFIG;
})(typeof globalThis !== 'undefined' ? globalThis : window);
