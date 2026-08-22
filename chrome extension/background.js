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

    case 'MATCH_WITH_GEMINI': {
      chrome.storage.local.get(['geminiApiKey'], async (result) => {
        const apiKey = result.geminiApiKey;
        if (!apiKey) {
          sendResponse({ success: false, error: 'No Gemini API key configured' });
          return;
        }

        const unmatchedFields = Array.isArray(request.unmatchedFields) ? request.unmatchedFields : [];
        const availableKeys = Array.isArray(request.availableKeys) ? request.availableKeys : [];
        const prompt = [
          'Match each unmatched form field to the available profile key.',
          'For each field, return the single best matching key from availableKeys, or null if no key is a confident match.',
          'Do not guess - return null rather than a low-confidence match.',
          'Return ONLY a raw JSON object like {"field_0":"phone","field_1":null}.',
          `Unmatched fields: ${JSON.stringify(unmatchedFields)}`,
          `availableKeys: ${JSON.stringify(availableKeys)}`
        ].join('\n');

        try {
          const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + encodeURIComponent(apiKey), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { responseMimeType: 'application/json' }
            })
          });

          if (!response.ok) {
            sendResponse({ success: false, error: 'Gemini matching unavailable - falling back to unmatched' });
            return;
          }

          const data = await response.json();
          const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
          const cleanText = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
          const parsed = JSON.parse(cleanText);
          const mapping = {};
          const allowedKeys = new Set(availableKeys);
          unmatchedFields.forEach(field => {
            const value = parsed[field.fieldId];
            mapping[field.fieldId] = value === null || allowedKeys.has(value) ? value ?? null : null;
          });

          console.log('[AccessFill Background] Gemini matching completed:', sanitizeLogPayload({ unmatchedFields, mapping }));
          sendResponse({ success: true, mapping });
        } catch (error) {
          console.warn('[AccessFill Background] Gemini matching failed:', error.message);
          sendResponse({ success: false, error: 'Gemini matching unavailable - falling back to unmatched' });
        }
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
