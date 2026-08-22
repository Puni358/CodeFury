/* ================================================================
   AccessFill — field-explain.js
   Reusable “Explain this” popover + Web Speech read-aloud.
   Attach to any form: AF.attachFieldExplanations(rootEl)
================================================================= */

(function () {
  'use strict';

  const FIELD_EXPLANATIONS = {
    full_name: {
      en: "Enter your complete name as it appears on official ID, including first and last name.",
      kn: "ಅಧಿಕೃತ ಗುರುತಿನ ಚೀಟಿಯಲ್ಲಿರುವಂತೆ ನಿಮ್ಮ ಪೂರ್ಣ ಹೆಸರನ್ನು, ಮೊದಲ ಮತ್ತು ಕೊನೆಯ ಹೆಸರನ್ನು ಸೇರಿಸಿ ಬರೆಯಿರಿ."
    },
    email: {
      en: "This is the email address people and offices can use to send you messages.",
      kn: "ಜನರು ಮತ್ತು ಕಚೇರಿಗಳು ನಿಮಗೆ ಸಂದೇಶ ಕಳುಹಿಸಲು ಬಳಸುವ ಇಮೇಲ್ ವಿಳಾಸ ಇದು."
    },
    phone: {
      en: "Your 10-digit mobile number, without the country code. Use the number you can receive calls and SMS on.",
      kn: "ದೇಶದ ಕೋಡ್ ಇಲ್ಲದೆ ನಿಮ್ಮ 10-ಅಂಕಿಯ ಮೊಬೈಲ್ ಸಂಖ್ಯೆ. ಕರೆ ಮತ್ತು SMS ಸಿಗುವ ಸಂಖ್ಯೆಯನ್ನು ನೀಡಿ."
    },
    date_of_birth: {
      en: "The day you were born, as written on your birth certificate or Aadhaar card.",
      kn: "ನಿಮ್ಮ ಜನ್ಮ ಪ್ರಮಾಣಪತ್ರ ಅಥವಾ ಆಧಾರ್ ಕಾರ್ಡ್‌ನಲ್ಲಿ ಬರೆದಿರುವಂತೆ ನೀವು ಹುಟ್ಟಿದ ದಿನಾಂಕ."
    },
    address_line1: {
      en: "The first line of where you live — usually house or flat number and street name.",
      kn: "ನೀವು ವಾಸಿಸುವ ಸ್ಥಳದ ಮೊದಲ ಸಾಲು — ಸಾಮಾನ್ಯವಾಗಿ ಮನೆ ಅಥವಾ ಫ್ಲಾಟ್ ಸಂಖ್ಯೆ ಮತ್ತು ರಸ್ತೆಯ ಹೆಸರು."
    },
    address_line2: {
      en: "Extra address detail if needed, such as area, landmark, or building name.",
      kn: "ಬೇಕಾದರೆ ಹೆಚ್ಚುವರಿ ವಿಳಾಸ — ಪ್ರದೇಶ, ಗುರುತಿನ ಸ್ಥಳ ಅಥವಾ ಕಟ್ಟಡದ ಹೆಸರು."
    },
    address: {
      en: "Your full residential address as printed on the document.",
      kn: "ದಾಖಲೆಯಲ್ಲಿ ಮುದ್ರಿತವಾಗಿರುವಂತೆ ನಿಮ್ಮ ಪೂರ್ಣ ವಸತಿ ವಿಳಾಸ."
    },
    city: {
      en: "The city or town where you currently live.",
      kn: "ನೀವು ಈಗ ವಾಸಿಸುವ ನಗರ ಅಥವಾ ಊರು."
    },
    state: {
      en: "The Indian state or union territory where you live, for example Karnataka.",
      kn: "ನೀವು ವಾಸಿಸುವ ಭಾರತದ ರಾಜ್ಯ ಅಥವಾ ಕೇಂದ್ರಾಡಳಿತ ಪ್ರದೇಶ, ಉದಾಹರಣೆಗೆ ಕರ್ನಾಟಕ."
    },
    zip: {
      en: "Your 6-digit PIN code used by India Post to find your area.",
      kn: "ಭಾರತೀಯ ಅಂಚೆ ನಿಮ್ಮ ಪ್ರದೇಶವನ್ನು ಹುಡುಕಲು ಬಳಸುವ 6-ಅಂಕಿಯ ಪಿನ್ ಕೋಡ್."
    },
    aadhaar_number: {
      en: "This is your unique 12-digit Aadhaar ID number, given by the Indian government. You can find it on your Aadhaar card.",
      kn: "ಇದು ನಿಮ್ಮ ವಿಶಿಷ್ಟ 12-ಅಂಕಿಯ ಆಧಾರ್ ಗುರುತಿನ ಸಂಖ್ಯೆ, ಭಾರತ ಸರ್ಕಾರ ನೀಡಿದ್ದು. ಇದನ್ನು ನಿಮ್ಮ ಆಧಾರ್ ಕಾರ್ಡ್‌ನಲ್ಲಿ ಕಾಣಬಹುದು."
    },
    pan_number: {
      en: "Your 10-character Permanent Account Number from the Income Tax Department, printed on your PAN card.",
      kn: "ಆದಾಯ ತೆರಿಗೆ ಇಲಾಖೆ ನೀಡಿದ 10-ಅಕ್ಷರದ ಪ್ಯಾನ್ ಸಂಖ್ಯೆ. ಇದು ನಿಮ್ಮ ಪ್ಯಾನ್ ಕಾರ್ಡ್‌ನಲ್ಲಿ ಮುದ್ರಿತವಾಗಿರುತ್ತದೆ."
    },
    emergency_contact_name: {
      en: "The name of someone we can contact if there is an emergency — often a family member.",
      kn: "ತುರ್ತು ಪರಿಸ್ಥಿತಿಯಲ್ಲಿ ಸಂಪರ್ಕಿಸಬಹುದಾದ ವ್ಯಕ್ತಿಯ ಹೆಸರು — ಸಾಮಾನ್ಯವಾಗಿ ಕುಟುಂಬದ ಸದಸ್ಯ."
    },
    emergency_contact_phone: {
      en: "The 10-digit phone number of your emergency contact, so they can be reached quickly.",
      kn: "ತುರ್ತು ಸಂಪರ್ಕದವರ 10-ಅಂಕಿಯ ಫೋನ್ ಸಂಖ್ಯೆ, ಬೇಗ ಸಿಗುವಂತೆ."
    },
    preferred_language: {
      en: "The language you prefer for explanations and guidance on this site: English or Kannada.",
      kn: "ಈ ತಾಣದಲ್ಲಿ ವಿವರಣೆ ಮತ್ತು ಮಾರ್ಗದರ್ಶನಕ್ಕೆ ನೀವು ಬಯಸುವ ಭಾಷೆ: ಇಂಗ್ಲಿಷ್ ಅಥವಾ ಕನ್ನಡ."
    },
    document_type: {
      en: "What kind of document this photo is — Aadhaar, ration card, mark sheet, or other.",
      kn: "ಈ ಫೋಟೋ ಯಾವ ರೀತಿಯ ದಾಖಲೆ — ಆಧಾರ್, ರೇಷನ್ ಕಾರ್ಡ್, ಅಂಕಪಟ್ಟಿ ಅಥವಾ ಇತರೆ."
    }
  };

  const UI = {
    en: {
      explain: "Explain",
      explainAria: "Explain this field",
      readAloud: "Read aloud",
      generating: "Generating voice…",
      close: "Close",
      loading: "Getting a simple explanation…",
      voiceMissingKn: "Voice not available for Kannada on this device — showing text only",
      generic: function (label) {
        return "This field is asking for “" + label + "”. Enter the matching detail from your records.";
      }
    },
    kn: {
      explain: "ವಿವರಿಸಿ",
      explainAria: "ಈ ಕ್ಷೇತ್ರವನ್ನು ವಿವರಿಸಿ",
      readAloud: "ಗಟ್ಟಿಯಾಗಿ ಓದಿ",
      generating: "ಧ್ವನಿ ತಯಾರಾಗುತ್ತಿದೆ…",
      close: "ಮುಚ್ಚಿ",
      loading: "ಸರಳ ವಿವರಣೆ ತರಲಾಗುತ್ತಿದೆ…",
      voiceMissingKn: "ಈ ಸಾಧನದಲ್ಲಿ ಕನ್ನಡ ಧ್ವನಿ ಲಭ್ಯವಿಲ್ಲ — ಪಠ್ಯ ಮಾತ್ರ ತೋರಿಸಲಾಗುತ್ತಿದೆ",
      generic: function (label) {
        return "ಈ ಕ್ಷೇತ್ರ “" + label + "” ಕೇಳುತ್ತಿದೆ. ನಿಮ್ಮ ದಾಖಲೆಗಳಿಂದ ಹೊಂದುವ ವಿವರವನ್ನು ನಮೂದಿಸಿ.";
      }
    }
  };

  const geminiCache = Object.create(null);
  const ttsCache = Object.create(null);
  let popoverEl = null;
  let activeBtn = null;
  let voicesReady = false;
  let geminiAudio = null;
  let geminiAudioUrl = null;

  function prefsLang() {
    const raw = (window.AF && window.AF.readPrefs && window.AF.readPrefs().language) || 'en';
    return raw === 'kn' ? 'kn' : 'en';
  }

  function ui() {
    return UI[prefsLang()] || UI.en;
  }

  function escapeHtml(s) {
    if (window.AF && window.AF.escapeHtml) return window.AF.escapeHtml(s);
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fieldKeyFromControl(el) {
    return (el.getAttribute('data-explain-key') || el.getAttribute('name') || el.id || '')
      .replace(/^edit-/, '')
      .replace(/^rev-/, '')
      .replace(/-/g, '_');
  }

  function cssId(id) {
    if (window.CSS && CSS.escape) return CSS.escape(id);
    return String(id).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function labelTextFor(el) {
    if (el.id) {
      const lab = document.querySelector('label[for="' + cssId(el.id) + '"]');
      if (lab) return String(lab.textContent || '').trim();
    }
    const wrap = el.closest('label');
    if (wrap) return String(wrap.textContent || '').trim();
    return fieldKeyFromControl(el).replace(/_/g, ' ');
  }

  function resolveKnown(key) {
    if (FIELD_EXPLANATIONS[key]) return FIELD_EXPLANATIONS[key];
    const aliases = {
      fullname: 'full_name',
      dob: 'date_of_birth',
      aadhaar: 'aadhaar_number',
      pan: 'pan_number',
      address1: 'address_line1',
      address2: 'address_line2',
      language: 'preferred_language',
      emergency_name: 'emergency_contact_name',
      emergency_phone: 'emergency_contact_phone'
    };
    const mapped = aliases[key];
    return mapped ? FIELD_EXPLANATIONS[mapped] : null;
  }

  function ensureVoices() {
    return new Promise(function (resolve) {
      if (!window.speechSynthesis) {
        resolve([]);
        return;
      }
      const existing = speechSynthesis.getVoices();
      if (existing.length || voicesReady) {
        voicesReady = true;
        resolve(existing);
        return;
      }
      const done = function () {
        voicesReady = true;
        speechSynthesis.removeEventListener('voiceschanged', done);
        resolve(speechSynthesis.getVoices());
      };
      speechSynthesis.addEventListener('voiceschanged', done);
      setTimeout(done, 600);
    });
  }

  function findKannadaVoice(voices) {
    return (voices || []).find(function (v) {
      const lang = String(v.lang || '').toLowerCase();
      return lang === 'kn-in' || lang === 'kn' || lang.indexOf('kn-') === 0;
    }) || null;
  }

  function findEnglishVoice(voices) {
    return (voices || []).find(function (v) {
      return String(v.lang || '').toLowerCase().indexOf('en') === 0;
    }) || null;
  }

  function stopGeminiAudio() {
    if (geminiAudio) {
      try {
        geminiAudio.pause();
        geminiAudio.removeAttribute('src');
        geminiAudio.load();
      } catch (_) {}
    }
    if (geminiAudioUrl) {
      URL.revokeObjectURL(geminiAudioUrl);
      geminiAudioUrl = null;
    }
  }

  function b64ToBlob(b64, mime) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime || 'audio/wav' });
  }

  function playAudioBlob(blob) {
    stopGeminiAudio();
    if (window.speechSynthesis) speechSynthesis.cancel();
    geminiAudioUrl = URL.createObjectURL(blob);
    if (!geminiAudio) geminiAudio = new Audio();
    geminiAudio.src = geminiAudioUrl;
    const play = geminiAudio.play();
    if (play && typeof play.catch === 'function') play.catch(function () {});
  }

  function setSpeakBusy(busy) {
    const btn = document.getElementById('af-explain-speak');
    if (!btn) return;
    const label = btn.querySelector('[data-af-speak-label]');
    btn.disabled = !!busy;
    if (label) label.textContent = busy ? ui().generating : ui().readAloud;
  }

  async function speakViaBrowser(text, lang, noteEl) {
    if (!window.speechSynthesis) {
      if (noteEl) {
        noteEl.hidden = false;
        noteEl.textContent = lang === 'kn'
          ? ui().voiceMissingKn
          : 'Voice not available on this device — showing text only';
      }
      return;
    }
    speechSynthesis.cancel();
    const voices = await ensureVoices();
    const utterance = new SpeechSynthesisUtterance(text);
    if (lang === 'kn') {
      const knVoice = findKannadaVoice(voices);
      if (!knVoice) {
        if (noteEl) {
          noteEl.hidden = false;
          noteEl.textContent = ui().voiceMissingKn;
        }
        const enVoice = findEnglishVoice(voices);
        utterance.lang = 'en-US';
        if (enVoice) utterance.voice = enVoice;
      } else {
        if (noteEl) noteEl.hidden = true;
        utterance.lang = knVoice.lang || 'kn-IN';
        utterance.voice = knVoice;
      }
    } else {
      if (noteEl) noteEl.hidden = true;
      utterance.lang = 'en-US';
      const enVoice = findEnglishVoice(voices);
      if (enVoice) utterance.voice = enVoice;
    }
    try {
      speechSynthesis.speak(utterance);
    } catch (_) {
      if (noteEl) {
        noteEl.hidden = false;
        noteEl.textContent = 'Voice not available on this device — showing text only';
      }
    }
  }

  async function speakText(text, lang, noteEl) {
    const clipped = String(text || '').trim();
    if (!clipped) return;
    stopGeminiAudio();
    if (window.speechSynthesis) speechSynthesis.cancel();

    const cacheKey = lang + '::' + clipped;
    const cached = ttsCache[cacheKey];
    if (cached && cached.b64) {
      playAudioBlob(b64ToBlob(cached.b64, cached.mime));
      return;
    }

    const sb = window.AccessFillSupabase;
    if (sb && typeof sb.invokeTextToSpeech === 'function') {
      setSpeakBusy(true);
      try {
        const result = await sb.invokeTextToSpeech({ text: clipped, language: lang });
        if (result && result.success && result.audioBase64) {
          ttsCache[cacheKey] = { b64: result.audioBase64, mime: result.mimeType || 'audio/wav' };
          playAudioBlob(b64ToBlob(result.audioBase64, result.mimeType));
          setSpeakBusy(false);
          return;
        }
        console.log('[AccessFill TTS] gemini unavailable, using browser voice', {
          error: result && result.error,
          demo: result && result.demo
        });
      } catch (err) {
        if (sb.sanitizeLogPayload) {
          console.error('[AccessFill TTS] playback failed', sb.sanitizeLogPayload(err));
        }
      }
      setSpeakBusy(false);
    }

    await speakViaBrowser(clipped, lang, noteEl);
  }

  async function getExplanation(key, label) {
    const lang = prefsLang();
    const known = resolveKnown(key);
    if (known) return { text: known[lang] || known.en, source: 'local' };

    const cacheKey = lang + '::' + key + '::' + label;
    if (geminiCache[cacheKey]) return { text: geminiCache[cacheKey], source: 'cache' };

    const strings = ui();
    const sb = window.AccessFillSupabase;
    if (sb && typeof sb.invokeExplainFormField === 'function') {
      const result = await sb.invokeExplainFormField({
        fieldKey: key,
        fieldLabel: label,
        language: lang
      });
      if (result && result.success && result.explanation) {
        geminiCache[cacheKey] = result.explanation;
        return { text: result.explanation, source: 'gemini' };
      }
    }
    return { text: strings.generic(label || key.replace(/_/g, ' ')), source: 'fallback' };
  }

  function ensurePopover() {
    if (popoverEl) return popoverEl;
    popoverEl = document.createElement('div');
    popoverEl.id = 'af-explain-popover';
    popoverEl.className = 'af-explain-popover';
    popoverEl.setAttribute('role', 'dialog');
    popoverEl.setAttribute('aria-modal', 'false');
    popoverEl.hidden = true;
    popoverEl.innerHTML =
      '<div class="af-explain-popover-head">' +
        '<p class="af-explain-popover-title" id="af-explain-title"></p>' +
        '<button type="button" class="af-explain-close" data-af-explain-close aria-label="Close">' +
          '<span class="material-symbols-outlined" aria-hidden="true">close</span>' +
        '</button>' +
      '</div>' +
      '<p class="af-explain-body" id="af-explain-body"></p>' +
      '<p class="af-explain-note" id="af-explain-note" hidden></p>' +
      '<button type="button" class="af-explain-speak" id="af-explain-speak">' +
        '<span class="material-symbols-outlined" aria-hidden="true">volume_up</span>' +
        '<span data-af-speak-label></span>' +
      '</button>';
    document.body.appendChild(popoverEl);

    popoverEl.querySelector('[data-af-explain-close]').addEventListener('click', closePopover);
    popoverEl.querySelector('#af-explain-speak').addEventListener('click', function () {
      const body = document.getElementById('af-explain-body');
      const note = document.getElementById('af-explain-note');
      speakText(body.textContent || '', prefsLang(), note);
    });

    document.addEventListener('pointerdown', function (e) {
      if (popoverEl.hidden) return;
      if (popoverEl.contains(e.target)) return;
      if (activeBtn && activeBtn.contains(e.target)) return;
      closePopover();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !popoverEl.hidden) closePopover();
    });
    window.addEventListener('resize', function () {
      if (!popoverEl.hidden && activeBtn) positionPopover(activeBtn);
    });
    return popoverEl;
  }

  function positionPopover(btn) {
    const rect = btn.getBoundingClientRect();
    const pad = 8;
    const width = Math.min(360, window.innerWidth - pad * 2);
    popoverEl.style.width = width + 'px';
    let top = rect.bottom + pad + window.scrollY;
    let left = rect.left + window.scrollX;
    const maxLeft = window.scrollX + window.innerWidth - width - pad;
    if (left > maxLeft) left = Math.max(window.scrollX + pad, maxLeft);
    if (left < window.scrollX + pad) left = window.scrollX + pad;
    popoverEl.style.top = top + 'px';
    popoverEl.style.left = left + 'px';
    requestAnimationFrame(function () {
      const box = popoverEl.getBoundingClientRect();
      if (box.bottom > window.innerHeight - pad) {
        const above = rect.top + window.scrollY - box.height - pad;
        if (above > window.scrollY) popoverEl.style.top = above + 'px';
      }
    });
  }

  function closePopover() {
    if (!popoverEl) return;
    stopGeminiAudio();
    if (window.speechSynthesis) speechSynthesis.cancel();
    setSpeakBusy(false);
    popoverEl.hidden = true;
    if (activeBtn) {
      activeBtn.setAttribute('aria-expanded', 'false');
      activeBtn.focus();
    }
    activeBtn = null;
  }

  async function openPopover(btn, control) {
    const strings = ui();
    const key = fieldKeyFromControl(control);
    const label = labelTextFor(control);
    console.log('[AccessFill Explain] open', { field_key: key });

    ensurePopover();
    if (activeBtn === btn && !popoverEl.hidden) {
      closePopover();
      return;
    }
    activeBtn = btn;
    btn.setAttribute('aria-expanded', 'true');
    popoverEl.querySelector('#af-explain-title').textContent = strings.explain + ': ' + label;
    popoverEl.querySelector('#af-explain-body').textContent = strings.loading;
    popoverEl.querySelector('#af-explain-note').hidden = true;
    popoverEl.querySelector('[data-af-speak-label]').textContent = strings.readAloud;
    popoverEl.querySelector('[data-af-explain-close]').setAttribute('aria-label', strings.close);
    popoverEl.hidden = false;
    positionPopover(btn);

    const voices = await ensureVoices();
    if (prefsLang() === 'kn' && !findKannadaVoice(voices)) {
      const note = popoverEl.querySelector('#af-explain-note');
      note.hidden = false;
      note.textContent = strings.voiceMissingKn;
    }

    try {
      const result = await getExplanation(key, label);
      popoverEl.querySelector('#af-explain-body').textContent = result.text;
      positionPopover(btn);
    } catch (err) {
      const sb = window.AccessFillSupabase;
      if (sb && sb.sanitizeLogPayload) {
        console.error('[AccessFill Explain] lookup failed', sb.sanitizeLogPayload(err));
      }
      popoverEl.querySelector('#af-explain-body').textContent = strings.generic(label);
    }
  }

  function makeButton() {
    const strings = ui();
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'af-explain-btn';
    btn.setAttribute('aria-label', strings.explainAria);
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.innerHTML =
      '<span class="material-symbols-outlined" aria-hidden="true">info</span>' +
      '<span class="af-explain-btn-text">' + escapeHtml(strings.explain) + '</span>';
    return btn;
  }

  function skipControl(el) {
    if (!el || el.disabled) return true;
    if (el.closest('.af-explain-btn')) return true;
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (['hidden', 'file', 'submit', 'button', 'checkbox', 'radio', 'range'].indexOf(type) >= 0) return true;
    return false;
  }

  function attachFieldExplanations(root) {
    const scope = root || document;
    const controls = scope.querySelectorAll('input, select, textarea');
    controls.forEach(function (el) {
      if (skipControl(el)) return;
      if (el.dataset.afExplainAttached === '1') return;
      el.dataset.afExplainAttached = '1';

      let label = el.id ? document.querySelector('label[for="' + cssId(el.id) + '"]') : null;
      if (!label) label = el.closest('div') && el.closest('div').querySelector('label');
      if (!label) return;

      const btn = makeButton();
      if (!label.parentElement.classList.contains('af-explain-label-row')) {
        const row = document.createElement('div');
        row.className = 'af-explain-label-row';
        label.parentNode.insertBefore(row, label);
        row.appendChild(label);
        row.appendChild(btn);
      } else {
        label.parentElement.appendChild(btn);
      }

      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        openPopover(btn, el);
      });
    });
  }

  function refreshExplainLanguage() {
    document.querySelectorAll('.af-explain-btn').forEach(function (btn) {
      const strings = ui();
      btn.setAttribute('aria-label', strings.explainAria);
      const text = btn.querySelector('.af-explain-btn-text');
      if (text) text.textContent = strings.explain;
    });
  }

  if (window.AF) {
    window.AF.FIELD_EXPLANATIONS = FIELD_EXPLANATIONS;
    window.AF.attachFieldExplanations = attachFieldExplanations;
    window.AF.refreshExplainLanguage = refreshExplainLanguage;
  }

  if (typeof speechSynthesis !== 'undefined') {
    speechSynthesis.addEventListener('voiceschanged', function () {
      voicesReady = true;
    });
  }
})();
