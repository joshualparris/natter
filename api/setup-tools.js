// One-off: registers Natter's client tools with Cartesia and attaches them to your agent.
// Safe to run more than once (it reuses tools with the same name).
import { guard, cartesiaHeaders, readJson, CARTESIA } from "./_lib.js";

const TOOLS = [
  {
    name: "web_search",
    description: "Look up current or factual information on the web: news, weather, prices, opening hours, facts you're unsure of.",
    parameters: { type: "object", properties: { query: { type: "string", description: "What to look up, as a clear search question" } }, required: ["query"] },
  },
  {
    name: "calendar_events",
    description: "Read Josh's calendar for a date or date range. Use for questions like what's on today, tomorrow or this week.",
    parameters: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "First day, YYYY-MM-DD (Sydney time)" },
        end_date: { type: "string", description: "Last day, YYYY-MM-DD; same as start_date for a single day" },
      },
      required: ["start_date"],
    },
  },
  {
    name: "save_memory",
    description: "Save a short note to long-term memory when Josh asks you to remember something, or shares a durable fact worth keeping.",
    parameters: { type: "object", properties: { note: { type: "string", description: "The fact to remember, in one sentence" } }, required: ["note"] },
  },
];

export default async function handler(req, res) {
  if (!guard(req, res)) return;
  const agentId = process.env.CARTESIA_AGENT_ID;
  if (!process.env.CARTESIA_API_KEY || !agentId) return res.status(500).json({ error: "Cartesia isn't configured." });
  const log = [];
  try {
    // Existing tools on the account, to avoid duplicates.
    let existing = [];
    const lr = await fetch(`${CARTESIA}/v1/agents/tools?limit=100`, { headers: cartesiaHeaders() });
    if (lr.ok) { const d = await readJson(lr); existing = d.data || d.tools || (Array.isArray(d) ? d : []); }
    else log.push(`list tools ${lr.status}`);

    const ids = [];
    for (const t of TOOLS) {
      const found = existing.find((x) => x && x.name === t.name);
      if (found && found.id) { ids.push(found.id); log.push(`reused ${t.name}`); continue; }
      const cr = await fetch(`${CARTESIA}/v1/agents/tools`, {
        method: "POST",
        headers: cartesiaHeaders(),
        body: JSON.stringify({ type: "client", ...t, pre_tool_speech: "auto", execution_mode: "immediate", expects_response: true, response_timeout_secs: 45 }),
      });
      const cd = await readJson(cr);
      const id = cd.id || (cd.data && cd.data.id) || (cd.tool && cd.tool.id);
      if (!cr.ok || !id) return res.status(502).json({ error: `Creating ${t.name} failed (${cr.status})`, detail: cd, log });
      ids.push(id); log.push(`created ${t.name}`);
    }

    // Merge with tools already on the agent (an update replaces the whole list).
    const ar = await fetch(`${CARTESIA}/v1/agents/${encodeURIComponent(agentId)}`, { headers: cartesiaHeaders() });
    const agent = ar.ok ? await readJson(ar) : {};
    const current = ((agent.config && agent.config.tools) || []).map((x) => x.id).filter(Boolean);
    const all = [...new Set([...current, ...ids])].map((id) => ({ id }));
    const pr = await fetch(`${CARTESIA}/v1/agents/${encodeURIComponent(agentId)}`, {
      method: "PATCH",
      headers: cartesiaHeaders(),
      body: JSON.stringify({ config: { tools: all }, version_description: "Natter tools" }),
    });
    const pd = await readJson(pr);
    if (!pr.ok) return res.status(502).json({ error: `Attaching tools to the agent failed (${pr.status})`, detail: pd, log });
    log.push(`agent now has ${all.length} tool(s)`);
    return res.status(200).json({ ok: true, log });
  } catch (e) {
    return res.status(502).json({ error: e.message, log });
  }
}
