/* ================================================================
   AccessFill — chat-widget.js
   Floating AI assistant chat panel.

   Depends on (must be loaded before this script):
     - supabase-web.js  (window.AccessFillSupabase)
     - shared.js        (window.AF)

   Does NOT depend on field-explain.js. TTS is handled locally
   via AccessFillSupabase.invokeTextToSpeech + Web Audio, with
   speechSynthesis as a fallback — same pattern as field-explain.js
   but self-contained so this widget works on pages that don't load
   field-explain.js.
================================================================= */

(function () {
  'use strict';

  /* ── Constants ─────────────────────────────────────────────── */
  var MAX_HISTORY = 6;       // entries kept in context window
  var MAX_MSG_LEN = 1000;    // chars trimmed before sending

  /* ── In-memory state ────────────────────────────────────────── */
  var conversationHistory = [];   // {role:'user'|'assistant', content:string}[]
  // ttsState is lazily initialised via AF.makeTtsState() on first speak.
  // Keeping it separate from field-explain.js's state means the two never
  // clobber each other's audio element.
  var ttsState = null;
  var isOpen = false;
  var isSending = false;

  /* ── Helpers ────────────────────────────────────────────────── */
  function escHtml(s) {
    if (window.AF && window.AF.escapeHtml) return window.AF.escapeHtml(s);
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function lang() {
    return (window.AF && window.AF.readPrefs && window.AF.readPrefs().language) === 'kn' ? 'kn' : 'en';
  }

  function animsOn() {
    if (document.body && document.body.classList.contains('no-anim')) return false;
    var attr = document.documentElement.getAttribute('data-animations');
    if (attr === 'off') return false;
    if (window.matchMedia) return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return true;
  }

  /* ── TTS — delegates entirely to AF.speakText (shared.js) ──── */
  // All caching, voice loading, Gemini call, WAV decoding, and browser
  // fallback live in shared.js. chat-widget just manages its own audioState
  // so its playback never clobbers the field-explain popover's audio element.

  function updateTtsButtonUi(btn, isPlaying) {
    if (!btn) return;
    var icon = btn.querySelector('.material-symbols-outlined');
    if (isPlaying) {
      if (icon) icon.textContent = 'stop';
      btn.setAttribute('aria-label', 'Stop reading');
      btn.setAttribute('title', 'Stop reading');
      btn.classList.add('af-chat-speak-btn--playing');
    } else {
      if (icon) icon.textContent = 'volume_up';
      btn.setAttribute('aria-label', 'Read this message aloud');
      btn.setAttribute('title', 'Read aloud');
      btn.classList.remove('af-chat-speak-btn--playing');
    }
  }

  function updateAllTtsButtons(isPlaying, activeBtn) {
    var allBtns = document.querySelectorAll('.af-chat-speak-btn');
    allBtns.forEach(function (b) {
      if (isPlaying && b === activeBtn) {
        updateTtsButtonUi(b, true);
      } else {
        updateTtsButtonUi(b, false);
      }
    });
  }

  function _ensureTtsState() {
    if (!ttsState && window.AF && window.AF.makeTtsState) {
      ttsState = window.AF.makeTtsState();
      ttsState.onStateChange = function (isPlaying, activeBtn) {
        updateAllTtsButtons(isPlaying, activeBtn);
      };
    }
  }

  function stopTts() {
    _ensureTtsState();
    if (window.AF && window.AF.stopTtsState) window.AF.stopTtsState(ttsState);
    else if (window.speechSynthesis) speechSynthesis.cancel();
  }

  async function speakText(text, btn) {
    var clipped = String(text || '').trim();
    if (!clipped) return;
    _ensureTtsState();
    if (window.AF && typeof window.AF.speakText === 'function') {
      await window.AF.speakText(clipped, lang(), { audioState: ttsState, btn: btn || null });
    }
  }

  /* ── DOM helpers ────────────────────────────────────────────── */
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'className') node.className = attrs[k];
        else if (k === 'style') Object.assign(node.style, attrs[k]);
        else node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) {
      if (typeof c === 'string') node.appendChild(document.createTextNode(c));
      else if (c) node.appendChild(c);
    });
    return node;
  }

  /* ── Build the widget DOM ────────────────────────────────────── */
  var toggleBtn, panel, msgList, inputEl, sendBtn, charCount, langSelect;

  function buildWidget() {
    /* ── Toggle button (FAB) ────────────────────────────────── */
    toggleBtn = el('button', {
      id: 'af-chat-toggle',
      className: 'af-chat-toggle',
      'aria-label': 'Open AccessFill Assistant',
      'aria-expanded': 'false',
      'aria-haspopup': 'dialog',
      type: 'button',
    });
    toggleBtn.innerHTML =
      '<span class="material-symbols-outlined" aria-hidden="true" style="font-size:28px;font-variation-settings:\'FILL\' 1;">chat</span>';

    /* ── Panel ──────────────────────────────────────────────── */
    panel = el('div', {
      id: 'af-chat-panel',
      className: 'af-chat-panel',
      role: 'dialog',
      'aria-modal': 'false',
      'aria-label': 'AccessFill Assistant',
      hidden: '',
    });

    /* Header */
    var header = el('div', { className: 'af-chat-header' });
    var headerLeft = el('div', { className: 'af-chat-header-left' });
    var iconWrap = el('span', { className: 'af-chat-header-icon', 'aria-hidden': 'true' });
    iconWrap.innerHTML = '<span class="material-symbols-outlined" style="font-size:22px;font-variation-settings:\'FILL\' 1;">support_agent</span>';
    var titleEl = el('span', { className: 'af-chat-title' }, ['AccessFill Assistant']);
    headerLeft.appendChild(iconWrap);
    headerLeft.appendChild(titleEl);

    var headerRight = el('div', { className: 'af-chat-header-right' });

    /* Header Language selector */
    langSelect = el('select', {
      id: 'af-chat-lang-select',
      className: 'af-chat-lang-select',
      'aria-label': 'Chat Language',
    });
    var optEn = el('option', { value: 'en' }, ['EN']);
    var optKn = el('option', { value: 'kn' }, ['ಕನ್ನಡ']);
    langSelect.appendChild(optEn);
    langSelect.appendChild(optKn);
    langSelect.value = lang();

    langSelect.addEventListener('change', function () {
      var newLang = langSelect.value === 'kn' ? 'kn' : 'en';
      if (window.AF && window.AF.savePrefs) {
        window.AF.savePrefs({ language: newLang });
      }
    });

    var closeBtn = el('button', {
      id: 'af-chat-close',
      className: 'af-chat-close',
      type: 'button',
      'aria-label': 'Close assistant',
    });
    closeBtn.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true" style="font-size:22px;">close</span>';
    closeBtn.addEventListener('click', function () { setOpen(false); });

    headerRight.appendChild(langSelect);
    headerRight.appendChild(closeBtn);

    header.appendChild(headerLeft);
    header.appendChild(headerRight);

    /* Message list */
    msgList = el('div', {
      id: 'af-chat-messages',
      className: 'af-chat-messages',
      role: 'log',
      'aria-live': 'polite',
      'aria-label': 'Conversation',
    });

    /* Add opening assistant message */
    appendMessage('assistant',
      'Hi! I\'m the AccessFill Assistant. Ask me anything about how to use this app — saving your info, uploading documents, settings, or what a field means.');

    /* Composer */
    var composer = el('div', { className: 'af-chat-composer' });

    var inputRow = el('div', { className: 'af-chat-input-row' });

    inputEl = el('textarea', {
      id: 'af-chat-input',
      className: 'af-chat-input',
      placeholder: 'Ask a question…',
      rows: '1',
      maxlength: String(MAX_MSG_LEN),
      'aria-label': 'Message to AccessFill Assistant',
      'aria-describedby': 'af-chat-char-count',
    });

    sendBtn = el('button', {
      id: 'af-chat-send',
      className: 'af-chat-send',
      type: 'button',
      'aria-label': 'Send message',
      disabled: '',
    });
    sendBtn.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true" style="font-size:22px;font-variation-settings:\'FILL\' 1;">send</span>';

    inputRow.appendChild(inputEl);
    inputRow.appendChild(sendBtn);

    charCount = el('p', {
      id: 'af-chat-char-count',
      className: 'af-chat-char-count',
      'aria-live': 'off',
    }, ['0 / ' + MAX_MSG_LEN]);

    composer.appendChild(inputRow);
    composer.appendChild(charCount);

    panel.appendChild(header);
    panel.appendChild(msgList);
    panel.appendChild(composer);

    /* ── Wire events ────────────────────────────────────────── */
    toggleBtn.addEventListener('click', function () { setOpen(!isOpen); });

    inputEl.addEventListener('input', function () {
      autoResizeTextarea();
      var len = inputEl.value.length;
      charCount.textContent = len + ' / ' + MAX_MSG_LEN;
      sendBtn.disabled = len === 0 || isSending;
    });

    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!sendBtn.disabled) doSend();
      }
    });

    sendBtn.addEventListener('click', doSend);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen) setOpen(false);
    });

    document.body.appendChild(toggleBtn);
    document.body.appendChild(panel);
  }

  /* ── Auto-resize textarea (up to 5 lines) ───────────────────── */
  function autoResizeTextarea() {
    inputEl.style.height = 'auto';
    var max = parseInt(getComputedStyle(inputEl).lineHeight || '28', 10) * 5;
    inputEl.style.height = Math.min(inputEl.scrollHeight, max) + 'px';
  }

  /* ── Open / close ───────────────────────────────────────────── */
  function setOpen(open) {
    isOpen = open;
    if (open) {
      if (langSelect) langSelect.value = lang();
      panel.removeAttribute('hidden');
      toggleBtn.setAttribute('aria-expanded', 'true');
      toggleBtn.setAttribute('aria-label', 'Close AccessFill Assistant');
      if (animsOn()) panel.classList.add('af-chat-panel--visible');
      // Focus the input after a tick so the panel is painted
      setTimeout(function () { inputEl.focus(); }, 50);
      scrollToBottom(false);
    } else {
      stopTts();
      if (animsOn()) {
        panel.classList.remove('af-chat-panel--visible');
        // Keep in DOM until animation ends, then hide
        setTimeout(function () {
          if (!isOpen) panel.setAttribute('hidden', '');
        }, 220);
      } else {
        panel.setAttribute('hidden', '');
      }
      toggleBtn.setAttribute('aria-expanded', 'false');
      toggleBtn.setAttribute('aria-label', 'Open AccessFill Assistant');
      toggleBtn.focus();
    }
  }

  /* ── Message rendering ──────────────────────────────────────── */
  function scrollToBottom(smooth) {
    if (!msgList) return;
    if (smooth && animsOn()) {
      msgList.scrollTo({ top: msgList.scrollHeight, behavior: 'smooth' });
    } else {
      msgList.scrollTop = msgList.scrollHeight;
    }
  }

  function appendMessage(role, text) {
    var isAssistant = role === 'assistant';
    var row = el('div', {
      className: 'af-chat-row af-chat-row--' + role,
      role: 'group',
      'aria-label': isAssistant ? 'Assistant' : 'You',
    });

    var bubble = el('div', { className: 'af-chat-bubble af-chat-bubble--' + role });
    bubble.textContent = text;

    if (isAssistant) {
      var actions = el('div', { className: 'af-chat-bubble-actions' });
      var speakBtn = el('button', {
        className: 'af-chat-speak-btn',
        type: 'button',
        'aria-label': 'Read this message aloud',
        title: 'Read aloud',
      });
      speakBtn.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true" style="font-size:18px;font-variation-settings:\'FILL\' 1;">volume_up</span>';
      speakBtn.addEventListener('click', function () { speakText(text, speakBtn); });
      actions.appendChild(speakBtn);
      row.appendChild(bubble);
      row.appendChild(actions);
    } else {
      row.appendChild(bubble);
    }

    msgList.appendChild(row);
    scrollToBottom(true);
    return row;
  }

  function appendTypingIndicator() {
    var row = el('div', {
      className: 'af-chat-row af-chat-row--assistant af-chat-row--typing',
      role: 'status',
      'aria-label': 'Assistant is typing',
    });
    var bubble = el('div', { className: 'af-chat-bubble af-chat-bubble--assistant af-chat-bubble--typing' });
    bubble.innerHTML =
      '<span class="af-typing-dot"></span>' +
      '<span class="af-typing-dot"></span>' +
      '<span class="af-typing-dot"></span>';
    row.appendChild(bubble);
    msgList.appendChild(row);
    scrollToBottom(true);
    return row;
  }

  function appendError(text) {
    var row = el('div', {
      className: 'af-chat-row af-chat-row--error',
      role: 'alert',
    });
    var bubble = el('div', { className: 'af-chat-bubble af-chat-bubble--error' });
    bubble.textContent = text;
    row.appendChild(bubble);
    msgList.appendChild(row);
    scrollToBottom(true);
    return row;
  }

  /* ── Send ────────────────────────────────────────────────────── */
  async function doSend() {
    var text = inputEl.value.trim();
    if (!text || isSending) return;

    isSending = true;
    sendBtn.disabled = true;
    inputEl.value = '';
    inputEl.style.height = 'auto';
    charCount.textContent = '0 / ' + MAX_MSG_LEN;

    appendMessage('user', text);

    var typing = appendTypingIndicator();

    // Build history snapshot to send (before appending the new user message)
    var historyToSend = conversationHistory.slice(-MAX_HISTORY);

    // Append user message to local history
    conversationHistory.push({ role: 'user', content: text });

    var errorEl = null;
    try {
      var sb = window.AccessFillSupabase;
      if (!sb || !sb.session) throw new Error('no_session');

      var res = await fetch(
        _supabaseUrl() + '/functions/v1/ai-assistant',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': _anonKey(),
            'Authorization': 'Bearer ' + sb.session.access_token,
          },
          body: JSON.stringify({
            message: text.slice(0, MAX_MSG_LEN),
            conversationHistory: historyToSend,
            language: lang(),
          }),
        }
      );

      var data = await res.json().catch(function () { return null; });

      if (!res.ok || !data || !data.success || !data.reply) {
        throw new Error((data && data.error) || 'HTTP ' + res.status);
      }

      // Remove typing indicator, add real reply
      if (typing && typing.parentNode) typing.parentNode.removeChild(typing);
      appendMessage('assistant', data.reply);
      conversationHistory.push({ role: 'assistant', content: data.reply });

      // Trim history beyond MAX_HISTORY pairs (2 entries per exchange)
      if (conversationHistory.length > MAX_HISTORY * 2) {
        conversationHistory = conversationHistory.slice(-MAX_HISTORY * 2);
      }
    } catch (err) {
      if (typing && typing.parentNode) typing.parentNode.removeChild(typing);
      appendError("Sorry, I couldn't respond right now — please try again.");
      console.error('[AccessFill Assistant]', err && err.message ? err.message : err);
    }

    isSending = false;
    sendBtn.disabled = inputEl.value.trim().length === 0;
    inputEl.focus();
  }

  /* ── Supabase config helpers ─────────────────────────────────── */
  // supabase-web.js exposes the config as window.AccessFillSupabaseConfig
  // (set at the bottom of that file). We also fall back to _authHeaders()
  // which is a public method on the adapter class.
  function _supabaseUrl() {
    if (window.AccessFillSupabaseConfig && window.AccessFillSupabaseConfig.url) {
      return window.AccessFillSupabaseConfig.url;
    }
    return '';
  }

  function _anonKey() {
    if (window.AccessFillSupabaseConfig && window.AccessFillSupabaseConfig.anonKey) {
      return window.AccessFillSupabaseConfig.anonKey;
    }
    // Fallback: _authHeaders() is a public method on the adapter
    var sb = window.AccessFillSupabase;
    if (!sb || !sb.session) return '';
    try {
      var headers = sb._authHeaders ? sb._authHeaders({}) : {};
      return headers['apikey'] || '';
    } catch (_) { return ''; }
  }

  /* ── Init ────────────────────────────────────────────────────── */
  function init() {
    // Only mount if there's a session (real or demo).
    // We poll once — by the time chat-widget.js runs, guardAuth() has already
    // completed and window.AccessFillSupabase.session is set.
    var sb = window.AccessFillSupabase;
    if (!sb || !sb.session) return;

    buildWidget();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose minimal API for external control (e.g. "Open assistant" buttons)
  window.AFChat = {
    open:  function () { if (toggleBtn) setOpen(true);  },
    close: function () { if (toggleBtn) setOpen(false); },
    isOpen: function () { return isOpen; },
  };
})();
