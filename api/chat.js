// Typed chat: Josh types instead of talking. Same personality, modes, memory and
// recent-chat recall as voice calls, answered by Claude (with web lookups).
import { guard, body, claude, todayString } from "./_lib.js";
import { buildInstructions } from "./_prompts.js";

const TEXT_NOTE = `He's typing to you in Natter's text box instead of talking. Your reply is shown on screen and may be read aloud,
so keep the same spoken, conversational style: no markdown, lists, headings or URLs. You can go a little longer when he asks for detail.
In text chats your only tool is web search for current facts; don't mention calendar or save_memory tools.
Anything worth remembering is saved automatically after the chat, so if he asks you to remember something just say you will.`;

const MAX_TURNS = 40;

// Claude needs alternating user/assistant messages that start with the user.
export function toMessages(history, text) {
  const turns = (Array.isArray(history) ? history : [])
    .filter((t) => t && typeof t.text === "string" && t.text.trim() && (t.role === "user" || t.role === "assistant"))
    .slice(-MAX_TURNS)
    .map((t) => ({ role: t.role, content: t.text.slice(0, 4000) }));
  turns.push({ role: "user", content: String(text).slice(0, 4000) });
  const merged = [];
  for (const m of turns) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) last.content += `\n${m.content}`;
    else merged.push({ ...m });
  }
  while (merged.length && merged[0].role !== "user") merged.shift();
  return merged;
}

export default async function handler(req, res) {
  if (!guard(req, res)) return;
  const b = body(req);
  const text = String(b.text || "").trim();
  if (!text) return res.status(400).json({ error: "Type something first." });
  const system = [
    buildInstructions({
      mode: b.mode, memory: b.memory, recentChats: b.recentChats,
      persona: b.persona, incognito: !!b.incognito, expressive: false,
    }),
    TEXT_NOTE,
  ].join("\n\n");
  try {
    const reply = await claude({
      system,
      maxTokens: 900,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3,
        user_location: { type: "approximate", city: "Dubbo", region: "New South Wales", country: "AU", timezone: "Australia/Sydney" } }],
      messages: toMessages(b.history, text),
    });
    return res.status(200).json({ reply: reply || "Sorry, I lost my train of thought there. Say that again?", at: todayString() });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }
}
