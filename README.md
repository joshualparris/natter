# Natter

Talk out loud with Claude, with Cartesia handling the voice, listening and interruptions.
Hosted on Netlify: https://natter-pc92.netlify.app (deploys automatically from `main`).

## Layout
- `public/` – the app (static: `index.html`, `app.js`, service worker, icons)
- `api/` – server logic (session, memory summariser, voices, tools)
- `netlify/functions/` – thin wrappers that expose `api/*` at `/api/*` on Netlify

## Environment variables (Netlify project `natter-pc92` → search settings for "environment")

| Variable | Needed for |
|---|---|
| `CARTESIA_API_KEY` | Everything (play.cartesia.ai → Keys) |
| `CARTESIA_AGENT_ID` | Everything (your agent in the Cartesia Playground) |
| `APP_PASSCODE` | Locking the app (recommended) |
| `ANTHROPIC_API_KEY` | Optional. Auto memory summaries and web lookups. Netlify AI Gateway supplies one automatically; set your own only to bill Anthropic directly |
| `GOOGLE_CALENDAR_ICS_URL` | Calendar questions (Google Calendar "secret address in iCal format") |
| `NATTER_PROMPT` | Optional: replaces the base personality |
| `NATTER_TTS_VOICE` | Optional: Cartesia voice id for reading typed replies aloud when no voice is picked (default: your agent's voice, else your first library voice) |

After changing variables, trigger a redeploy (Deploys → Trigger deploy).

## Typing
Not in a spot to talk? Type in the box at the bottom instead (Enter sends, Shift+Enter for a new line).
Typed chats use the same mode, personality, memory and recent chats as calls, can look things up on the web,
and replies are read aloud in your chosen voice (toggle **Read aloud / Silent**). Typing after a call carries on
that conversation; tapping the logo starts a fresh one. Typed chats are saved to History and update memory once
you've gone quiet for two minutes, leave the app, or start a call. Needs Claude (Netlify AI Gateway or `ANTHROPIC_API_KEY`).

## Memory
Each call includes your last three saved conversations (no key needed) plus the Memory notes in Settings.
Through Netlify AI Gateway (or your own `ANTHROPIC_API_KEY`), the notes are also summarised and updated automatically after each chat.
Incognito chats are never saved or shared with later calls.

## Notes
- Natter sends its own instructions each call (personality, mode, memory, date), so the Cartesia Playground prompt is mostly overridden; the model and default voice set there still apply.
- First-time setup: Settings → passcode → "Set up tools on my agent" (once).
- See TODO.md for the roadmap.
