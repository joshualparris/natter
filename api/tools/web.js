// web_search tool: Claude with web search returns a short, speakable answer.
import { guard, body, claude, todayString } from "../_lib.js";

export default async function handler(req, res) {
  if (!guard(req, res)) return;
  const query = String(body(req).query || "").slice(0, 500).trim();
  if (!query) return res.status(400).json({ error: "No query." });
  try {
    const answer = await claude({
      maxTokens: 700,
      system: `You answer lookups for a voice assistant in Dubbo, NSW, Australia. It's ${todayString()}.
Search the web, then answer in two to four plain spoken sentences with no markdown, lists or URLs.
Mention the source by name when it matters, and say plainly if you couldn't find a reliable answer.`,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3,
        user_location: { type: "approximate", city: "Dubbo", region: "New South Wales", country: "AU", timezone: "Australia/Sydney" } }],
      messages: [{ role: "user", content: query }],
    });
    return res.status(200).json({ result: answer || "I couldn't find anything useful." });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }
}
