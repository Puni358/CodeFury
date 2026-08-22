import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Confirmed working model on this API key.
 * Do NOT use gemini-2.5-flash or gemini-2.0-flash — both deprecated for this key.
 */
const MODEL = "gemini-3.6-flash";

const SYSTEM_PROMPT = `You are the AccessFill Assistant, a helpful guide for a website that helps people with low digital literacy, low vision, or motor difficulties store their personal information (name, address, Aadhaar, PAN, etc.) securely and use it to autofill forms on government, banking, and healthcare websites via a companion browser extension.

The website has these sections:
- Dashboard: the home screen, shows recent activity and quick links to all features.
- My Saved Info: view and edit the user's stored profile — name, address, phone, date of birth, emergency contact, Aadhaar, PAN, and preferred language.
- Upload Documents: photograph or upload an ID document (Aadhaar card, ration card, mark sheet) so the app can read the information automatically and offer to save it to the profile.
- Settings: accessibility preferences — font size (small/medium/large/extra-large), contrast level (normal/high/extra-high), language (English/Kannada), voice guidance on/off, animations on/off, and simplified UI on/off.
- Voice Fill: a voice-guided workflow to fill a form using stored profile data with spoken prompts and audio feedback.

Answer the user's questions about how to use the app, what a section does, or general questions about the stored fields (such as what Aadhaar or PAN means). Keep answers short — 2 to 4 sentences — in simple, plain language with a warm, friendly tone. If asked something totally unrelated to this app or accessibility, gently redirect back to how you can help with AccessFill.`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

interface HistoryEntry {
  role: "user" | "assistant";
  content: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ success: false, error: "Missing auth" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const geminiKey = Deno.env.get("GEMINI_API_KEY");

    if (!geminiKey) {
      console.log(JSON.stringify({ msg: "ai_assistant_gemini_key_missing" }));
      return json({ success: false, error: "Server not configured" }, 500);
    }

    // Verify the session is valid (but don't require a live session — demo tokens pass auth.getUser too if issued by signInDemo, but we accept both for this feature)
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser(jwt);

    // For demo mode the mock token won't resolve a real user — accept it anyway
    // since the assistant doesn't touch any PII. We just need the request to have
    // come from a page that has a session (real or demo).
    const isDemoToken = jwt.startsWith("mock-demo-token-");
    if (userErr && !isDemoToken) {
      console.log(JSON.stringify({ msg: "ai_assistant_invalid_session" }));
      return json({ success: false, error: "Invalid session" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const message = String(body.message || "").trim().slice(0, 1000);
    if (!message) return json({ success: false, error: "message required" }, 400);

    // Accept last 6 history entries, validate shape, strip to safe max length
    const rawHistory: unknown[] = Array.isArray(body.conversationHistory)
      ? body.conversationHistory.slice(-6)
      : [];
    const history: HistoryEntry[] = rawHistory
      .filter(
        (e): e is HistoryEntry =>
          e != null &&
          typeof e === "object" &&
          ("role" in e) &&
          ("content" in e) &&
          ((e as HistoryEntry).role === "user" || (e as HistoryEntry).role === "assistant") &&
          typeof (e as HistoryEntry).content === "string",
      )
      .map((e) => ({
        role: e.role,
        content: String(e.content).slice(0, 600),
      }));

    // Log that a message was sent — never log its content (PII risk if user pastes IDs)
    console.log(JSON.stringify({
      msg: "ai_assistant_request",
      history_len: history.length,
      is_demo: isDemoToken,
      user_id: user ? user.id : "demo",
    }));

    const reqLanguage = String(body.language || "en").toLowerCase() === "kn" ? "kn" : "en";
    const langPrompt = reqLanguage === "kn"
      ? "\n\nIMPORTANT: The user has selected Kannada. You MUST write your ENTIRE response in clear, friendly Kannada (ಕನ್ನಡ)."
      : "\n\nIMPORTANT: The user has selected English. Write your response in English.";

    // Build Gemini contents array: system prompt as first user turn (Gemini Flash
    // doesn't have a separate system role in v1beta — inject as opening user/model pair)
    const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [
      { role: "user",  parts: [{ text: SYSTEM_PROMPT + langPrompt }] },
      { role: "model", parts: [{ text: "Understood. I'm the AccessFill Assistant, ready to help." }] },
    ];

    for (const entry of history) {
      contents.push({
        role: entry.role === "assistant" ? "model" : "user",
        parts: [{ text: entry.content }],
      });
    }

    contents.push({ role: "user", parts: [{ text: message }] });

    const geminiUrl =
      "https://generativelanguage.googleapis.com/v1beta/models/" +
      MODEL +
      ":generateContent?key=" +
      encodeURIComponent(geminiKey);

    const geminiRes = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        generationConfig: {
          // 500 tokens gives ~350–400 words — enough for a 4-sentence answer
          // with technical terms without unbounded cost.
          // Previously 256 which caused mid-sentence cutoff.
          maxOutputTokens: 500,
          temperature: 0.7,
        },
      }),
    });

    if (!geminiRes.ok) {
      console.log(JSON.stringify({
        msg: "ai_assistant_gemini_error",
        status: geminiRes.status,
      }));
      return json({ success: false, error: "assistant_failed" }, 502);
    }

    const geminiJson = await geminiRes.json();
    const rawReply =
      geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const reply = rawReply.trim();

    // DEBUG: log reply length so we can confirm truncation is gone.
    // Remove this log once verified in production.
    console.log(JSON.stringify({
      msg: "ai_assistant_reply_debug",
      reply_chars: reply.length,
      finish_reason: geminiJson?.candidates?.[0]?.finishReason ?? "unknown",
    }));

    if (!reply) {
      console.log(JSON.stringify({ msg: "ai_assistant_empty_reply" }));
      return json({ success: false, error: "assistant_failed" }, 502);
    }

    // Log only that a reply was produced — never log the reply text itself
    console.log(JSON.stringify({
      msg: "ai_assistant_ok",
      is_demo: isDemoToken,
    }));

    return json({ success: true, reply });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(JSON.stringify({ msg: "ai_assistant_exception", detail: msg }));
    return json({ success: false, error: "assistant_failed" }, 500);
  }
});
