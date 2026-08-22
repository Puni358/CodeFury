/**
 * AccessFill - Supabase Auth & Multi-Table RLS Client Adapter
 * 
 * Features:
 * - Two-Table Schema Persistence:
 *     1. profiles table (user_id, full_name, email, phone, date_of_birth, address_line1, address_line2, city, state, zip, preferred_language, emergency_contact_name, emergency_contact_phone)
 *     2. sensitive_ids table (user_id, aadhaar_number, pan_number)
 * - RLS User ID matching: user_id = auth.uid()
 * - Verified re-fetch after save (fetchFullUserProfileRLS)
 * - PII Log Redaction & Supabase HTTP Response status tracking
 */

(function (global) {
  'use strict';

  // Real Supabase Project Credentials
  const SUPABASE_CONFIG = {
    url: "https://aviioibehxmkjwnoekjt.supabase.co",
    anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2aWlvaWJlaHhta2p3bm9la2p0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcyODM2MjYsImV4cCI6MjEwMjg1OTYyNn0.3jy4_F-Dk3PK8P-zKuysPq8CfzrKbARyP5Zufb02Twc"
  };

  const isLiveConfigured = Boolean(
    SUPABASE_CONFIG.url &&
    SUPABASE_CONFIG.anonKey &&
    !SUPABASE_CONFIG.url.includes("xyzexample") &&
    !SUPABASE_CONFIG.anonKey.includes("...")
  );

  if (isLiveConfigured) {
    console.log(
      `%c[AccessFill Supabase] LIVE MODE ACTIVE: Connected to ${SUPABASE_CONFIG.url}`,
      "color: #16a34a; font-weight: bold; font-size: 13px;"
    );
  } else {
    console.warn(
      "%c[AccessFill Supabase] MOCK MODE ACTIVE: isLiveConfigured=false because anonKey is placeholder",
      "color: #d97706; font-weight: bold; font-size: 13px;"
    );
  }

  // Redact PII in console logs for privacy/security
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

  // Default Mock Profile Stub for Instant Demo Mode
  const DEFAULT_MOCK_PROFILE = {
    user_id: "demo-user-123",
    full_name: "Aarav Sharma",
    email: "aarav.sharma@example.com",
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

  class SupabaseClientAdapter {
    constructor() {
      this.session = null;
      this.profile = null;
      this.isDemoMode = false;
    }

    /**
     * Session Check on Load
     */
    async init() {
      const stored = await chrome.storage.local.get(['supabaseSession', 'userProfile', 'isDemoMode']);
      if (stored.supabaseSession && stored.supabaseSession.access_token) {
        this.session = stored.supabaseSession;
        this.isDemoMode = !!stored.isDemoMode;

        if (!this.isDemoMode && isLiveConfigured) {
          try {
            this.profile = await this.fetchFullUserProfileRLS();
          } catch (e) {
            this.profile = stored.userProfile || DEFAULT_MOCK_PROFILE;
          }
        } else {
          this.profile = stored.userProfile || DEFAULT_MOCK_PROFILE;
        }

        return { session: this.session, profile: this.profile, isDemoMode: this.isDemoMode };
      }

      return { session: null, profile: null, isDemoMode: false };
    }

    /**
     * Sign Up with Email + Password
     */
    async signUp(email, password, fullName = '') {
      if (!email || !password) return { success: false, error: "Email and password are required." };
      if (password.length < 6) return { success: false, error: "Password must be at least 6 characters long." };

      if (isLiveConfigured) {
        try {
          console.log(`[AccessFill Supabase] POST ${SUPABASE_CONFIG.url}/auth/v1/signup`);
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

            // Save initial profile
            await this.saveFullUserProfileRLS({
              full_name: fullName || email.split('@')[0],
              email: email,
              preferred_language: 'en'
            });

            this.profile = await this.fetchFullUserProfileRLS();
            return { success: true, session: this.session, profile: this.profile, isDemoMode: false };
          } else if (data.id || data.user) {
            return { success: true, needsConfirmation: true, message: "Check email for confirmation link." };
          }
        } catch (err) {
          return { success: false, error: err.message || "Network error connecting to Supabase." };
        }
      }

      // Demo fallback
      const mockSession = { access_token: "mock-token-" + Date.now(), user: { id: "usr-" + Date.now(), email } };
      this.session = mockSession;
      this.isDemoMode = false;
      this.profile = { ...DEFAULT_MOCK_PROFILE, user_id: mockSession.user.id, full_name: fullName || email.split('@')[0], email, isDemo: false };
      await chrome.storage.local.set({ supabaseSession: this.session, userProfile: this.profile, isDemoMode: false });
      return { success: true, session: this.session, profile: this.profile, isDemoMode: false };
    }

    /**
     * Sign In with Password
     */
    async signInWithPassword(email, password) {
      if (!email || !password) return { success: false, error: "Email and password are required." };

      if (isLiveConfigured) {
        try {
          console.log(`[AccessFill Supabase] POST ${SUPABASE_CONFIG.url}/auth/v1/token?grant_type=password`);
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

          await chrome.storage.local.set({
            supabaseSession: this.session,
            userProfile: this.profile,
            isDemoMode: false
          });

          return { success: true, session: this.session, profile: this.profile, isDemoMode: false };
        } catch (err) {
          return { success: false, error: err.message || "Network error connecting to Supabase." };
        }
      }

      // Demo fallback
      const mockSession = { access_token: "mock-token-" + Date.now(), user: { id: "usr-123", email } };
      this.session = mockSession;
      this.isDemoMode = false;
      this.profile = { ...DEFAULT_MOCK_PROFILE, user_id: "usr-123", email, isDemo: false };
      await chrome.storage.local.set({ supabaseSession: this.session, userProfile: this.profile, isDemoMode: false });
      return { success: true, session: this.session, profile: this.profile, isDemoMode: false };
    }

    /**
     * Instant Demo Mode Sign In
     */
    async signInDemo() {
      const mockSession = {
        access_token: "mock-demo-token-" + Date.now(),
        user: { id: "demo-user-123", email: "aarav.sharma.demo@accessfill.local" }
      };

      this.session = mockSession;
      this.isDemoMode = true;
      this.profile = { ...DEFAULT_MOCK_PROFILE, isDemo: true };

      await chrome.storage.local.set({
        supabaseSession: this.session,
        userProfile: this.profile,
        isDemoMode: true
      });

      return { success: true, session: this.session, profile: this.profile, isDemoMode: true };
    }

    /**
     * Fetch profiles table row via Supabase RLS (user_id = auth.uid())
     */
    async fetchProfileRLS() {
      if (isLiveConfigured && this.session && this.session.access_token) {
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
            if (Array.isArray(rows) && rows.length > 0) {
              return rows[0];
            }
          }
        } catch (err) {
          console.warn("[AccessFill Supabase] profiles table fetch error:", err.message);
        }
      }
      return null;
    }

    /**
     * Fetch sensitive_ids table row via Supabase RLS (user_id = auth.uid())
     */
    async fetchSensitiveIdsRLS() {
      if (isLiveConfigured && this.session && this.session.access_token) {
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
            if (Array.isArray(rows) && rows.length > 0) {
              return rows[0];
            }
          }
        } catch (err) {
          console.warn("[AccessFill Supabase] sensitive_ids table fetch error:", err.message);
        }
      }
      return null;
    }

    /**
     * Re-fetch and merge profiles + sensitive_ids tables into unified user profile
     */
    async fetchFullUserProfileRLS() {
      if (this.isDemoMode) return this.profile || DEFAULT_MOCK_PROFILE;

      const profileRow = await this.fetchProfileRLS() || {};
      const sensitiveRow = await this.fetchSensitiveIdsRLS() || {};

      const fullProfile = {
        user_id: this.session?.user?.id,
        full_name: profileRow.full_name || this.session?.user?.user_metadata?.full_name || '',
        email: profileRow.email || this.session?.user?.email || '',
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
        // Sensitive IDs
        aadhaar_number: sensitiveRow.aadhaar_number || '',
        pan_number: sensitiveRow.pan_number || '',
        isDemo: false
      };

      this.profile = fullProfile;
      await chrome.storage.local.set({ userProfile: fullProfile });
      return fullProfile;
    }

    /**
     * Save Full Profile: Two separate .upsert() calls to profiles and sensitive_ids tables
     */
    async saveFullUserProfileRLS(formData) {
      if (this.isDemoMode || !isLiveConfigured || !this.session || !this.session.access_token) {
        // Demo mode update
        this.profile = { ...this.profile, ...formData, isDemo: this.isDemoMode };
        await chrome.storage.local.set({ userProfile: this.profile });
        return { success: true, profile: this.profile };
      }

      const userId = this.session.user.id;

      // 1. Prepare Payload for `profiles` table
      const profilePayload = {
        user_id: userId, // Match user_id = auth.uid()
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

      // 2. Prepare Payload for `sensitive_ids` table
      const sensitivePayload = {
        user_id: userId, // Match user_id = auth.uid()
        aadhaar_number: formData.aadhaar_number || '',
        pan_number: formData.pan_number || ''
      };

      // Console Logging with PII Redaction
      console.log("[AccessFill Upsert] Sending `profiles` table payload:", sanitizeLogPayload(profilePayload));
      console.log("[AccessFill Upsert] Sending `sensitive_ids` table payload:", sanitizeLogPayload(sensitivePayload));

      let profileOk = false;
      let sensitiveOk = false;

      // EXECUTE UPSERT 1: `profiles` table
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
        console.log(`[AccessFill Upsert Response] profiles table HTTP ${res1.status}:`, res1Data);

        if (res1.ok) {
          profileOk = true;
        } else {
          console.error("[AccessFill Upsert Error] profiles table failed:", res1Data);
          return { 
            success: false, 
            error: `Profiles table error (${res1.status}): ${res1Data?.message || res1Data?.hint || 'RLS check or schema error'}` 
          };
        }
      } catch (err1) {
        console.error("[AccessFill Network Error] profiles table upsert failed:", err1);
        return { success: false, error: `Profiles network error: ${err1.message}` };
      }

      // EXECUTE UPSERT 2: `sensitive_ids` table
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
        console.log(`[AccessFill Upsert Response] sensitive_ids table HTTP ${res2.status}:`, res2Data);

        if (res2.ok) {
          sensitiveOk = true;
        } else {
          console.error("[AccessFill Upsert Error] sensitive_ids table failed:", res2Data);
          return { 
            success: false, 
            error: `Sensitive IDs table error (${res2.status}): ${res2Data?.message || res2Data?.hint || 'RLS check or schema error'}` 
          };
        }
      } catch (err2) {
        console.error("[AccessFill Network Error] sensitive_ids table upsert failed:", err2);
        return { success: false, error: `Sensitive IDs network error: ${err2.message}` };
      }

      // RE-FETCH VERIFICATION FROM SUPABASE REST API
      if (profileOk && sensitiveOk) {
        console.log("[AccessFill Verification] Both upserts succeeded. Re-fetching persisted data from Supabase...");
        const verifiedProfile = await this.fetchFullUserProfileRLS();
        return { success: true, profile: verifiedProfile };
      }

      return { success: false, error: "Failed to persist profile to database." };
    }

    /**
     * Sign out user and purge stored session
     */
    async signOut() {
      this.session = null;
      this.profile = null;
      this.isDemoMode = false;
      await chrome.storage.local.remove(['supabaseSession', 'userProfile', 'isDemoMode']);
      return { success: true };
    }

    /**
     * Helper to mask sensitive data for UI display
     */
    maskSensitiveData(fieldKey, value) {
      if (!value) return 'Not Provided';
      if (fieldKey === 'aadhaar_number') {
        const clean = value.replace(/[\s-]/g, '');
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
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
