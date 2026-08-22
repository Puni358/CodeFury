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

  function sanitizeLogPayload(data) {
    if (!data || typeof data !== 'object') return data;
    const sensitiveKeys = ['aadhaar_number', 'pan_number', 'phone', 'emergency_contact_phone'];
    const sanitized = { ...data };
    for (const key of Object.keys(sanitized)) {
      if (sensitiveKeys.includes(key) && sanitized[key]) {
        sanitized[key] = '[REDACTED_PII]';
      }
    }
    return sanitized;
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
        console.log("[AccessFill Upsert Response] profiles table HTTP " + res1.status + " (fields omitted)");

        if (res1.ok) {
          profileOk = true;
        } else {
          console.error("[AccessFill Upsert Error] profiles table failed (status " + res1.status + ")");
          return {
            success: false,
            error: `Profiles table error (${res1.status}): ${res1Data && (res1Data.message || res1Data.hint) || 'RLS check or schema error'}`
          };
        }
      } catch (err1) {
        console.error("[AccessFill Network Error] profiles table upsert failed");
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
        console.log("[AccessFill Upsert Response] sensitive_ids table HTTP " + res2.status + " (fields omitted)");

        if (res2.ok) {
          sensitiveOk = true;
        } else {
          console.error("[AccessFill Upsert Error] sensitive_ids table failed (status " + res2.status + ")");
          return {
            success: false,
            error: `Sensitive IDs table error (${res2.status}): ${res2Data && (res2Data.message || res2Data.hint) || 'RLS check or schema error'}`
          };
        }
      } catch (err2) {
        console.error("[AccessFill Network Error] sensitive_ids table upsert failed");
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
  }

  global.AccessFillSupabase = new SupabaseClientAdapter();
  global.AccessFillSupabaseConfig = SUPABASE_CONFIG;
})(typeof globalThis !== 'undefined' ? globalThis : window);
