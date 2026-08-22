/**
 * AccessFill - Service Worker / Background Script (Manifest V3)
 * 
 * Responsibilities:
 * - Manages token/session state sync across storage
 * - Acts as secure message relay between Popup and Content Scripts
 * - Redacts raw sensitive PII values in extension background logs
 */

// Helper to mask sensitive fields in console logs to ensure security/privacy
function sanitizeLogPayload(data) {
  if (!data || typeof data !== 'object') return data;
  const sensitiveKeys = ['aadhaar_number', 'pan_number', 'medical_info', 'emergency_contact'];
  const sanitized = { ...data };

  for (const key of Object.keys(sanitized)) {
    if (sensitiveKeys.includes(key) && typeof sanitized[key] === 'string') {
      sanitized[key] = '[REDACTED_PII]';
    } else if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
      sanitized[key] = sanitizeLogPayload(sanitized[key]);
    }
  }
  return sanitized;
}

// Service worker startup event
chrome.runtime.onInstalled.addListener(() => {
  console.log('[AccessFill Background] Extension installed/updated successfully.');
  // Set default settings if not already present
  chrome.storage.local.get(['preferredLanguage'], (result) => {
    if (!result.preferredLanguage) {
      chrome.storage.local.set({ preferredLanguage: 'en' });
    }
  });
});

// Central Message Relay Router
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const safePayload = sanitizeLogPayload(request);
  console.log('[AccessFill Background] Received message action:', request.action, safePayload);

  switch (request.action) {
    case 'GET_ACTIVE_TAB': {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0]) {
          sendResponse({ tab: tabs[0] });
        } else {
          sendResponse({ tab: null, error: 'No active tab found' });
        }
      });
      return true; // Keep message channel open for async response
    }

    case 'SCAN_CURRENT_TAB': {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || !tabs[0]) {
          sendResponse({ success: false, error: 'No active tab available' });
          return;
        }
        chrome.tabs.sendMessage(tabs[0].id, { action: 'SCAN_PAGE' }, (response) => {
          if (chrome.runtime.lastError) {
            console.warn('[AccessFill Background] Content script error:', chrome.runtime.lastError.message);
            sendResponse({ success: false, error: 'Content script not loaded on this tab. Refresh page to test.' });
            return;
          }
          // Update badge with detected field count
          if (response && typeof response.matchedCount === 'number') {
            const countText = response.matchedCount > 0 ? String(response.matchedCount) : '';
            chrome.action.setBadgeText({ tabId: tabs[0].id, text: countText });
            chrome.action.setBadgeBackgroundColor({ tabId: tabs[0].id, color: '#2563eb' });
          }
          sendResponse(response);
        });
      });
      return true;
    }

    case 'FILL_CURRENT_TAB': {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || !tabs[0]) {
          sendResponse({ success: false, error: 'No active tab available' });
          return;
        }
        chrome.tabs.sendMessage(tabs[0].id, { action: 'EXECUTE_FILL', profile: request.profile }, (response) => {
          if (chrome.runtime.lastError) {
            console.warn('[AccessFill Background] Content script error:', chrome.runtime.lastError.message);
            sendResponse({ success: false, error: 'Content script not loaded on this tab.' });
            return;
          }
          sendResponse(response);
        });
      });
      return true;
    }

    case 'UPDATE_BADGE': {
      if (sender.tab) {
        const text = request.count > 0 ? String(request.count) : '';
        chrome.action.setBadgeText({ tabId: sender.tab.id, text: text });
        chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: '#2563eb' });
      }
      sendResponse({ success: true });
      return false;
    }

    default:
      sendResponse({ success: false, error: 'Unknown action' });
      return false;
  }
});
