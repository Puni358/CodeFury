/**
 * AccessFill - Intelligent Field Matching Engine (3-Layer Architecture)
 * 
 * Layer 1: Direct HTML Attribute Match (autocomplete, name, id)
 * Layer 2: Fuzzy Label & Context Match (labels, placeholders, aria-labels, nearby text with English/Hindi dictionary)
 * Layer 3: Fallback Stub for LLM Schema Extraction
 */

(function (global) {
  'use strict';

  // Synonym Dictionary supporting English and Hindi (Bilingual accessibility)
  const SYNONYM_DICTIONARY = {
    full_name: [
      "name", "full name", "applicant name", "first name", "last name",
      "candidate name", "person name", "your name", "full_name", "fullname",
      "नाम", "पूरा नाम", "आवेदक का नाम", "उम्मीदवार का नाम", "प्रथम नाम", "अंतिम नाम"
    ],
    email: [
      "email", "email address", "e-mail", "mail id", "email_address",
      "ईमेल", "ईमेल पता"
    ],
    aadhaar_number: [
      "aadhaar", "aadhar", "uid", "uidai", "aadhaar number", "aadhar card",
      "12 digit aadhaar", "aadhaar no", "aadhar no", "aadhaar_number", "aadharno",
      "आधार", "आधार संख्या", "आधार नंबर", "आधार कार्ड", "यूआईडी"
    ],
    pan_number: [
      "pan", "pan number", "permanent account number", "pan card", "pan no",
      "pan_number", "pancard", "panno",
      "पैन", "पैन नंबर", "पैन कार्ड", "स्थायी खाता संख्या"
    ],
    phone: [
      "phone", "mobile", "contact number", "phone number", "mobile number",
      "cell", "telephone", "contact no", "phone_number", "mobile_no",
      "फोन", "मोबाइल", "संपर्क नंबर", "मोबाइल नंबर", "दूरभाष"
    ],
    date_of_birth: [
      "dob", "date of birth", "birth date", "birthday", "date_of_birth",
      "जन्म तिथि", "जन्म तारीख"
    ],
    address_line1: [
      "address", "street address", "residential address", "house no",
      "address line 1", "full address", "location", "street", "address_line1",
      "पता", "आवासीय पता", "मकान नंबर", "पूरा पता", "सड़क का नाम"
    ],
    address_line2: [
      "address line 2", "street address 2", "locality", "landmark", "address_line2"
    ],
    city: [
      "city", "town", "district", "city name", "city_name",
      "शहर", "नगर", "जिला"
    ],
    state: [
      "state", "province", "region", "state name",
      "राज्य", "प्रांत"
    ],
    zip: [
      "zip", "pin", "pincode", "postal code", "zip code", "area pin", "postcode",
      "पिन कोड", "डाक कोड", "पिन"
    ],
    emergency_contact_name: [
      "emergency contact name", "guardian name", "next of kin name", "emergency contact person", "emergency_contact_name",
      "आपातकालीन संपर्क नाम", "संरक्षक का नाम"
    ],
    emergency_contact_phone: [
      "emergency contact", "emergency phone", "guardian contact", "next of kin",
      "emergency number", "emergency_contact", "kin contact", "emergency_contact_phone",
      "आपातकालीन संपर्क", "इमरजेंसी नंबर", "संरक्षक का नंबर"
    ],
    medical_info: [
      "medical condition", "allergies", "blood group", "medical info",
      "health status", "medical details", "medical_info", "medical history",
      "स्वास्थ्य स्थिति", "रक्त समूह", "चिकित्सा विवरण", "एलर्जी"
    ]
  };

  // Sensitivity registry - requires explicit user consent before autofilling
  const SENSITIVE_FIELDS = ['aadhaar_number', 'pan_number', 'emergency_contact_phone', 'medical_info'];

  // Direct HTML autocomplete standard mappings
  const AUTOCOMPLETE_MAP = {
    'name': 'full_name',
    'given-name': 'full_name',
    'family-name': 'full_name',
    'email': 'email',
    'tel': 'phone',
    'tel-national': 'phone',
    'bday': 'date_of_birth',
    'street-address': 'address_line1',
    'address-line1': 'address_line1',
    'address-line2': 'address_line2',
    'address-level2': 'city',
    'address-level1': 'state',
    'postal-code': 'zip'
  };

  /**
   * Helper: Normalize string for comparison
   */
  function normalizeText(text) {
    if (!text || typeof text !== 'string') return '';
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\u0900-\u097F\s]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Extract all textual context associated with a form field
   */
  function extractFieldContext(element) {
    const context = [];

    if (element.id) {
      try {
        const labels = document.querySelectorAll(`label[for="${element.id}"]`);
        labels.forEach(lbl => context.push(lbl.textContent));
      } catch (e) {}
    }

    const parentLabel = element.closest('label');
    if (parentLabel) {
      context.push(parentLabel.textContent);
    }

    if (element.placeholder) context.push(element.placeholder);
    if (element.getAttribute('aria-label')) context.push(element.getAttribute('aria-label'));
    
    const ariaLabelledBy = element.getAttribute('aria-labelledby');
    if (ariaLabelledBy) {
      const refEl = document.getElementById(ariaLabelledBy);
      if (refEl) context.push(refEl.textContent);
    }

    if (element.name) context.push(element.name);
    if (element.id) context.push(element.id);
    if (element.title) context.push(element.title);

    const prevSibling = element.previousElementSibling;
    if (prevSibling && (prevSibling.tagName === 'LABEL' || prevSibling.tagName === 'SPAN' || prevSibling.tagName === 'P')) {
      context.push(prevSibling.textContent);
    }

    const td = element.closest('td, th');
    if (td) {
      context.push(td.textContent);
    }

    return context.map(normalizeText).filter(t => t.length > 0);
  }

  /**
   * Layer 1: Direct HTML Attribute Matching
   */
  function matchLayer1(element) {
    const autocompleteVal = (element.getAttribute('autocomplete') || '').toLowerCase().trim();
    if (autocompleteVal && AUTOCOMPLETE_MAP[autocompleteVal]) {
      return {
        fieldKey: AUTOCOMPLETE_MAP[autocompleteVal],
        confidence: 0.98,
        layer: 1,
        matchedBy: `autocomplete="${autocompleteVal}"`
      };
    }

    const nameVal = normalizeText(element.name || '');
    const idVal = normalizeText(element.id || '');

    for (const key of Object.keys(SYNONYM_DICTIONARY)) {
      const cleanKey = normalizeText(key);
      if (nameVal === cleanKey || idVal === cleanKey) {
        return {
          fieldKey: key,
          confidence: 0.95,
          layer: 1,
          matchedBy: nameVal === cleanKey ? `name="${element.name}"` : `id="${element.id}"`
        };
      }
    }

    return null;
  }

  /**
   * Layer 2: Fuzzy Label & Synonym Matching
   */
  function matchLayer2(element) {
    const contexts = extractFieldContext(element);
    if (!contexts.length) return null;

    let bestMatch = null;
    let highestScore = 0;

    for (const [key, synonyms] of Object.entries(SYNONYM_DICTIONARY)) {
      for (const synonym of synonyms) {
        const normSynonym = normalizeText(synonym);
        if (!normSynonym) continue;

        for (const ctx of contexts) {
          if (ctx === normSynonym) {
            return {
              fieldKey: key,
              confidence: 0.92,
              layer: 2,
              matchedBy: `exact label/context match: "${synonym}"`
            };
          }

          const words = ctx.split(' ');
          const synWords = normSynonym.split(' ');
          const allWordsPresent = synWords.every(sw => words.includes(sw) || ctx.includes(sw));
          if (allWordsPresent) {
            const score = 0.70 + (synWords.length / Math.max(words.length, synWords.length)) * 0.20;
            if (score > highestScore) {
              highestScore = score;
              bestMatch = {
                fieldKey: key,
                confidence: parseFloat(score.toFixed(2)),
                layer: 2,
                matchedBy: `fuzzy match: "${synonym}" in "${ctx}"`
              };
            }
          }
        }
      }
    }

    if (bestMatch && highestScore >= 0.65) {
      return bestMatch;
    }

    return null;
  }

  /**
   * Layer 3: Fallback Stub
   */
  function matchLayer3(element) {
    const contexts = extractFieldContext(element);
    return {
      fieldKey: null,
      confidence: 0,
      layer: 3,
      note: "unmatched — could route to LLM matching",
      contexts: contexts
    };
  }

  /**
   * Main matching API entrypoint
   */
  function matchField(element) {
    if (!element || !(element instanceof HTMLElement)) {
      return null;
    }

    if (element.type === 'hidden' || element.type === 'submit' || element.type === 'button' || 
        element.type === 'reset' || element.type === 'file' || element.disabled) {
      return null;
    }

    const l1 = matchLayer1(element);
    if (l1) {
      l1.isSensitive = SENSITIVE_FIELDS.includes(l1.fieldKey);
      return l1;
    }

    const l2 = matchLayer2(element);
    if (l2) {
      l2.isSensitive = SENSITIVE_FIELDS.includes(l2.fieldKey);
      return l2;
    }

    const l3 = matchLayer3(element);
    l3.isSensitive = false;
    return l3;
  }

  const MatcherAPI = {
    matchField,
    matchLayer1,
    matchLayer2,
    matchLayer3,
    SYNONYM_DICTIONARY,
    SENSITIVE_FIELDS,
    normalizeText
  };

  global.AccessFillMatcher = MatcherAPI;

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
