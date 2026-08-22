import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MODEL = "gemini-2.5-flash-preview-tts";

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

function pcmToWav(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const numChannels = 1;
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

function isRawPcm(mime: string): boolean {
  const m = (mime || "").toLowerCase();
  return m.includes("audio/l16") || m.includes("pcm") || m.includes("audio/raw");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Missing auth" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) {
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
    }));

    const languageCode = language === "kn" ? "kn-IN" : "en-IN";
    const prompt = language === "kn"
      ? "Speak clearly and naturally in Kannada, at a calm helpful pace, as if explaining a form field to someone:\n\n" + text
      : "Speak clearly and naturally in English, at a calm helpful pace, as if explaining a form field to someone:\n\n" + text;

    const geminiUrl =
      "https://generativelanguage.googleapis.com/v1beta/models/" + MODEL +
      ":generateContent?key=" + encodeURIComponent(geminiKey);

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

    let geminiRes = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildBody(true)),
    });

    if (!geminiRes.ok) {
      console.log(JSON.stringify({
        msg: "gemini_tts_retry_without_language_code",
        status: geminiRes.status,
      }));
      geminiRes = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBody(false)),
      });
    }

    if (!geminiRes.ok) {
      console.log(JSON.stringify({ msg: "gemini_tts_http_error", status: geminiRes.status }));
      return json({ error: "tts_failed" }, 502);
    }

    const geminiJson = await geminiRes.json();
    const part = geminiJson?.candidates?.[0]?.content?.parts?.[0] ?? {};
    const inline = part.inlineData || part.inline_data || {};
    const rawB64 = inline.data;
    const mime = String(inline.mimeType || inline.mime_type || "");

    if (!rawB64) {
      console.log(JSON.stringify({
        msg: "gemini_tts_no_audio",
        part_keys: Object.keys(part),
      }));
      return json({ error: "tts_failed" }, 502);
    }

    let outB64 = rawB64;
    let outMime = mime || "audio/wav";

    if (isRawPcm(mime) || !/^audio\/(wav|mpeg|mp3|ogg|webm)/i.test(mime)) {
      const pcm = b64ToBytes(rawB64);
      const wav = pcmToWav(pcm, sampleRateFromMime(mime));
      outB64 = bytesToB64(wav);
      outMime = "audio/wav";
    }

    console.log(JSON.stringify({
      msg: "tts_ok",
      language,
      mime_in: mime || "unknown",
      mime_out: outMime,
    }));

    return json({
      success: true,
      audio_base64: outB64,
      mime_type: outMime,
    });
  } catch (_) {
    console.log(JSON.stringify({ msg: "tts_exception" }));
    return json({ error: "tts_failed" }, 500);
  }
});
