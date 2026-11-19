// Shared helpers for Natter's serverless functions (underscore = not a route).
import { timingSafeEqual } from "node:crypto";

export const CARTESIA_VERSION = "2026-08-14";
export const CARTESIA = "https://api.cartesia.ai";
export const CLAUDE_MODEL = process.env.NATTER_CLAUDE_MODEL || "claude-haiku-5-5";
export const TZ = process.env.NATTER_TZ || "Australia/Sydney";

export function body(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}

// Returns true if allowed; otherwise writes a 401/405 and returns false.
export function guard(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return false; }
  const expected = process.env.APP_PASSCODE;
  if (!expected) return true;
  const a = Buffer.from(String(body(req).passcode || ""));
  const b = Buffer.from(String(expected));
  if (a.length === b.length && timingSafeEqual(a, b)) return true;
  res.status(401).json({ error: "Wrong passcode." });
  return false;
}

export function cartesiaHeaders(extra = {}) {
  return {
    "Cartesia-Version": CARTESIA_VERSION,
    "Content-Type": "application/json",
    "X-API-Key": process.env.CARTESIA_API_KEY,
    Authorization: `Bearer ${process.env.CARTESIA_API_KEY}`,
    ...extra,
  };
}

export async function readJson(r) {
  const text = await r.text();
  try { return JSON.parse(text); } catch { return { raw: text.slice(0, 500) }; }
}

// Calls Claude's Messages API. Returns the concatenated text of the reply.
export async function claude({ system, messages, tools, maxTokens = 800 }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw Object.assign(new Error("ANTHROPIC_API_KEY isn't set in your site's environment variables."), { status: 501 });
  let convo = messages;
  for (let i = 0; i < 3; i++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: maxTokens, system, messages: convo, ...(tools ? { tools } : {}) }),
    });
    const data = await readJson(r);
    if (!r.ok) throw Object.assign(new Error(data?.error?.message || `Claude API error ${r.status}`), { status: 502 });
    if (data.stop_reason === "pause_turn") {
      convo = [...convo, { role: "assistant", content: data.content }];
      continue;
    }
    return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  }
  throw Object.assign(new Error("Claude took too long."), { status: 504 });
}

export function todayString(tz = TZ) {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: tz, weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit",
  }).format(new Date());
}
