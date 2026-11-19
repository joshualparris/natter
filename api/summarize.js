// Updates Natter's long-term memory notes from a finished conversation, using Claude.
import { guard, body, claude } from "./_lib.js";

const SYSTEM = `You maintain short memory notes for a voice companion app about its one user, Josh.
You'll get the current notes and a new conversation transcript. Return the updated notes only.
Rules:
- Plain text, one fact per line starting with "- ". At most 40 lines and about 300 words.
- Keep durable things: people in his life, ongoing projects, plans, preferences about how he likes to talk, open threads worth following up.
- Only record what Josh actually said; don't infer diagnoses, personality traits or things he didn't state.
- Never record passwords, account numbers, card numbers or ID numbers.
- Merge duplicates, update anything that changed, and drop things that are clearly finished or stale.
- If nothing new is worth keeping, return the current notes unchanged.`;

export default async function handler(req, res) {
  if (!guard(req, res)) return;
  const b = body(req);
  const turns = Array.isArray(b.turns) ? b.turns : [];
  const transcript = turns
    .filter((t) => t && t.text && (t.role === "user" || t.role === "assistant"))
    .map((t) => `${t.role === "user" ? "Josh" : "Natter"}: ${String(t.text).slice(0, 2000)}`)
    .join("\n")
    .slice(-30000);
  const current = String(b.memory || "").slice(0, 6000);
  if (!transcript) return res.status(200).json({ memory: current });
  try {
    const memory = await claude({
      system: SYSTEM,
      maxTokens: 900,
      messages: [{ role: "user", content: `Current notes:\n${current || "(none yet)"}\n\nNew conversation:\n${transcript}` }],
    });
    return res.status(200).json({ memory: memory || current });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }
}
