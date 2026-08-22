/**
 * AccessFill - Popup User Interface Logic with Form Validations
 */

document.addEventListener('DOMContentLoaded', async () => {
  // DOM Element References
  const signedOutView = document.getElementById('signed-out-view');
  const signedInView = document.getElementById('signed-in-view');
  const statusBanner = document.getElementById('status-banner');

  // Tabs
  const tabSignIn = document.getElementById('tab-signin');
  const tabSignUp = document.getElementById('tab-signup');
  const panelSignIn = document.getElementById('panel-signin');
  const panelSignUp = document.getElementById('panel-signup');

  // Auth Forms
  const formSignIn = document.getElementById('form-signin');
  const formSignUp = document.getElementById('form-signup');
  const btnDemoSignIn = document.getElementById('btn-demo-signin');
  const btnSignOut = document.getElementById('btn-signout');

  // Session Badge
  const sessionModeBadge = document.getElementById('session-mode-badge');
  const sessionModeText = document.getElementById('session-mode-text');

  // Action & Edit
  const btnScanPage = document.getElementById('btn-scan-page');
  const btnFillForm = document.getElementById('btn-fill-form');

  const scanSummaryCard = document.getElementById('scan-summary-card');
  const scanSummaryText = document.getElementById('scan-summary-text');

  const profileSummaryList = document.getElementById('profile-summary-list');
  const profileEditForm = document.getElementById('profile-edit-form');
  const btnToggleEdit = document.getElementById('btn-toggle-edit');
  const btnCancelEdit = document.getElementById('btn-cancel-edit');

  const langEnBtn = document.getElementById('lang-en');
  const langHiBtn = document.getElementById('lang-hi');

  // Form Inputs
  const editPhoneInput = document.getElementById('edit-phone');
  const editEmergencyPhoneInput = document.getElementById('edit-emergency-phone');
  const editAadhaarInput = document.getElementById('edit-aadhaar');
  const editPanInput = document.getElementById('edit-pan');
  const editDobInput = document.getElementById('edit-dob');

  // Error Spans
  const errPhone = document.getElementById('err-phone');
  const errEmergencyPhone = document.getElementById('err-emergency-phone');
  const errAadhaar = document.getElementById('err-aadhaar');
  const errPan = document.getElementById('err-pan');
  const errDob = document.getElementById('err-dob');

  let currentLang = 'en';
  let userProfile = null;
  let isDemoSession = false;

  // Set DOB max attribute to today's date YYYY-MM-DD
  const todayStr = new Date().toISOString().split('T')[0];
  if (editDobInput) {
    editDobInput.max = todayStr;
  }

  // --- 1. REAL-TIME INPUT RESTRICTIONS & FORMATTING ---
  
  // Phone: 10 digits only
  [editPhoneInput, editEmergencyPhoneInput].forEach(input => {
    if (!input) return;
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(0, 10);
    });
  });

  // Aadhaar: 12 digits only
  if (editAadhaarInput) {
    editAadhaarInput.addEventListener('input', () => {
      editAadhaarInput.value = editAadhaarInput.value.replace(/\D/g, '').slice(0, 12);
    });
  }

  // PAN: Auto-uppercase & alphanumeric (ABCDE1234F)
  if (editPanInput) {
    editPanInput.addEventListener('input', () => {
      editPanInput.value = editPanInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
    });
    editPanInput.addEventListener('blur', () => {
      validatePanField();
    });
  }

  // Real-time blur validations
  if (editPhoneInput) editPhoneInput.addEventListener('blur', () => validatePhoneField(editPhoneInput, errPhone));
  if (editEmergencyPhoneInput) editEmergencyPhoneInput.addEventListener('blur', () => validatePhoneField(editEmergencyPhoneInput, errEmergencyPhone));
  if (editAadhaarInput) editAadhaarInput.addEventListener('blur', validateAadhaarField);
  if (editDobInput) editDobInput.addEventListener('blur', validateDobField);

  // Validation Helpers
  function validatePhoneField(input, errSpan) {
    const val = input.value.trim();
    if (val.length > 0 && val.length !== 10) {
      if (errSpan) errSpan.classList.remove('hidden');
      return false;
    }
    if (errSpan) errSpan.classList.add('hidden');
    return true;
  }

  function validateAadhaarField() {
    const val = editAadhaarInput.value.trim();
    if (val.length > 0 && val.length !== 12) {
      if (errAadhaar) errAadhaar.classList.remove('hidden');
      return false;
    }
    if (errAadhaar) errAadhaar.classList.add('hidden');
    return true;
  }

  function validatePanField() {
    const val = editPanInput.value.trim();
    const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
    if (val.length > 0 && !panRegex.test(val)) {
      if (errPan) errPan.classList.remove('hidden');
      return false;
    }
    if (errPan) errPan.classList.add('hidden');
    return true;
  }

  function validateDobField() {
    const val = editDobInput.value;
    if (val && val > todayStr) {
      if (errDob) errDob.classList.remove('hidden');
      return false;
    }
    if (errDob) errDob.classList.add('hidden');
    return true;
  }

  // --- 2. SESSION CHECK ON LOAD ---
  showStatus("Checking session...", "info");
  const { session, profile, isDemoMode } = await AccessFillSupabase.init();
  const storedLang = await chrome.storage.local.get(['preferredLanguage']);
  if (storedLang.preferredLanguage) {
    currentLang = storedLang.preferredLanguage;
  }

  updateLanguageUI(currentLang);

  if (session && profile) {
    userProfile = profile;
    isDemoSession = isDemoMode;
    showSignedInView(userProfile, isDemoSession);
  } else {
    showSignedOutView();
  }

  // --- 3. TAB SWITCHING (Sign In vs Sign Up) ---
  tabSignIn.addEventListener('click', () => {
    tabSignIn.classList.add('active');
    tabSignIn.setAttribute('aria-selected', 'true');
    tabSignUp.classList.remove('active');
    tabSignUp.setAttribute('aria-selected', 'false');

    panelSignIn.classList.remove('hidden');
    panelSignUp.classList.add('hidden');
    hideStatus();
  });

  tabSignUp.addEventListener('click', () => {
    tabSignUp.classList.add('active');
    tabSignUp.setAttribute('aria-selected', 'true');
    tabSignIn.classList.remove('active');
    tabSignIn.setAttribute('aria-selected', 'false');

    panelSignUp.classList.remove('hidden');
    panelSignIn.classList.add('hidden');
    hideStatus();
  });

  // --- 4. AUTHENTICATION HANDLERS ---

  // Sign In with Email + Password
  formSignIn.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('signin-email').value.trim();
    const password = document.getElementById('signin-password').value;

    showStatus("Signing in with email & password...", "info");

    const result = await AccessFillSupabase.signInWithPassword(email, password);

    if (!result.success) {
      showStatus(`Sign in failed: ${result.error}`, "error");
      return;
    }

    userProfile = result.profile;
    isDemoSession = false;
    showSignedInView(userProfile, false);
    showStatus("Signed in successfully!", "success");
  });

  // Sign Up with Email + Password
  formSignUp.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fullName = document.getElementById('signup-fullname').value.trim();
    const email = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;

    showStatus("Creating your account...", "info");

    const result = await AccessFillSupabase.signUp(email, password, fullName);

    if (!result.success) {
      showStatus(`Sign up failed: ${result.error}`, "error");
      return;
    }

    if (result.needsConfirmation) {
      showStatus(result.message, "warning");
      return;
    }

    userProfile = result.profile;
    isDemoSession = false;
    showSignedInView(userProfile, false);
    showStatus("Account created and signed in!", "success");
  });

  // Instant Demo Mode Sign In
  btnDemoSignIn.addEventListener('click', async () => {
    showStatus("Initializing Instant Demo Mode...", "info");
    const result = await AccessFillSupabase.signInDemo();
    
    if (result.success) {
      userProfile = result.profile;
      isDemoSession = true;
      showSignedInView(userProfile, true);
      showStatus("Demo mode active (Mock Profile)!", "warning");
    }
  });

  // Sign Out Handler
  btnSignOut.addEventListener('click', async () => {
    await AccessFillSupabase.signOut();
    userProfile = null;
    isDemoSession = false;
    showSignedOutView();
    showStatus("Signed out successfully.", "info");
  });

  // --- 5. LANGUAGE TOGGLE HANDLERS ---
  langEnBtn.addEventListener('click', () => setLanguage('en'));
  langHiBtn.addEventListener('click', () => setLanguage('hi'));

  async function setLanguage(lang) {
    currentLang = lang;
    await chrome.storage.local.set({ preferredLanguage: lang });
    if (userProfile) {
      userProfile.preferred_language = lang;
      await AccessFillSupabase.saveFullUserProfileRLS({ preferred_language: lang });
    }
    updateLanguageUI(lang);
  }

  function updateLanguageUI(lang) {
    langEnBtn.classList.toggle('active', lang === 'en');
    langEnBtn.setAttribute('aria-pressed', lang === 'en');
    langHiBtn.classList.toggle('active', lang === 'hi');
    langHiBtn.setAttribute('aria-pressed', lang === 'hi');
  }

  // --- 6. VIEW SWITCHERS & VISUAL INDICATOR BADGE ---
  function showSignedOutView() {
    signedOutView.classList.remove('hidden');
    signedInView.classList.add('hidden');
    hideStatus();
  }

  function showSignedInView(prof, isDemo) {
    signedOutView.classList.add('hidden');
    signedInView.classList.remove('hidden');
    
    if (isDemo) {
      sessionModeBadge.className = 'session-badge badge-demo';
      sessionModeText.textContent = '⚡ Instant Demo Mode (Mock Profile)';
    } else {
      sessionModeBadge.className = 'session-badge badge-live';
      sessionModeText.textContent = '🟢 Live Supabase Session (Authenticated)';
    }

    renderProfileSummary(prof);
    hideStatus();
  }

  function renderProfileSummary(prof) {
    if (!prof) return;

    const nameStr = prof.full_name || 'User';
    const initials = nameStr.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
    document.getElementById('user-avatar').textContent = initials || 'AF';
    document.getElementById('user-name-display').textContent = nameStr;

    // Display all general and sensitive values
    document.getElementById('val-fullname').textContent = prof.full_name || 'Not Provided';
    document.getElementById('val-email').textContent = prof.email || 'Not Provided';

    document.getElementById('val-aadhaar').textContent = AccessFillSupabase.maskSensitiveData('aadhaar_number', prof.aadhaar_number);
    document.getElementById('val-pan').textContent = AccessFillSupabase.maskSensitiveData('pan_number', prof.pan_number);
    document.getElementById('val-phone').textContent = AccessFillSupabase.maskSensitiveData('phone', prof.phone);
    document.getElementById('val-dob').textContent = prof.date_of_birth || 'Not Provided';

    // Formatted Address String
    const addrParts = [prof.address_line1, prof.address_line2, prof.city, prof.state, prof.zip].filter(Boolean);
    document.getElementById('val-address').textContent = addrParts.length > 0 ? addrParts.join(', ') : 'Not Provided';

    // Emergency Contact
    const emergParts = [prof.emergency_contact_name, prof.emergency_contact_phone ? `(${AccessFillSupabase.maskSensitiveData('emergency_contact_phone', prof.emergency_contact_phone)})` : ''].filter(Boolean);
    document.getElementById('val-emergency').textContent = emergParts.length > 0 ? emergParts.join(' ') : 'Not Provided';

    // Pre-populate all edit form inputs
    document.getElementById('edit-full-name').value = prof.full_name || '';
    document.getElementById('edit-email').value = prof.email || '';
    document.getElementById('edit-phone').value = prof.phone || '';
    document.getElementById('edit-dob').value = prof.date_of_birth || '';
    document.getElementById('edit-language').value = prof.preferred_language || 'en';
    document.getElementById('edit-address1').value = prof.address_line1 || '';
    document.getElementById('edit-address2').value = prof.address_line2 || '';
    document.getElementById('edit-city').value = prof.city || '';
    document.getElementById('edit-state').value = prof.state || '';
    document.getElementById('edit-zip').value = prof.zip || '';
    document.getElementById('edit-emergency-name').value = prof.emergency_contact_name || '';
    document.getElementById('edit-emergency-phone').value = prof.emergency_contact_phone || '';
    document.getElementById('edit-aadhaar').value = prof.aadhaar_number || '';
    document.getElementById('edit-pan').value = prof.pan_number || '';
  }

  // --- 7. SCAN & FILL ACTIONS ---
  btnScanPage.addEventListener('click', () => {
    showStatus("Scanning active page...", "info");
    chrome.runtime.sendMessage({ action: 'SCAN_CURRENT_TAB' }, (response) => {
      if (chrome.runtime.lastError || !response || !response.success) {
        const errMsg = response?.error || "Cannot scan this page. Try opening a regular webpage.";
        showStatus(errMsg, "error");
        scanSummaryCard.classList.add('hidden');
        return;
      }

      scanSummaryCard.classList.remove('hidden');
      if (response.matchedCount > 0) {
        scanSummaryText.innerHTML = `Found <strong>${response.matchedCount}</strong> fillable field(s) on this page!`;
        showStatus(`Page scan complete! ${response.matchedCount} fields matched.`, "success");
      } else {
        scanSummaryText.textContent = "No matching fields found on this form.";
        showStatus("No matching fields found.", "warning");
      }
    });
  });

  btnFillForm.addEventListener('click', () => {
    if (!userProfile) {
      showStatus("Please sign in first.", "error");
      return;
    }

    showStatus("Triggering autofill on active tab...", "info");
    chrome.runtime.sendMessage({ action: 'FILL_CURRENT_TAB', profile: userProfile }, (response) => {
      if (chrome.runtime.lastError || !response || !response.success) {
        const errMsg = response?.error || "Could not fill page. Please refresh the webpage and try again.";
        showStatus(errMsg, "error");
        return;
      }
      showStatus("Autofill initiated on page!", "success");
      setTimeout(() => hideStatus(), 3000);
    });
  });

  // --- 8. INLINE PROFILE EDITOR ---
  btnToggleEdit.addEventListener('click', () => {
    const isHidden = profileEditForm.classList.contains('hidden');
    if (isHidden) {
      profileEditForm.classList.remove('hidden');
      profileSummaryList.classList.add('hidden');
      btnToggleEdit.textContent = "Close Editor";
      btnToggleEdit.setAttribute('aria-expanded', 'true');
    } else {
      profileEditForm.classList.add('hidden');
      profileSummaryList.classList.remove('hidden');
      btnToggleEdit.textContent = "Edit Profile";
      btnToggleEdit.setAttribute('aria-expanded', 'false');
    }
  });

  btnCancelEdit.addEventListener('click', () => {
    profileEditForm.classList.add('hidden');
    profileSummaryList.classList.remove('hidden');
    btnToggleEdit.textContent = "Edit Profile";
    btnToggleEdit.setAttribute('aria-expanded', 'false');
  });

  // SAVE PROFILE FORM SUBMIT HANDLER WITH VALIDATION
  profileEditForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Run field validations
    const isPhoneValid = validatePhoneField(editPhoneInput, errPhone);
    const isEmergencyPhoneValid = validatePhoneField(editEmergencyPhoneInput, errEmergencyPhone);
    const isAadhaarValid = validateAadhaarField();
    const isPanValid = validatePanField();
    const isDobValid = validateDobField();

    if (!isPhoneValid || !isEmergencyPhoneValid || !isAadhaarValid || !isPanValid || !isDobValid) {
      showStatus("Please fix the validation errors in the form before saving.", "error");
      return;
    }

    showStatus("Persisting profile data to Supabase (profiles & sensitive_ids tables)...", "info");

    const updatedFormData = {
      full_name: document.getElementById('edit-full-name').value.trim(),
      email: document.getElementById('edit-email').value.trim(),
      phone: editPhoneInput.value.trim(),
      date_of_birth: editDobInput.value,
      preferred_language: document.getElementById('edit-language').value,
      address_line1: document.getElementById('edit-address1').value.trim(),
      address_line2: document.getElementById('edit-address2').value.trim(),
      city: document.getElementById('edit-city').value.trim(),
      state: document.getElementById('edit-state').value.trim(),
      zip: document.getElementById('edit-zip').value.trim(),
      emergency_contact_name: document.getElementById('edit-emergency-name').value.trim(),
      emergency_contact_phone: editEmergencyPhoneInput.value.trim(),
      // Sensitive IDs
      aadhaar_number: editAadhaarInput.value.trim(),
      pan_number: editPanInput.value.trim()
    };

    const saveResult = await AccessFillSupabase.saveFullUserProfileRLS(updatedFormData);

    if (!saveResult.success) {
      showStatus(`Save failed: ${saveResult.error}`, "error");
      return;
    }

    // Re-render UI with verified persisted data returned after re-fetch
    userProfile = saveResult.profile;
    renderProfileSummary(userProfile);

    profileEditForm.classList.add('hidden');
    profileSummaryList.classList.remove('hidden');
    btnToggleEdit.textContent = "Edit Profile";
    btnToggleEdit.setAttribute('aria-expanded', 'false');

    showStatus("Profile & Sensitive IDs successfully saved and verified!", "success");
    setTimeout(() => hideStatus(), 4000);
  });

  // --- 9. STATUS BANNER HELPER ---
  function showStatus(msg, type = "info") {
    statusBanner.textContent = msg;
    statusBanner.className = `status-banner status-${type}`;
    statusBanner.classList.remove('hidden');
  }

  function hideStatus() {
    statusBanner.classList.add('hidden');
  }
});
