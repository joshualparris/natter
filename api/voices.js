// Lists Cartesia voices (with preview clips) for the voice picker.
import { guard, body, readJson, CARTESIA, CARTESIA_VERSION } from "./_lib.js";

export default async function handler(req, res) {
  if (!guard(req, res)) return;
  if (!process.env.CARTESIA_API_KEY) return res.status(500).json({ error: "CARTESIA_API_KEY isn't set." });
  const b = body(req);
  const p = new URLSearchParams({ limit: "48" });
  p.append("expand[]", "preview_file_url");
  if (b.q) p.set("q", String(b.q).slice(0, 100));
  if (b.language) p.set("language", String(b.language).slice(0, 10));
  if (["masculine", "feminine", "gender_neutral"].includes(b.gender)) p.set("gender", b.gender);
  if (b.cursor) p.set("starting_after", String(b.cursor).slice(0, 100));
  try {
    const r = await fetch(`${CARTESIA}/voices?${p}`, {
      headers: { "Cartesia-Version": CARTESIA_VERSION, Authorization: `Bearer ${process.env.CARTESIA_API_KEY}` },
    });
    const data = await readJson(r);
    if (!r.ok) return res.status(502).json({ error: `Cartesia voices ${r.status}`, detail: data });
    const voices = (data.data || []).map((v) => ({
      id: v.id,
      name: v.name,
      tagline: v.tagline || "",
      description: v.description || "",
      gender: v.gender || null,
      accent: (v.accents && v.accents[0] && (v.accents[0].accent || v.accents[0].locale)) || v.language || "",
      preview: v.preview_file_url || null,
    }));
    return res.status(200).json({ voices, next: data.has_more ? data.next_page : null });
  } catch (e) {
    return res.status(502).json({ error: "Couldn't reach Cartesia." });
  }
}
