/**
 * AccessFill - Content Script Engine
 * 
 * Responsibilities:
 * - Scans active DOM forms using AccessFillMatcher
 * - Renders non-intrusive Consent Tooltip before auto-filling sensitive fields
 * - Dispatches native input events for React/Vue compatibility
 * - Renders accessible completion summary toast
 */

(function () {
  'use strict';

  // Prevent multiple injections
  if (window.__AccessFillInjected) return;
  window.__AccessFillInjected = true;

  // Accessible Translations (English & Hindi)
  const TRANSLATIONS = {
    en: {
      consentTitle: "AccessFill: Sensitive Data Consent",
      consentBody: "The following sensitive fields were detected. Please grant permission before autofilling:",
      approveAll: "Approve & Fill All",
      fillNonSensitive: "Skip Sensitive Fields",
      cancel: "Cancel",
      toastTitle: "AccessFill Summary",
      toastFilled: (filled, total, remaining) => `Filled ${filled} of ${total} fields. ${remaining} fields need your input.`,
      toastNoFields: "No matching form fields were found on this page.",
      toastNotSignedIn: "Please sign in via AccessFill extension to autofill forms."
    },
    hi: {
      consentTitle: "AccessFill: संवेदनशील डेटा सहमति",
      consentBody: "निम्नलिखित संवेदनशील फ़ील्ड पहचाने गए। कृपया भरने से पहले अनुमति दें:",
      approveAll: "स्वीकृत करें और सभी भरें",
      fillNonSensitive: "संवेदनशील छोड़ें",
      cancel: "रद्द करें",
      toastTitle: "AccessFill सारांश",
      toastFilled: (filled, total, remaining) => `${total} में से ${filled} फ़ील्ड भरे गए। ${remaining} फ़ील्ड में आपके इनपुट की आवश्यकता है।`,
      toastNoFields: "इस पृष्ठ पर कोई मेल खाने वाले फ़ील्ड नहीं मिले।",
      toastNotSignedIn: "ऑटोफ़िल करने के लिए कृपया AccessFill एक्सटेंशन में साइन इन करें।"
    }
  };

  /**
   * Native Input Value Setter Workaround for React / Vue / Angular compatibility
   */
  function setNativeValue(element, value) {
    if (!element || value === undefined || value === null) return;

    // For SELECT elements
    if (element.tagName === 'SELECT') {
      let optionToSelect = Array.from(element.options).find(opt => 
        opt.value.toLowerCase() === String(value).toLowerCase() || 
        opt.text.toLowerCase().includes(String(value).toLowerCase())
      );
      if (optionToSelect) {
        element.value = optionToSelect.value;
      } else if (element.options.length > 0) {
        element.value = value;
      }
    } else {
      // For INPUT and TEXTAREA elements
      const valueSetter = Object.getOwnPropertyDescriptor(element, 'value');
      const prototype = Object.getPrototypeOf(element);
      const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value');

      if (prototypeValueSetter && valueSetter && valueSetter.set !== prototypeValueSetter.set) {
        prototypeValueSetter.set.call(element, value);
      } else if (valueSetter && valueSetter.set) {
        valueSetter.set.call(element, value);
      } else {
        element.value = value;
      }
    }

    // Dispatch native events so modern frontend frameworks register state changes
    element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new Event('blur', { bubbles: true, cancelable: true }));
  }

  /**
   * Scans current document for matchable form fields
   */
  function scanPageFields() {
    if (!window.AccessFillMatcher) {
      console.error("[AccessFill Content] AccessFillMatcher module is missing.");
      return { totalControls: 0, matchedCount: 0, matches: [] };
    }

    const formControls = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="file"]), select, textarea');
    const matches = [];

    formControls.forEach((el, index) => {
      // Assign a temporary unique DOM identifier if needed
      if (!el.dataset.accessfillId) {
        el.dataset.accessfillId = 'af-field-' + index + '-' + Date.now();
      }

      const matchResult = window.AccessFillMatcher.matchField(el);
      if (matchResult && matchResult.fieldKey) {
        matches.push({
          element: el,
          elementId: el.dataset.accessfillId,
          match: matchResult
        });
      }
    });

    return {
      totalControls: formControls.length,
      matchedCount: matches.length,
      matches: matches
    };
  }

  /**
   * Masks sensitive strings for consent preview (e.g. Aadhaar: XXXX-XXXX-4738)
   */
  function maskPreview(fieldKey, value) {
    if (!value) return '***';
    const str = String(value);
    if (fieldKey === 'aadhaar_number') {
      const clean = str.replace(/[\s-]/g, '');
      return 'XXXX-XXXX-' + (clean.slice(-4) || '****');
    }
    if (fieldKey === 'pan_number') {
      return 'XXXXXX' + (str.slice(-4) || '****');
    }
    if (fieldKey === 'phone') {
      return 'XXXXXX' + (str.slice(-4) || '****');
    }
    return '*****';
  }

  /**
   * Displays accessible on-page Consent Dialog for sensitive fields
   */
  function showConsentDialog(sensitiveMatches, profile, lang, onApproveAll, onSkipSensitive) {
    // Remove any existing dialog
    const existing = document.getElementById('accessfill-consent-modal');
    if (existing) existing.remove();

    const t = TRANSLATIONS[lang] || TRANSLATIONS['en'];

    const modalOverlay = document.createElement('div');
    modalOverlay.id = 'accessfill-consent-modal';
    modalOverlay.className = 'accessfill-modal-overlay';
    modalOverlay.setAttribute('role', 'dialog');
    modalOverlay.setAttribute('aria-modal', 'true');
    modalOverlay.setAttribute('aria-labelledby', 'accessfill-modal-title');

    const fieldsListHtml = sensitiveMatches.map(m => {
      const fieldName = m.match.fieldKey.replace(/_/g, ' ').toUpperCase();
      const maskedVal = maskPreview(m.match.fieldKey, profile[m.match.fieldKey]);
      return `
        <li class="accessfill-sensitive-item">
          <span class="accessfill-field-name">🔒 ${fieldName}</span>
          <span class="accessfill-field-preview">${maskedVal}</span>
        </li>
      `;
    }).join('');

    modalOverlay.innerHTML = `
      <div class="accessfill-modal-card">
        <div class="accessfill-modal-header">
          <div class="accessfill-badge-icon">🛡️</div>
          <h2 id="accessfill-modal-title">${t.consentTitle}</h2>
        </div>
        <p class="accessfill-modal-body">${t.consentBody}</p>
        <ul class="accessfill-sensitive-list">
          ${fieldsListHtml}
        </ul>
        <div class="accessfill-modal-actions">
          <button id="accessfill-btn-approve" class="accessfill-btn accessfill-btn-primary">${t.approveAll}</button>
          <button id="accessfill-btn-skip" class="accessfill-btn accessfill-btn-secondary">${t.fillNonSensitive}</button>
          <button id="accessfill-btn-cancel" class="accessfill-btn accessfill-btn-ghost">${t.cancel}</button>
        </div>
      </div>
    `;

    document.body.appendChild(modalOverlay);

    // Keyboard accessibility focus
    const approveBtn = document.getElementById('accessfill-btn-approve');
    approveBtn.focus();

    approveBtn.addEventListener('click', () => {
      modalOverlay.remove();
      onApproveAll();
    });

    document.getElementById('accessfill-btn-skip').addEventListener('click', () => {
      modalOverlay.remove();
      onSkipSensitive();
    });

    document.getElementById('accessfill-btn-cancel').addEventListener('click', () => {
      modalOverlay.remove();
    });

    // Close on Escape key
    modalOverlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') modalOverlay.remove();
    });
  }

  /**
   * Displays bottom-right Accessible Summary Toast Banner
   */
  function showSummaryToast(filledCount, totalControls, lang) {
    const existing = document.getElementById('accessfill-toast');
    if (existing) existing.remove();

    const t = TRANSLATIONS[lang] || TRANSLATIONS['en'];
    const remaining = Math.max(0, totalControls - filledCount);

    const toast = document.createElement('div');
    toast.id = 'accessfill-toast';
    toast.className = 'accessfill-toast-container';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');

    const messageText = filledCount > 0 
      ? t.toastFilled(filledCount, totalControls, remaining)
      : t.toastNoFields;

    toast.innerHTML = `
      <div class="accessfill-toast-icon">✨</div>
      <div class="accessfill-toast-content">
        <strong>${t.toastTitle}</strong>
        <span>${messageText}</span>
      </div>
      <button id="accessfill-toast-close" aria-label="Close Notification" class="accessfill-toast-close">&times;</button>
    `;

    document.body.appendChild(toast);

    document.getElementById('accessfill-toast-close').addEventListener('click', () => {
      toast.remove();
    });

    // Auto-dismiss after 8 seconds
    setTimeout(() => {
      if (document.body.contains(toast)) {
        toast.classList.add('accessfill-toast-fade');
        setTimeout(() => toast.remove(), 400);
      }
    }, 8000);
  }

  /**
   * Execute Form Autofill Logic
   */
  async function executeFormFill(profile) {
    const lang = profile?.preferred_language || 'en';
    const scan = scanPageFields();

    if (scan.matchedCount === 0) {
      showSummaryToast(0, scan.totalControls, lang);
      return { filled: 0, total: scan.totalControls };
    }

    // Separate sensitive matches vs standard matches
    const sensitiveMatches = scan.matches.filter(m => m.match.isSensitive && profile[m.match.fieldKey]);
    const standardMatches = scan.matches.filter(m => !m.match.isSensitive && profile[m.match.fieldKey]);

    const doFill = (itemsToFill) => {
      let filledCounter = 0;
      itemsToFill.forEach(item => {
        const val = profile[item.match.fieldKey];
        if (val !== undefined && val !== null) {
          setNativeValue(item.element, val);
          
          // Visual highlight animation for accessibility
          item.element.classList.add('accessfill-field-highlight');
          setTimeout(() => {
            item.element.classList.remove('accessfill-field-highlight');
          }, 2000);

          filledCounter++;
        }
      });

      showSummaryToast(filledCounter, scan.totalControls, lang);
      return filledCounter;
    };

    // If sensitive fields are detected and present in user profile, ask consent first!
    if (sensitiveMatches.length > 0) {
      showConsentDialog(
        sensitiveMatches,
        profile,
        lang,
        // On Approve All
        () => {
          doFill([...standardMatches, ...sensitiveMatches]);
        },
        // On Skip Sensitive
        () => {
          doFill(standardMatches);
        }
      );
    } else {
      // No sensitive fields detected, fill standard directly
      doFill(standardMatches);
    }

    return { matched: scan.matchedCount, total: scan.totalControls };
  }

  /**
   * Highlight matched fields visually on page scan
   */
  function highlightMatchedFields() {
    const scan = scanPageFields();
    scan.matches.forEach(item => {
      item.element.classList.add('accessfill-field-detected');
      setTimeout(() => {
        item.element.classList.remove('accessfill-field-detected');
      }, 3000);
    });
    return scan;
  }

  // Chrome Extension Message Listener
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'SCAN_PAGE') {
      const scan = highlightMatchedFields();
      sendResponse({
        success: true,
        totalControls: scan.totalControls,
        matchedCount: scan.matchedCount,
        details: scan.matches.map(m => ({
          fieldKey: m.match.fieldKey,
          confidence: m.match.confidence,
          layer: m.match.layer,
          isSensitive: m.match.isSensitive,
          matchedBy: m.match.matchedBy
        }))
      });
      return true;
    }

    if (request.action === 'EXECUTE_FILL') {
      executeFormFill(request.profile).then(result => {
        sendResponse({ success: true, ...result });
      }).catch(err => {
        sendResponse({ success: false, error: err.message });
      });
      return true;
    }
  });

  console.log('[AccessFill Content Script] Initialized on page:', window.location.href);

})();
