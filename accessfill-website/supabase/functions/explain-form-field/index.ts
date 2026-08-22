import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function stripFences(text: string): string {
  return text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
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
    const fieldKey = String(body.field_key || "").slice(0, 80);
    const fieldLabel = String(body.field_label || "").slice(0, 120);
    const language = body.language === "kn" ? "kn" : "en";
    const langName = language === "kn" ? "Kannada" : "English";
    const labelForPrompt = fieldLabel || fieldKey.replace(/_/g, " ");

    if (!labelForPrompt.trim()) {
      return json({ error: "field_label required" }, 400);
    }

    console.log(JSON.stringify({
      msg: "explain_start",
      field_key: fieldKey,
      language,
    }));

    const prompt =
      `Explain in one simple sentence, in ${langName}, what a form field labeled '${labelForPrompt}' is likely asking for. Keep it under 25 words, no jargon.`;

    const geminiUrl =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" +
      encodeURIComponent(geminiKey);

    const geminiRes = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 80 },
      }),
    });

    if (!geminiRes.ok) {
      console.log(JSON.stringify({ msg: "gemini_http_error", status: geminiRes.status }));
      return json({ error: "explain_failed" }, 502);
    }

    const geminiJson = await geminiRes.json();
    const rawText = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const explanation = stripFences(rawText).replace(/^["']|["']$/g, "").trim();
    if (!explanation) {
      console.log(JSON.stringify({ msg: "gemini_empty" }));
      return json({ error: "explain_failed" }, 502);
    }

    console.log(JSON.stringify({ msg: "explain_ok", field_key: fieldKey, language }));
    return json({ success: true, explanation });
  } catch (_) {
    console.log(JSON.stringify({ msg: "explain_exception" }));
    return json({ error: "explain_failed" }, 500);
  }
});
