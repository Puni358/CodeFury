import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * TTS model candidates in preference order.
 *
 * This project previously hit a 404 on gemini-2.5-flash (text model) which
 * had to be swapped to gemini-3.6-flash. TTS models have the same availability
 * quirks per API key. On 404 we fall through to the next model; on 429 we
 * rotate to the next API key entirely (see key-rotation logic below).
 */
const TTS_MODELS = [
  "gemini-2.5-flash-preview-tts",
  "gemini-3.1-flash-tts-preview",
] as const;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function b64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToB64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Wrap raw PCM (audio/L16) in a minimal WAV container.
 *
 * Gemini TTS returns 24 kHz 16-bit mono PCM (audio/L16;rate=24000).
 * Channel count and sample rate are read from the MIME string and default
 * to mono 24 kHz if absent.
 */
function pcmToWav(pcm: Uint8Array, sampleRate: number, numChannels = 1): Uint8Array {
  const bitsPerSample = 16;
  const blockAlign = numChannels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcm.length;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const u8 = new Uint8Array(buffer);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  u8.set(pcm, 44);

  return u8;
}

function sampleRateFromMime(mime: string): number {
  const m = /rate=(\d+)/i.exec(mime || "");
  return m ? Number(m[1]) : 24000;
}

function channelsFromMime(mime: string): number {
  const m = /channels=(\d+)/i.exec(mime || "");
  return m ? Number(m[1]) : 1;
}

function isRawPcm(mime: string): boolean {
  const m = (mime || "").toLowerCase();
  return m.includes("audio/l16") || m.includes("pcm") || m.includes("audio/raw");
}

/**
 * Call the Gemini TTS generateContent endpoint.
 * Returns the raw fetch Response — caller is responsible for checking status.
 */
async function callGeminiTts(
  model: string,
  apiKey: string,
  requestBody: unknown,
): Promise<Response> {
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    model +
    ":generateContent?key=" +
    encodeURIComponent(apiKey);

  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });
}

/**
 * Read the list of API keys to try, in order.
 *
 * Priority:
 *   1. GEMINI_API_KEYS — comma-separated list of keys (new multi-key secret).
 *      Split on commas, trim whitespace, discard empty strings.
 *   2. GEMINI_API_KEY  — original single-key secret (unchanged, still used by
 *      ai-assistant and explain-form-field).  Used as a one-item fallback so
 *      text-to-speech keeps working even if GEMINI_API_KEYS is not set.
 *   3. If neither is set → empty array (caller will return 500).
 */
function resolveApiKeys(): string[] {
  const multi = Deno.env.get("GEMINI_API_KEYS") ?? "";
  if (multi.trim()) {
    const keys = multi.split(",").map((k) => k.trim()).filter(Boolean);
    if (keys.length > 0) return keys;
  }
  const single = Deno.env.get("GEMINI_API_KEY") ?? "";
  return single ? [single] : [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Missing auth" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Resolve key pool before auth so we can fail fast if misconfigured.
    const apiKeys = resolveApiKeys();
    if (apiKeys.length === 0) {
      console.log(JSON.stringify({ msg: "gemini_key_missing" }));
      return json({ error: "Server not configured" }, 500);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser(jwt);
    if (userErr || !user) {
      console.log(JSON.stringify({ msg: "invalid_session" }));
      return json({ error: "Invalid session" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const language = body.language === "kn" ? "kn" : "en";
    const text = String(body.text || "").trim().slice(0, 800);
    if (!text) return json({ error: "text required" }, 400);

    console.log(JSON.stringify({
      msg: "tts_start",
      language,
      text_len: text.length,
      key_pool_size: apiKeys.length,
    }));

    const languageCode = language === "kn" ? "kn-IN" : "en-IN";
    const prompt = language === "kn"
      ? "Speak clearly and naturally in Kannada, at a calm helpful pace, as if explaining a form field to someone:\n\n" + text
      : "Speak clearly and naturally in English, at a calm helpful pace, as if explaining a form field to someone:\n\n" + text;

    function buildBody(includeLanguageCode: boolean) {
      const speechConfig: Record<string, unknown> = {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: "Kore" },
        },
      };
      if (includeLanguageCode) speechConfig.languageCode = languageCode;
      return {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig,
        },
      };
    }

    // -------------------------------------------------------------------------
    // Two-level retry: outer loop rotates API keys, inner loop rotates models.
    //
    // Rotation rules:
    //   429  → quota exhausted on this key. Rotate to next key and retry the
    //          full model sequence from the beginning.
    //          Log key_index (never the key value itself) so we know which slot
    //          is rate-limited.
    //
    //   404  → this model is not available on this key. Continue to the next
    //          model on the SAME key. A missing model is not a quota problem;
    //          a different key won't fix it.
    //
    //   other non-2xx → hard failure for this (key, model) pair. Do NOT rotate
    //          keys — a malformed request or server error won't be fixed by a
    //          different key. Break the inner loop and fall through to the outer.
    //
    // The first (key, model) combination that returns HTTP 200 wins.
    // -------------------------------------------------------------------------
    let geminiRes: Response | null = null;
    let usedModel = TTS_MODELS[0];
    let usedKeyIndex = -1;

    outerKeyLoop:
    for (let ki = 0; ki < apiKeys.length; ki++) {
      const currentKey = apiKeys[ki];

      for (let mi = 0; mi < TTS_MODELS.length; mi++) {
        const candidate = TTS_MODELS[mi];

        // First attempt: include languageCode in speech config.
        let res = await callGeminiTts(candidate, currentKey, buildBody(true));

        // If the first attempt fails with anything other than 404 or 429,
        // retry once without languageCode (some model versions reject it).
        if (!res.ok && res.status !== 404 && res.status !== 429) {
          console.log(JSON.stringify({
            msg: "gemini_tts_retry_without_language_code",
            key_index: ki,
            model: candidate,
            status: res.status,
          }));
          res = await callGeminiTts(candidate, currentKey, buildBody(false));
        }

        // ── Success ──────────────────────────────────────────────────────────
        if (res.ok) {
          geminiRes = res;
          usedModel = candidate;
          usedKeyIndex = ki;
          console.log(JSON.stringify({
            msg: "gemini_tts_key_model_ok",
            key_index: ki,
            model: candidate,
            model_attempt: mi,
          }));
          break outerKeyLoop;
        }

        // ── 429: quota on this key — rotate key, restart model sequence ──────
        if (res.status === 429) {
          console.log(JSON.stringify({
            msg: "gemini_key_rate_limited",
            key_index: ki,
            model: candidate,
            next_key_index: ki + 1 < apiKeys.length ? ki + 1 : null,
          }));
          // Break inner loop → outer loop will advance ki.
          break;
        }

        // ── 404: model not available on this key — try next model ─────────────
        if (res.status === 404) {
          console.log(JSON.stringify({
            msg: "gemini_tts_model_not_found",
            key_index: ki,
            model: candidate,
            next_model: TTS_MODELS[mi + 1] ?? "none",
          }));
          continue; // inner loop: next model, same key
        }

        // ── Other non-2xx: not a quota/availability problem ───────────────────
        // Don't rotate keys — a different key won't fix a bad request or 5xx.
        console.log(JSON.stringify({
          msg: "gemini_tts_http_error",
          key_index: ki,
          model: candidate,
          status: res.status,
        }));
        break; // inner loop: give up on this key entirely
      }
    }

    if (!geminiRes || !geminiRes.ok) {
      console.log(JSON.stringify({
        msg: "gemini_tts_all_keys_exhausted",
        keys_tried: apiKeys.length,
        models_tried: TTS_MODELS,
      }));
      return json({ success: false, error: "tts_failed" }, 502);
    }

    // -------------------------------------------------------------------------
    // Parse response and wrap PCM in WAV — unchanged from before.
    // -------------------------------------------------------------------------
    const geminiJson = await geminiRes.json();
    const part = geminiJson?.candidates?.[0]?.content?.parts?.[0] ?? {};
    const inline = part.inlineData || part.inline_data || {};
    const rawB64 = inline.data;
    const mime = String(inline.mimeType || inline.mime_type || "");

    if (!rawB64) {
      console.log(JSON.stringify({
        msg: "gemini_tts_no_audio",
        key_index: usedKeyIndex,
        model: usedModel,
        part_keys: Object.keys(part),
      }));
      return json({ success: false, error: "tts_failed" }, 502);
    }

    let outB64 = rawB64;
    let outMime = mime || "audio/wav";

    if (isRawPcm(mime) || !/^audio\/(wav|mpeg|mp3|ogg|webm)/i.test(mime)) {
      const pcm = b64ToBytes(rawB64);
      const sampleRate = sampleRateFromMime(mime);
      const channels = channelsFromMime(mime);
      const wav = pcmToWav(pcm, sampleRate, channels);
      outB64 = bytesToB64(wav);
      outMime = "audio/wav";

      console.log(JSON.stringify({
        msg: "tts_pcm_wrapped",
        mime_in: mime || "unknown",
        sample_rate: sampleRate,
        channels,
        pcm_bytes: pcm.length,
        wav_bytes: wav.length,
      }));
    }

    console.log(JSON.stringify({
      msg: "tts_ok",
      key_index: usedKeyIndex,
      model: usedModel,
      language,
      mime_in: mime || "unknown",
      mime_out: outMime,
    }));

    return json({
      success: true,
      audio_base64: outB64,
      mime_type: outMime,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(JSON.stringify({ msg: "tts_exception", detail: msg }));
    return json({ success: false, error: "tts_failed" }, 500);
  }
});
