import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EXTRACT_PROMPT = `Extract identity fields from this document image.
Return ONLY a JSON object with these keys:
full_name, date_of_birth, aadhaar_number, pan_number, address, document_type
document_type must be one of: aadhaar, ration_card, marksheet, other
Use null for any field not confidently present. No markdown, no extra text.`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function stripFences(text: string): string {
  return text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
}

function normalizeIsoDate(val: unknown): string | null {
  if (val == null) return null;
  const str = String(val).trim();
  if (!str || str === 'null' || str === 'undefined') return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  if (/^\d{4}-\d{2}-\d{2}T/.test(str)) return str.slice(0, 10);

  const dmyMatch = str.match(/^(\d{1,2})[\/\.-](\d{1,2})[\/\.-](\d{2,4})$/);
  if (dmyMatch) {
    let p1 = parseInt(dmyMatch[1], 10);
    let p2 = parseInt(dmyMatch[2], 10);
    let year = parseInt(dmyMatch[3], 10);
    if (year < 100) year += (year > 30 ? 1900 : 2000);
    let day: number, month: number;
    if (p1 > 12) { day = p1; month = p2; }
    else if (p2 > 12) { month = p1; day = p2; }
    else { day = p1; month = p2; }

    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    if (y >= 1900 && y <= 2100) return `${y}-${m}-${d}`;
  }

  return null;
}

function logStatus(msg: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ msg, ...extra }));
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
      logStatus("gemini_key_missing");
      return json({ error: "Server not configured" }, 500);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userErr } = await userClient.auth.getUser(jwt);
    if (userErr || !user) {
      logStatus("invalid_session");
      return json({ error: "Invalid session" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const storagePath = body.storage_path;
    if (!storagePath || typeof storagePath !== "string") {
      return json({ error: "storage_path required" }, 400);
    }

    const firstSegment = storagePath.split("/")[0];
    if (firstSegment !== user.id) {
      logStatus("path_uid_mismatch");
      return json({ error: "Forbidden" }, 403);
    }

    const { data: blob, error: dlErr } = await userClient.storage
      .from("id-documents")
      .download(storagePath);

    if (dlErr || !blob) {
      logStatus("storage_download_failed");
      return json({ error: "Could not read document" }, 400);
    }

    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const b64 = btoa(binary);
    const mime = blob.type || "image/jpeg";

    const geminiUrl =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=" +
      encodeURIComponent(geminiKey);

    const geminiRes = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: EXTRACT_PROMPT },
            { inline_data: { mime_type: mime, data: b64 } },
          ],
        }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    });

    if (!geminiRes.ok) {
      logStatus("gemini_http_error", { status: geminiRes.status });
      return json({ error: "extract_failed" }, 502);
    }

    const geminiJson = await geminiRes.json();
    const rawText = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(stripFences(rawText));
    } catch (_) {
      logStatus("gemini_json_parse_failed");
      return json({ error: "extract_failed" }, 502);
    }

    const fields = {
      document_type: parsed.document_type ?? null,
      full_name: parsed.full_name ?? null,
      date_of_birth: normalizeIsoDate(parsed.date_of_birth),
      aadhaar_number: parsed.aadhaar_number ?? null,
      pan_number: parsed.pan_number ?? null,
      address: parsed.address ?? null,
      address_line1: parsed.address_line1 ?? parsed.address ?? null,
    };

    const keysFound = Object.keys(fields).filter((k) => fields[k as keyof typeof fields] != null);
    logStatus("extract_ok", { keysFound });
    return json({ success: true, fields });
  } catch (_) {
    logStatus("extract_exception");
    return json({ error: "extract_failed" }, 500);
  }
});
