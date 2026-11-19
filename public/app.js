// Natter client — voice chat with a Cartesia agent (Claude brain).
"use strict";

const RATE = 24000;
const MODES = { chat: "Yarn", think: "Think it through", wind: "Wind down", quiz: "Quiz me" };
const PLANS = ["session", "token-v1", "token-legacy"]; // tried in order until one connects
const $ = (id) => document.getElementById(id);

// ---------- storage ----------
const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  json(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  setJson(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const prefs = {
  get mode() { return MODES[store.get("natter-mode")] ? store.get("natter-mode") : "chat"; },
  set mode(v) { store.set("natter-mode", v); },
  get talk() { return store.get("natter-talk", "hands"); },
  set talk(v) { store.set("natter-talk", v); },
  get voice() { return store.json("natter-voice", null); },
  set voice(v) { store.setJson("natter-voice", v); },
  get memory() { return store.get("natter-memory", ""); },
  set memory(v) { store.set("natter-memory", v); },
  get autoMem() { return store.get("natter-automem", "1") === "1"; },
  set autoMem(v) { store.set("natter-automem", v ? "1" : "0"); },
  get pass() { return store.get("natter-pass", ""); },
  set pass(v) { store.set("natter-pass", v); },
  get debug() { return store.get("natter-debug", "0") === "1"; },
  get expressive() { return store.get("natter-expressive", "1") === "1"; },
  set expressive(v) { store.set("natter-expressive", v ? "1" : "0"); },
  get persona() { return store.get("natter-persona", ""); },
  set persona(v) { store.set("natter-persona", v); },
  get incognito() { return store.get("natter-incognito", "0") === "1"; },
  set incognito(v) { store.set("natter-incognito", v ? "1" : "0"); },
  get keepDays() { return Number(store.get("natter-keep", "30")); },
  set keepDays(v) { store.set("natter-keep", String(v)); },
  set debug(v) { store.set("natter-debug", v ? "1" : "0"); },
  get readAloud() { return store.get("natter-read", "1") === "1"; },
  set readAloud(v) { store.set("natter-read", v ? "1" : "0"); },
};

// ---------- state ----------
let ctx = null, stream = null, capture = null, wakeLock = null;
let ws = null, proto = "v1", streamId = null, ready = false, connSerial = 0;
let onCall = false, userEnded = false, planIdx = 0, retries = 0, readyAt = 0;
let muted = false, pttHeld = false, pending = false;
let nextTime = 0;
const sources = new Set();
let conv = null; // { id, started, mode, voice, plan, turns: [{role, text, t}] }
let features = {};

// ---------- UI helpers ----------
const orb = $("orb"), statusEl = $("status"), log = $("log"), scroller = $("scroll");
function setStatus(text, err = false) { statusEl.textContent = text; statusEl.classList.toggle("err", err); }
function setOrb(state) {
  orb.classList.toggle("live", state !== "idle");
  orb.classList.toggle("speaking", state === "speaking");
  orb.classList.toggle("thinking", state === "thinking");
}
function toast(msg) { const t = $("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 2600); }

// Only auto-scroll when you're already near the bottom; otherwise show "Jump to latest".
let stick = true;
scroller.addEventListener("scroll", () => {
  stick = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 90;
  if (stick) $("jump").classList.remove("show");
}, { passive: true });
function followLog() {
  if (stick) scroller.scrollTop = scroller.scrollHeight;
  else $("jump").classList.add("show");
}
$("jump").onclick = () => { stick = true; scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" }); $("jump").classList.remove("show"); };

// Strip speech tags ([laughter], <break/>) from what's shown on screen.
function clean(t) {
  return String(t || "").replace(/\[laughter\]/gi, "(laughs)").replace(/<[^>]*>/g, "").replace(/<[^>]*$/, "").replace(/[ \t]{2,}/g, " ").trim();
}
function sysLine(text) {
  const el = document.createElement("div"); el.className = "sys"; el.textContent = text; log.appendChild(el); followLog(); return el;
}
const bubbles = new Map();
function bubble(role, turn) {
  const key = `${connSerial}:${role}:${turn}`;
  let el = bubbles.get(key);
  if (!el) {
    el = document.createElement("div");
    el.className = "msg " + (role === "user" ? "user" : "assistant");
    log.appendChild(el); bubbles.set(key, el);
    $("hero").style.display = "none";
  }
  return el;
}

// ---------- debug log ----------
const dbg = [];
function debug(dir, obj) {
  let s;
  if (typeof obj === "string") s = obj;
  else {
    const o = { ...obj };
    if (o.audio) o.audio = `<${o.audio.length} b64>`;
    if (o.media && o.media.payload) o.media = { payload: `<${o.media.payload.length} b64>` };
    s = JSON.stringify(o);
  }
  if (/audio_input|media_input/.test(s)) return; // too noisy
  dbg.push(`${new Date().toLocaleTimeString("en-AU", { hour12: false })} ${dir} ${s}`.slice(0, 600));
  if (dbg.length > 300) dbg.splice(0, dbg.length - 300);
  if (prefs.debug) { const pre = $("debugLog"); pre.textContent = dbg.join("\n"); pre.scrollTop = pre.scrollHeight; }
}
$("copyDebug").onclick = () => navigator.clipboard.writeText(dbg.join("\n")).then(() => toast("Log copied"), () => toast("Couldn't copy"));
$("clearDebug").onclick = () => { dbg.length = 0; $("debugLog").textContent = ""; };

// ---------- audio ----------
function b64FromBuffer(buf) {
  const bytes = new Uint8Array(buf); let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function pcmFromB64(b64) {
  const bin = atob(b64); const n = bin.length >> 1; const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
    if (v >= 0x8000) v -= 0x10000;
    out[i] = v / 0x8000;
  }
  return out;
}
function play(samples) {
  if (!ctx || !samples.length) return;
  const buf = ctx.createBuffer(1, samples.length, RATE);
  buf.copyToChannel(samples, 0);
  const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination);
  const t = Math.max(ctx.currentTime + 0.04, nextTime);
  src.start(t); nextTime = t + buf.duration; sources.add(src);
  src.onended = () => { sources.delete(src); if (!sources.size && ready) idleStatus(); };
  pending = false; setOrb("speaking"); setStatus("Speaking… (just talk to interrupt)");
}
function stopPlayback() { for (const s of sources) { try { s.stop(); } catch {} } sources.clear(); nextTime = 0; }
function idleStatus() {
  setOrb("listening");
  if (prefs.talk === "ptt") setStatus(pttHeld ? "Listening…" : "Hold to talk");
  else setStatus(muted ? "Muted" : "Listening…");
}
function micGate() {
  const silent = prefs.talk === "ptt" ? !pttHeld : muted;
  if (capture) capture.mute(silent);
}

// Downsamples mic audio (box filter) to RATE and emits ~40 ms chunks of 16-bit little-endian PCM.
// Used inside the AudioWorklet and, as a fallback, on the main thread.
class Downsampler {
  constructor(inRate, outRate, emit) {
    this.ratio = inRate / outRate; this.chunk = Math.round(outRate * 0.04);
    this.out = new Int16Array(this.chunk); this.n = 0; this.acc = 0; this.cnt = 0; this.phase = 0; this.sq = 0;
    this.muted = false; this.emit = emit;
  }
  push(ch) {
    for (let i = 0; i < ch.length; i++) {
      this.acc += ch[i]; this.cnt++; this.phase += 1;
      if (this.phase >= this.ratio) {
        this.phase -= this.ratio;
        let v = this.muted ? 0 : this.acc / this.cnt;
        this.acc = 0; this.cnt = 0;
        v = Math.max(-1, Math.min(1, v));
        this.sq += v * v;
        this.out[this.n++] = v < 0 ? v * 0x8000 : v * 0x7fff;
        if (this.n === this.chunk) {
          const level = Math.sqrt(this.sq / this.chunk);
          this.emit(this.out.buffer.slice(0), level);
          this.n = 0; this.sq = 0;
        }
      }
    }
  }
}
// The worklet is built from this script itself (no separate file to fetch or cache).
const WORKLET_SRC = `${Downsampler.toString()}
class NatterCapture extends AudioWorkletProcessor {
  constructor(o) {
    super();
    this.ds = new Downsampler(sampleRate, o.processorOptions.targetRate, (pcm, level) => this.port.postMessage({ pcm, level }, [pcm]));
    this.port.onmessage = (e) => { if (e.data && e.data.type === "mute") this.ds.muted = !!e.data.value; };
  }
  process(inputs) { const ch = inputs[0] && inputs[0][0]; if (ch) this.ds.push(ch); return true; }
}
registerProcessor("natter-capture", NatterCapture);`;
let workletLoadedFor = null;

async function makeCapture(src, sink, onChunk) {
  if (ctx.audioWorklet && window.AudioWorkletNode) {
    try {
      if (workletLoadedFor !== ctx) {
        const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: "application/javascript" }));
        try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
        workletLoadedFor = ctx;
      }
      const node = new AudioWorkletNode(ctx, "natter-capture", { processorOptions: { targetRate: RATE } });
      node.port.onmessage = (e) => onChunk(e.data.pcm, e.data.level);
      src.connect(node); node.connect(sink);
      debug("·", "mic capture: AudioWorklet");
      return { mute: (v) => node.port.postMessage({ type: "mute", value: v }), stop: () => { node.port.onmessage = null; try { node.disconnect(); } catch {} } };
    } catch (e) {
      debug("·", `AudioWorklet unavailable (${e.message}); using fallback capture`);
    }
  }
  // Fallback: ScriptProcessor on the main thread (deprecated but works everywhere).
  const proc = ctx.createScriptProcessor(2048, 1, 1);
  const ds = new Downsampler(ctx.sampleRate, RATE, onChunk);
  proc.onaudioprocess = (e) => ds.push(e.inputBuffer.getChannelData(0));
  src.connect(proc); proc.connect(sink);
  debug("·", "mic capture: fallback");
  return { mute: (v) => { ds.muted = v; }, stop: () => { proc.onaudioprocess = null; try { proc.disconnect(); } catch {} } };
}

async function startAudio() {
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  await ctx.resume();
  stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
  const src = ctx.createMediaStreamSource(stream);
  const sink = ctx.createGain(); sink.gain.value = 0; sink.connect(ctx.destination);
  capture = await makeCapture(src, sink, (pcm, level) => {
    if (!sources.size && !pending && ready) orb.style.setProperty("--s", (0.9 + Math.min(level * 3, 0.12)).toFixed(3));
    if (!ready || !ws || ws.readyState !== 1) return;
    const audio = b64FromBuffer(pcm);
    ws.send(JSON.stringify(proto === "legacy"
      ? { event: "media_input", stream_id: streamId, media: { payload: audio } }
      : { type: "audio_input", audio }));
  });
  micGate();
  try { wakeLock = await navigator.wakeLock?.request("screen"); } catch {}
}
function stopAudio() {
  stopPlayback();
  if (capture) { capture.stop(); capture = null; }
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  if (ctx) { ctx.close().catch(() => {}); ctx = null; }
  try { wakeLock?.release(); } catch {} wakeLock = null;
}

// ---------- server calls ----------
class Fatal extends Error {}
async function api(path, payload = {}) {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ passcode: prefs.pass, ...payload }) });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) { openSettings(true); throw new Fatal("Enter your passcode in Settings."); }
  if (!r.ok) { const e = new Error(data.error || `Request failed (${r.status})`); e.status = r.status; e.data = data; throw e; }
  return data;
}

// The last few saved conversations, condensed, so Natter remembers what you talked about.
function recentChats() {
  const all = store.json("natter-history", []).filter((c) => !conv || c.id !== conv.id).slice(0, 3);
  return all.map((c) => {
    const when = new Date(c.started).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
    const lines = c.turns.slice(-16).map((t) => `${t.role === "user" ? "Josh" : "Natter"}: ${t.text}`).join("\n");
    return `[${when} · ${MODES[c.mode] || "Yarn"}]\n${lines}`;
  }).join("\n\n").slice(0, 6000);
}

function recentText() {
  if (!conv) return "";
  return conv.turns.slice(-12).map((t) => `${t.role === "user" ? "Josh" : "You"}: ${t.text}`).join("\n");
}

async function credentials(prefer, reconnect) {
  try {
    return await api("/api/session", {
      mode: conv.mode, memory: conv.incognito ? "" : prefs.memory, voice: conv.voice?.id || "", prefer,
      expressive: prefs.expressive, persona: prefs.persona, incognito: conv.incognito,
      recentChats: conv.incognito ? "" : recentChats(),
      recent: reconnect ? recentText() : "",
    });
  } catch (e) {
    if (e instanceof Fatal || e.status === 500) throw new Fatal(e.message);
    throw e;
  }
}

// ---------- connection ----------
async function attempt(plan, reconnect) {
  let creds, url;
  const ver = "2026-08-14";
  if (plan === "session") {
    creds = await credentials("", reconnect);
    (creds.notes || []).forEach((n) => debug("·", n));
    if (creds.kind !== "session") { debug("·", "sessions API unavailable, trying token routes"); attempt.cached = creds; return false; }
    url = `${creds.url}?cartesia_version=${creds.version || ver}&access_token=${encodeURIComponent(creds.token)}`;
    proto = "v1";
  } else {
    creds = attempt.cached || await credentials("token", reconnect);
    attempt.cached = null;
    const id = encodeURIComponent(creds.agentId);
    const q = `cartesia_version=${creds.version || ver}&access_token=${encodeURIComponent(creds.token)}`;
    url = plan === "token-v1" ? `wss://api.cartesia.ai/v1/agents/websocket/${id}?${q}` : `wss://api.cartesia.ai/agents/stream/${id}?${q}`;
    proto = plan === "token-v1" ? "v1" : "legacy";
  }
  debug("→", `connecting via ${plan}`);
  return openSocket(url, creds);
}

function openSocket(url, creds) {
  return new Promise((resolve) => {
    const sock = new WebSocket(url);
    const serial = ++connSerial;
    let settled = false;
    const done = (ok) => { if (!settled) { settled = true; clearTimeout(timer); resolve(ok); } };
    const timer = setTimeout(() => { debug("·", "timed out waiting for ready"); try { sock.close(); } catch {} done(false); }, 12000);
    ws = sock; ready = false; streamId = null;

    sock.onopen = () => {
      const voiceId = conv.voice?.id;
      const msg = proto === "legacy"
        ? { event: "start", config: { input_format: "pcm_" + RATE, ...(voiceId ? { voice_id: voiceId } : {}) },
            agent: { system_prompt: creds.instructions, introduction: creds.intro } }
        : { type: "session_create", audio: { input_format: "pcm_" + RATE, output_delivery: "speaking_pace" } };
      sock.send(JSON.stringify(msg)); debug("→", msg);
    };
    sock.onmessage = (m) => {
      if (ws !== sock) return;
      let ev; try { ev = JSON.parse(m.data); } catch { return; }
      const type = ev.type || ev.event;
      if (type !== "audio_output" && type !== "media_output") debug("←", ev);
      if (type === "session_ready" || type === "ack") {
        ready = true; readyAt = Date.now(); streamId = ev.stream_id || null;
        if (conv) conv.plan = PLANS[planIdx];
        $("muteBtn").disabled = false; idleStatus(); done(true); return;
      }
      handleEvent(type, ev, serial);
    };
    sock.onerror = () => debug("·", "socket error");
    sock.onclose = (e) => {
      debug("·", `closed ${e.code} ${e.reason || ""}`);
      if (!settled) { done(false); return; }
      if (ws === sock) onDropped(e);
    };
  });
}

async function connect(fromPlan, reconnect) {
  for (let i = fromPlan; i < PLANS.length; i++) {
    planIdx = i;
    try {
      if (await attempt(PLANS[i], reconnect)) return true;
    } catch (e) {
      if (e instanceof Fatal) throw e;
      debug("·", `${PLANS[i]} failed: ${e.message}`);
    }
    if (userEnded) return false;
  }
  return false;
}

async function startCall() {
  stopReading(); flushTextMemory();
  userEnded = false; retries = 0; onCall = true; attempt.cached = null;
  $("mainBtn").textContent = "End"; $("mainBtn").className = "danger";
  $("pttBtn").classList.add("oncall");
  $("typeBox").placeholder = "End the call to type"; $("typeBox").disabled = true; $("sendBtn").disabled = true; document.body.classList.add("oncall");
  setStatus("Connecting…"); setOrb("thinking");
  conv = { id: Date.now().toString(36), started: new Date().toISOString(), mode: prefs.mode, voice: prefs.voice, incognito: prefs.incognito, plan: null, turns: [] };
  log.textContent = ""; bubbles.clear(); $("hero").style.display = "none"; stick = true;
  try {
    await startAudio();
    const ok = await connect(0, false);
    if (!ok && !userEnded) { endCall(false); setStatus("Couldn't connect. Turn on the connection log in Settings and try again.", true); }
    else if (ok && conv.plan === "token-v1") sysLine("Connected in basic mode. Memory, modes and voice choice need the sessions route.");
  } catch (e) {
    endCall(false);
    setStatus(e.name === "NotAllowedError" ? "Microphone access was blocked." : e.message, true);
  }
}

async function onDropped(e) {
  ready = false; stopPlayback(); $("muteBtn").disabled = true;
  if (userEnded || !onCall) return;
  if (Date.now() - readyAt > 30000) retries = 0;
  if (retries >= 3) { endCall(); setStatus(`Call dropped (${e.code}). Tap Start to try again.`, true); return; }
  retries++;
  const wait = 1000 * 2 ** (retries - 1);
  setOrb("thinking"); setStatus(`Reconnecting… (${retries}/3)`);
  sysLine("Connection dropped, reconnecting…");
  await new Promise((r) => setTimeout(r, wait));
  if (userEnded || !onCall) return;
  try {
    const ok = await connect(planIdx, true);
    if (!ok && !userEnded) onDropped({ code: e.code });
  } catch (err) { endCall(); setStatus(err.message, true); }
}

function endCall(save = true) {
  userEnded = true; onCall = false; ready = false; pttHeld = false;
  const sock = ws; ws = null;
  if (sock) { sock.onclose = null; try { sock.close(1000, "session completed"); } catch {} }
  stopAudio();
  $("mainBtn").textContent = "Start"; $("mainBtn").className = "primary";
  $("pttBtn").classList.remove("oncall", "held");
  $("typeBox").placeholder = "Type a message…"; $("typeBox").disabled = false; $("sendBtn").disabled = false; document.body.classList.remove("oncall");
  $("muteBtn").disabled = true; muted = false; $("muteBtn").setAttribute("aria-pressed", "false"); $("muteBtn").textContent = "Mute";
  orb.style.removeProperty("--s"); setOrb("idle"); setStatus("Ready when you are.");
  showHome(false);
  if (save && conv && conv.turns.length && !conv.incognito) { saveConv(); updateMemory(conv); }
}

// After a call: show the mode picker under the transcript. Tapping the logo clears back to the start.
function showHome(clear) {
  if (onCall) return;
  if (clear) { flushTextMemory(); stopReading(); log.textContent = ""; bubbles.clear(); conv = null; }
  $("heroText").textContent = log.childElementCount ? "Chat ended. Keep typing to carry on, or pick a mode and tap Start for a new one." : "Pick a mode, then tap Start and have a yarn, or type below.";
  $("hero").style.display = "";
  stick = true; followLog();
}
$("home").onclick = () => showHome(true);

// ---------- events ----------
function handleEvent(type, ev, serial) {
  switch (type) {
    case "audio_output": play(pcmFromB64(ev.audio)); break;
    case "media_output": play(pcmFromB64(ev.media && ev.media.payload || "")); break;
    case "audio_output_clear": case "clear": stopPlayback(); if (ready) idleStatus(); break;
    case "turn_started": if (ev.role === "assistant") bubble("assistant", ev.turn); break;
    case "turn_output_text_delta": { const el = bubble("assistant", ev.turn); el.dataset.raw = (el.dataset.raw || "") + (ev.text || ""); el.textContent = clean(el.dataset.raw); followLog(); break; }
    case "turn_ended": {
      if (!ev.text) break;
      const el = bubble(ev.role, ev.turn);
      const text = clean(ev.text);
      el.textContent = text; el.classList.toggle("cut", !!ev.interrupted);
      if (conv && text) { conv.turns.push({ role: ev.role, text, t: Date.now() }); saveConv(); }
      if (ev.role === "user" && !sources.size) { pending = true; setOrb("thinking"); setStatus("Thinking…"); }
      followLog(); break;
    }
    case "client_tool_call": runTool(ev); break;
    case "error": setStatus(ev.message || ev.error || "Something went wrong.", true); break;
    case "transfer_call": break;
  }
}

async function runTool(ev) {
  const name = ev.tool_name, p = ev.parameters || {};
  const label = { web_search: `Looking up "${p.query || ""}"…`, calendar_events: "Checking your calendar…", save_memory: "Saving to memory…" }[name] || `Running ${name}…`;
  const line = sysLine(label);
  let result, isError = false;
  try {
    if (name === "web_search") result = (await api("/api/tools/web", { query: p.query })).result;
    else if (name === "calendar_events") result = (await api("/api/tools/calendar", { start_date: p.start_date, end_date: p.end_date })).result;
    else if (name === "save_memory") {
      const note = String(p.note || "").trim();
      if (conv && conv.incognito) { result = "Not saved: this is an incognito chat."; }
      else if (note) { prefs.memory = (prefs.memory.trim() + "\n- " + note).trim(); $("memory").value = prefs.memory; }
      if (!(conv && conv.incognito)) result = note ? "Saved." : "Nothing to save.";
    } else { result = `Unknown tool ${name}.`; isError = true; }
    line.textContent = label.replace("…", " ✓");
  } catch (e) {
    result = e.message; isError = true; line.textContent = `${label.replace("…", "")}: ${e.message}`;
  }
  if (ev.expects_response !== false && ws && ws.readyState === 1) {
    const msg = { type: "client_tool_result", tool_call_id: ev.tool_call_id, result: String(result).slice(0, 15000), is_error: isError };
    ws.send(JSON.stringify(msg)); debug("→", { ...msg, result: msg.result.slice(0, 120) });
  }
}

// ---------- history & memory ----------
function saveConv() {
  if (!conv || conv.incognito) return;
  const all = store.json("natter-history", []);
  const i = all.findIndex((c) => c.id === conv.id);
  const copy = { id: conv.id, started: conv.started, mode: conv.mode, voice: conv.voice?.name || null, turns: conv.turns };
  if (i >= 0) all[i] = copy; else all.unshift(copy);
  store.setJson("natter-history", all.slice(0, 60));
}
async function updateMemory(c) {
  if (!prefs.autoMem || !features.memory || !c.turns.some((t) => t.role === "user")) return;
  try {
    const { memory } = await api("/api/summarize", { memory: prefs.memory, turns: c.turns });
    if (typeof memory === "string") { prefs.memory = memory; $("memory").value = memory; toast("Memory updated"); }
  } catch (e) { debug("·", `memory update failed: ${e.message}`); }
}

function renderHistory() {
  const list = $("histList"); list.textContent = "";
  const all = store.json("natter-history", []);
  if (!all.length) { list.innerHTML = '<p class="small">No conversations yet.</p>'; return; }
  for (const c of all) {
    const row = document.createElement("div"); row.className = "hitem";
    const meta = document.createElement("div"); meta.className = "meta";
    const when = new Date(c.started).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
    const first = c.turns.find((t) => t.role === "user");
    meta.innerHTML = `<div></div><div class="first"></div>`;
    meta.firstChild.textContent = `${when} · ${MODES[c.mode] || "Yarn"} · ${c.turns.length} turns`;
    meta.lastChild.textContent = first ? first.text : "(no words captured)";
    meta.onclick = () => showConv(c);
    const del = document.createElement("button"); del.textContent = "Delete";
    del.onclick = () => { store.setJson("natter-history", store.json("natter-history", []).filter((x) => x.id !== c.id)); renderHistory(); };
    row.append(meta, del); list.appendChild(row);
  }
}
function showConv(c) {
  $("histList").style.display = "none"; $("histActions").style.display = "none"; $("histView").style.display = "block";
  const box = $("histMsgs"); box.textContent = "";
  for (const t of c.turns) { const el = document.createElement("div"); el.className = "msg " + t.role; el.textContent = t.text; box.appendChild(el); }
}
$("histBack").onclick = () => { $("histView").style.display = "none"; $("histList").style.display = ""; $("histActions").style.display = ""; };
$("exportHist").onclick = () => {
  const blob = new Blob([JSON.stringify(store.json("natter-history", []), null, 2)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "natter-history.json"; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
$("clearHist").onclick = () => { if (confirm("Delete all saved conversations on this device?")) { store.setJson("natter-history", []); renderHistory(); } };

// ---------- voices ----------
let vCursor = null;
async function loadVoices(append = false) {
  const list = $("vlist");
  if (!append) { list.innerHTML = '<p class="small">Loading voices…</p>'; vCursor = null; }
  try {
    const data = await api("/api/voices", { q: $("vq").value.trim(), language: $("vlang").value, gender: $("vgender").value, cursor: append ? vCursor : null });
    if (!append) list.textContent = "";
    if (!data.voices.length && !append) list.innerHTML = '<p class="small">No voices match. Try another accent or search.</p>';
    for (const v of data.voices) list.appendChild(voiceRow(v));
    vCursor = data.next; $("vmore").style.display = vCursor ? "" : "none";
    markSelected();
  } catch (e) { if (!append) list.innerHTML = ""; const p = document.createElement("p"); p.className = "small"; p.textContent = e.message; list.appendChild(p); }
}
function voiceRow(v) {
  const row = document.createElement("div"); row.className = "voice"; row.dataset.id = v.id;
  const meta = document.createElement("div"); meta.className = "meta";
  meta.innerHTML = '<div class="name"></div><div class="desc"></div>';
  meta.firstChild.textContent = v.name + (v.accent ? ` · ${v.accent}` : "");
  meta.lastChild.textContent = v.tagline || v.description;
  row.appendChild(meta);
  if (v.preview) {
    const pb = document.createElement("button"); pb.textContent = "▶ Hear";
    pb.onclick = () => { const a = $("previewAudio"); if (a.dataset.id === v.id && !a.paused) { a.pause(); return; } a.src = v.preview; a.dataset.id = v.id; a.play().catch(() => toast("Couldn't play preview")); };
    row.appendChild(pb);
  }
  const use = document.createElement("button"); use.textContent = "Use"; use.className = "primary";
  use.onclick = () => { prefs.voice = { id: v.id, name: v.name }; markSelected(); showVoiceName(); toast(`Voice: ${v.name}`); };
  row.appendChild(use);
  return row;
}
function markSelected() {
  const id = prefs.voice?.id || "";
  document.querySelectorAll(".voice").forEach((el) => el.classList.toggle("sel", (el.dataset.id || "") === id));
}
function showVoiceName() { $("voiceName").textContent = prefs.voice ? prefs.voice.name : "Agent default"; }
$("defaultVoice").querySelector("button").onclick = () => { prefs.voice = null; markSelected(); showVoiceName(); toast("Using the agent's default voice"); };
$("voiceBtn").onclick = () => { $("voices").showModal(); loadVoices(); };
let vTimer; $("vq").oninput = () => { clearTimeout(vTimer); vTimer = setTimeout(() => loadVoices(), 350); };
$("vlang").onchange = () => loadVoices(); $("vgender").onchange = () => loadVoices();
$("vmore").onclick = () => loadVoices(true);
$("voices").addEventListener("close", () => $("previewAudio").pause());

// ---------- settings ----------
function renderModes() {
  for (const host of [$("modeChips"), $("modeSeg")]) {
    host.textContent = "";
    for (const [k, label] of Object.entries(MODES)) {
      const b = document.createElement("button"); b.textContent = label; b.setAttribute("aria-pressed", String(prefs.mode === k));
      b.onclick = () => { prefs.mode = k; renderModes(); if (onCall) toast("New mode applies from your next call"); };
      host.appendChild(b);
    }
  }
  $("modeTag").textContent = MODES[prefs.mode] + (prefs.incognito ? " · incognito" : "");
}
function renderTalk() {
  document.querySelectorAll("[data-talk]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.talk === prefs.talk)));
  document.body.classList.toggle("ptt", prefs.talk === "ptt");
  micGate(); if (ready) idleStatus();
}
document.querySelectorAll("[data-talk]").forEach((b) => (b.onclick = () => { prefs.talk = b.dataset.talk; pttHeld = false; renderTalk(); }));

function openSettings(focusPass) {
  $("memory").value = prefs.memory; $("autoMem").checked = prefs.autoMem;
  $("expressive").checked = prefs.expressive; $("incognito").checked = prefs.incognito; $("persona").value = prefs.persona; $("keep").value = String(prefs.keepDays); $("pass").value = prefs.pass; $("debugToggle").checked = prefs.debug;
  showVoiceName(); refreshStatus();
  if (!$("settings").open) $("settings").showModal();
  if (focusPass) setTimeout(() => $("pass").focus(), 50);
}
$("setBtn").onclick = () => openSettings(false);
$("histBtn").onclick = () => { $("histBack").click(); renderHistory(); $("history").showModal(); };
document.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => b.closest("dialog").close()));
document.querySelectorAll("dialog").forEach((d) => d.addEventListener("click", (e) => { if (e.target === d) d.close(); }));
$("saveMem").onclick = () => { prefs.memory = $("memory").value; toast("Memory saved"); };
$("clearMem").onclick = () => { if (confirm("Clear everything Natter remembers about you?")) { prefs.memory = ""; $("memory").value = ""; toast("Memory cleared"); } };
$("autoMem").onchange = (e) => (prefs.autoMem = e.target.checked);
$("expressive").onchange = (e) => { prefs.expressive = e.target.checked; if (onCall) toast("Applies from your next call"); };
$("incognito").onchange = (e) => { prefs.incognito = e.target.checked; renderModes(); toast(prefs.incognito ? "Incognito on: nothing saved from new chats" : "Incognito off"); };
$("persona").onchange = (e) => { prefs.persona = e.target.value; toast("Personality saved"); };
$("keep").onchange = (e) => { prefs.keepDays = Number(e.target.value); pruneHistory(); toast("Saved"); };
$("savePass").onclick = () => { prefs.pass = $("pass").value; toast("Passcode saved"); refreshStatus(); };
$("debugToggle").onchange = (e) => { prefs.debug = e.target.checked; document.body.classList.toggle("debugging", prefs.debug); $("debugLog").textContent = dbg.join("\n"); };
$("setupTools").onclick = async () => {
  const msg = $("toolsMsg"); msg.textContent = "Setting up…";
  try { const r = await api("/api/setup-tools"); msg.textContent = "Done: " + (r.log || []).join(", ") + ". Tools work from your next call."; }
  catch (e) { msg.textContent = `Didn't work: ${e.message}${e.data && e.data.detail ? " — " + JSON.stringify(e.data.detail).slice(0, 300) : ""}`; }
};

async function refreshStatus() {
  try { features = await (await fetch("/api/status")).json(); } catch { features = {}; }
  const names = { voice: "Voice (Cartesia)", memory: "Auto memory", web: "Web lookups", calendar: "Calendar", passcode: "Passcode lock" };
  const host = $("feat"); host.textContent = "";
  for (const [k, n] of Object.entries(names)) { const s = document.createElement("span"); s.textContent = n; if (features[k]) s.className = "on"; host.appendChild(s); }
}

// ---------- controls ----------
$("mainBtn").onclick = () => (onCall ? endCall() : startCall());
$("muteBtn").onclick = () => {
  muted = !muted; micGate();
  $("muteBtn").setAttribute("aria-pressed", String(muted)); $("muteBtn").textContent = muted ? "Unmute" : "Mute";
  if (ready && !sources.size) idleStatus();
};
function pttDown(e) { if (!onCall || prefs.talk !== "ptt") return; e?.preventDefault?.(); pttHeld = true; $("pttBtn").classList.add("held"); micGate(); if (ready && !sources.size) idleStatus(); }
function pttUp() { if (!pttHeld) return; pttHeld = false; $("pttBtn").classList.remove("held"); micGate(); if (ready && !sources.size) idleStatus(); }
const ptt = $("pttBtn");
ptt.addEventListener("pointerdown", (e) => { ptt.setPointerCapture?.(e.pointerId); pttDown(e); });
["pointerup", "pointercancel", "lostpointercapture"].forEach((t) => ptt.addEventListener(t, pttUp));
ptt.addEventListener("contextmenu", (e) => e.preventDefault());
const typing = (el) => el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");
document.addEventListener("keydown", (e) => { if (e.code === "Space" && !e.repeat && !typing(e.target) && !document.querySelector("dialog[open]") && onCall && prefs.talk === "ptt") pttDown(e); });
document.addEventListener("keyup", (e) => { if (e.code === "Space") pttUp(); });
window.addEventListener("blur", pttUp);

function pruneHistory() {
  const days = prefs.keepDays;
  if (!days) return;
  const cutoff = Date.now() - days * 86400000;
  const all = store.json("natter-history", []);
  const kept = all.filter((c) => new Date(c.started).getTime() >= cutoff);
  if (kept.length !== all.length) store.setJson("natter-history", kept);
}

// ---------- typed chat ----------
// Type instead of talking (when you're not on a voice call). Replies come from the
// same Natter (modes, memory, recent chats) and can be read aloud in your voice.
let reading = null, textBusy = false, memTimer = null;

function addMsg(role, text) {
  const el = document.createElement("div");
  el.className = "msg " + role; el.textContent = text;
  log.appendChild(el); $("hero").style.display = "none"; followLog();
  return el;
}
function stopReading() {
  if (reading) { reading.pause(); URL.revokeObjectURL(reading.src); reading = null; }
  if (!onCall) { setOrb("idle"); if (!textBusy) setStatus("Ready when you are."); }
}
// Typed chats update memory once you've gone quiet for a bit (or leave / start a call).
function scheduleTextMemory() {
  clearTimeout(memTimer);
  memTimer = setTimeout(flushTextMemory, 120000);
}
function flushTextMemory() {
  clearTimeout(memTimer); memTimer = null;
  if (conv && conv.typed && !conv.memorised && !conv.incognito && conv.turns.length) { conv.memorised = true; updateMemory(conv); }
}
async function readAloud(text) {
  if (!prefs.readAloud) return;
  try {
    const r = await fetch("/api/speak", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passcode: prefs.pass, text, voice: (conv && conv.voice && conv.voice.id) || "", speed: conv && conv.mode === "wind" ? 0.92 : 1 }) });
    if (!r.ok || !(r.headers.get("content-type") || "").startsWith("audio/")) {
      const d = await r.json().catch(() => ({})); throw new Error(d.error || `Speech failed (${r.status})`);
    }
    const url = URL.createObjectURL(await r.blob());
    stopReading();
    if (onCall) { URL.revokeObjectURL(url); return; }
    reading = new Audio(url);
    reading.onended = () => stopReading();
    setOrb("speaking"); setStatus("Reading the reply… (tap the orb to stop)");
    await reading.play();
  } catch (e) { debug("·", `read aloud failed: ${e.message}`); toast("Couldn't read that aloud"); stopReading(); }
}
async function sendTyped(text) {
  if (onCall) { toast("You're on a voice call. Just say it, or end the call to type."); return; }
  if (textBusy || !text.trim()) return;
  stopReading();
  // Keep going in the chat on screen (even one that started as a voice call), else start a new one.
  if (!conv) {
    conv = { id: Date.now().toString(36), started: new Date().toISOString(), mode: prefs.mode, voice: prefs.voice, incognito: prefs.incognito, plan: "text", turns: [] };
  }
  conv.typed = true; conv.memorised = false;
  const history = conv.turns.slice(-40).map((t) => ({ role: t.role, text: t.text }));
  addMsg("user", text.trim());
  conv.turns.push({ role: "user", text: text.trim(), t: Date.now() }); saveConv();
  const pendingEl = addMsg("assistant", "…"); pendingEl.classList.add("pending");
  textBusy = true; $("sendBtn").disabled = true; setOrb("thinking"); setStatus("Thinking…");
  try {
    const { reply } = await api("/api/chat", {
      text: text.trim(), history, mode: conv.mode, persona: prefs.persona, incognito: conv.incognito,
      memory: conv.incognito ? "" : prefs.memory, recentChats: conv.incognito ? "" : recentChats(),
    });
    const said = clean(reply);
    pendingEl.textContent = said; pendingEl.classList.remove("pending"); followLog();
    conv.turns.push({ role: "assistant", text: said, t: Date.now() }); saveConv();
    textBusy = false; $("sendBtn").disabled = false; setOrb("idle"); setStatus("Ready when you are.");
    scheduleTextMemory();
    readAloud(said);
  } catch (e) {
    pendingEl.remove();
    textBusy = false; $("sendBtn").disabled = false; setOrb("idle");
    setStatus(e.message, true);
  }
}
const typeBox = $("typeBox");
function sizeTypeBox() { typeBox.style.height = "auto"; typeBox.style.height = Math.min(140, typeBox.scrollHeight) + "px"; }
typeBox.addEventListener("input", sizeTypeBox);
typeBox.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("typeForm").requestSubmit(); }
});
$("typeForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = typeBox.value;
  if (!text.trim() || textBusy) return;
  if (onCall) { toast("You're on a voice call. Just say it, or end the call to type."); return; }
  typeBox.value = ""; sizeTypeBox();
  sendTyped(text);
});
function renderRead() { $("readBtn").setAttribute("aria-pressed", String(prefs.readAloud)); $("readBtn").textContent = prefs.readAloud ? "Read aloud" : "Silent"; }
$("readBtn").onclick = () => { prefs.readAloud = !prefs.readAloud; renderRead(); if (!prefs.readAloud) stopReading(); };
orb.addEventListener("click", () => { if (reading) stopReading(); });
window.addEventListener("pagehide", flushTextMemory);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushTextMemory(); });

// ---------- boot ----------
pruneHistory();
renderModes(); renderTalk(); renderRead(); showVoiceName(); refreshStatus();
document.body.classList.toggle("debugging", prefs.debug);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
