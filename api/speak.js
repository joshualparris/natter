// Reads a typed-chat reply aloud with Cartesia text-to-speech (MP3).
import { guard, body, readJson, CARTESIA, CARTESIA_VERSION } from "./_lib.js";

const MODEL = process.env.NATTER_TTS_MODEL || "sonic-3.6";
let cachedDefault = null;

function headers() {
  return { "Cartesia-Version": CARTESIA_VERSION, Authorization: `Bearer ${process.env.CARTESIA_API_KEY}`, "Content-Type": "application/json" };
}

// Find a voice id anywhere in an agent config (field names vary between API versions).
function findVoiceId(obj, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 6) return null;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string" && /^voice(_id)?$/i.test(k) && /^[\w-]{8,80}$/.test(v)) return v;
    if (k === "voice" && v && typeof v.id === "string") return v.id;
  }
  for (const v of Object.values(obj)) {
    const hit = findVoiceId(v, depth + 1);
    if (hit) return hit;
  }
  return null;
}

// Without a chosen voice: the agent's own voice, then NATTER_TTS_VOICE, then the first library voice.
async function defaultVoice() {
  if (cachedDefault) return cachedDefault;
  const agentId = process.env.CARTESIA_AGENT_ID;
  if (agentId) {
    try {
      const r = await fetch(`${CARTESIA}/agents/${encodeURIComponent(agentId)}`, { headers: headers() });
      if (r.ok) cachedDefault = findVoiceId(await readJson(r));
    } catch {}
  }
  if (!cachedDefault && process.env.NATTER_TTS_VOICE) cachedDefault = process.env.NATTER_TTS_VOICE;
  if (!cachedDefault) {
    try {
      const r = await fetch(`${CARTESIA}/voices?limit=1`, { headers: headers() });
      const data = await readJson(r);
      cachedDefault = data?.data?.[0]?.id || null;
    } catch {}
  }
  return cachedDefault;
}

export default async function handler(req, res) {
  if (!guard(req, res)) return;
  if (!process.env.CARTESIA_API_KEY) return res.status(500).json({ error: "CARTESIA_API_KEY isn't set." });
  const b = body(req);
  // Speech tags aren't wanted here; keep it to plain words.
  const transcript = String(b.text || "").replace(/\[laughter\]/gi, " ").replace(/<[^>]*>/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, 3000);
  if (!transcript) return res.status(400).json({ error: "Nothing to say." });
  const chosen = typeof b.voice === "string" && /^[\w-]{4,80}$/.test(b.voice) ? b.voice : null;
  const voice = chosen || (await defaultVoice());
  if (!voice) return res.status(500).json({ error: "No voice available. Pick one in Settings, or set NATTER_TTS_VOICE." });
  const speed = Math.min(1.5, Math.max(0.6, Number(b.speed) || 1));
  try {
    const r = await fetch(`${CARTESIA}/tts/bytes`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        model_id: MODEL,
        transcript,
        voice: { id: voice },
        language: "en",
        output_format: { container: "mp3", sample_rate: 44100, bit_rate: 128000 },
        generation_config: { speed },
      }),
    });
    if (!r.ok) {
      const detail = await readJson(r);
      return res.status(502).json({ error: `Cartesia speech failed (${r.status}).`, detail });
    }
    const audio = Buffer.from(await r.arrayBuffer());
    res.setHeader("Content-Type", r.headers.get("content-type") || "audio/mpeg");
    return res.status(200).send(audio);
  } catch (e) {
    return res.status(502).json({ error: "Couldn't reach Cartesia." });
  }
}
