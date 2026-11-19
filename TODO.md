# Natter: what it can do, and what's next

## Already in Natter
- **Natural prosody:** Cartesia Sonic handles breathing, pacing and tone. "Expressive speech" (on by default) adds natural fillers, pauses (`<break>`) and the odd laugh (`[laughter]`).
- **Personas:** 4 modes (Yarn, Think it through, Wind down, Quiz me), a free-text Personality box, and a voice picker with previews.
- **Low-latency turn-taking:** Cartesia's Ink 2 turn detection plus streaming speech. Pick Claude Haiku on the agent for the fastest replies.
- **Barge-in:** just start talking and it stops. Push-to-talk is there for noisy places.
- **Backchannels:** prompted to keep going when you say "yeah" or "mm" mid-thought. Cartesia's turn detection does the rest, and we can't tune it directly.
- **Proactive conversation:** prompted to follow up, ask questions and bridge between topics.
- **Cross-session memory:** auto-summarised after each chat, editable in Settings, plus "remember this" by voice.
- **Privacy:** incognito mode, auto-delete history after 7/30/90 days, and everything is stored on-device.
- **Live web search:** via Claude with web search. Also calendar reading (Google iCal) and notes by voice.
- **Saved transcripts, auto-reconnect, install as a phone app, debug log.**
- **Typing box:** type instead of talking, with replies read aloud in your voice. (Typing *during* a live voice call isn't supported yet: Cartesia's agent socket only takes audio.)

## To do
### Voice & realism
- [ ] Sighs, coughs and other non-verbal sounds once Cartesia adds them. Only laughter is supported today.
- [ ] Emotion-matched delivery: send Cartesia emotion tags (beta, works best with voices tagged "Emotive") when the reply's mood is clear.
- [ ] Named personas like Sesame's Maya and Miles: save voice, personality and mode together as one-tap characters.
- [ ] Custom voice: clone a voice from a 10–30 second sample, with consent.

### Conversation dynamics
- [ ] Measure real latency (end of your speech → first audio) and show it in the debug log. Compare Haiku and Sonnet.
- [ ] Tune turn-taking patience for Wind down mode, if Cartesia exposes the setting.

### Emotional intelligence
- [ ] **Tone detection from your voice.** Not possible with the current setup, because Claude only sees the transcript and never hears your voice. Options:
  - [ ] Use Hume's expression measurement API on your audio, then pass "sounds tired/frustrated" to Claude as context.
  - [ ] Or switch to a speech-to-speech model (e.g. OpenAI GPT-Live-1) that hears tone directly.

### Memory & privacy
- [ ] Sync memory and history across phone and PC (e.g. Supabase or Vercel Blob, encrypted).
- [ ] Shared memory with text chats.
- [ ] Check Cartesia's call log retention and add a "delete call recordings" button if their API allows it.

### Utility
- [ ] Reminders and calendar events by voice. Needs write access to Google Calendar (OAuth) rather than the read-only iCal link.
- [ ] "Summarise our chat" and "email me the notes" actions.
- [ ] Weather and local Dubbo info shortcuts.

### Multilingual
- [ ] Language coach mode: pick a target language, practise conversation, get gentle grammar and pronunciation feedback (needs multilingual settings on the agent).
- [ ] Auto-switch languages mid-conversation.
