// Creates a voice session. Tries Cartesia's web-call sessions API first (supports per-call
// instructions, so memory and modes work), then falls back to a plain access token.
import { guard, body, cartesiaHeaders, readJson, CARTESIA, CARTESIA_VERSION } from "./_lib.js";
import { buildInstructions, introFor, MODES } from "./_prompts.js";

export default async function handler(req, res) {
  if (!guard(req, res)) return;
  const { CARTESIA_API_KEY, CARTESIA_AGENT_ID } = process.env;
  if (!CARTESIA_API_KEY || !CARTESIA_AGENT_ID) {
    return res.status(500).json({ error: "Not set up yet: add CARTESIA_API_KEY and CARTESIA_AGENT_ID in your site's environment variables, then redeploy." });
  }
  const b = body(req);
  const mode = MODES[b.mode] ? b.mode : "chat";
  const reconnect = !!b.recent;
  const instructions = buildInstructions({
    mode, memory: b.memory, recent: b.recent,
    expressive: b.expressive !== false, persona: b.persona, incognito: !!b.incognito, recentChats: b.recentChats,
  });
  const intro = introFor(mode, reconnect);
  const agentId = CARTESIA_AGENT_ID;
  const notes = [];

  if (b.prefer !== "token") {
    try {
      const overrides = { instructions, initial_message: intro };
      const output = {};
      if (MODES[mode].speed) output.speed = MODES[mode].speed;
      if (typeof b.voice === "string" && /^[\w-]{4,80}$/.test(b.voice)) output.voice_id = b.voice;
      if (Object.keys(output).length) overrides.audio = { output };
      const r = await fetch(`${CARTESIA}/v1/agents/websocket/${encodeURIComponent(agentId)}/sessions`, {
        method: "POST",
        headers: cartesiaHeaders(),
        body: JSON.stringify({ config_overrides: overrides }),
      });
      const data = await readJson(r);
      if (r.ok && data.url && data.token) {
        return res.status(200).json({ kind: "session", url: data.url, token: data.token, callId: data.call_id, version: CARTESIA_VERSION });
      }
      notes.push(`sessions API ${r.status}: ${JSON.stringify(data).slice(0, 300)}`);
    } catch (e) {
      notes.push(`sessions API error: ${e.message}`);
    }
  }

  try {
    const r = await fetch(`${CARTESIA}/access-token`, {
      method: "POST",
      headers: cartesiaHeaders(),
      body: JSON.stringify({ grants: { agent: true }, expires_in: 3600 }),
    });
    const data = await readJson(r);
    if (!r.ok || !data.token) {
      notes.push(`access-token ${r.status}: ${JSON.stringify(data).slice(0, 300)}`);
      return res.status(502).json({ error: `Cartesia refused the request (${r.status}). Check your API key.`, notes });
    }
    return res.status(200).json({ kind: "token", token: data.token, agentId, instructions, intro, version: CARTESIA_VERSION, notes });
  } catch (e) {
    return res.status(502).json({ error: "Couldn't reach Cartesia.", notes });
  }
}
