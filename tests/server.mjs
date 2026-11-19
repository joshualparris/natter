// Test server for tests/call.e2e.mjs: Natter's real page and API functions,
// with Claude, Cartesia REST and the Cartesia agent WebSocket faked.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// A short tone stands in for Cartesia speech.
const TONE = (() => { const n = 24000; const b = Buffer.alloc(44 + n * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(24000, 24); b.writeUInt32LE(48000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 8) * 3000), 44 + i * 2); return b; })();

export const log = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes('/agents/websocket/') && u.endsWith('/sessions')) {
    const body = JSON.parse(opts.body); log.push({ t: 'sessions', instructions: body.config_overrides?.instructions });
    return new Response(JSON.stringify({ url: 'ws://localhost:8788/agent', token: 'tok', call_id: 'c1' }), { status: 200 });
  }
  if (u.includes('/v1/messages')) {
    const b = JSON.parse(opts.body); const last = b.messages.at(-1).content;
    log.push({ t: 'claude', last: String(last).slice(0, 80) });
    const text = String(last).includes('Current notes') ? '- talked about worgs' : `Lookup answer for: ${String(last).slice(0, 30)}`;
    return new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text }] }), { status: 200 });
  }
  if (u.includes('/tts/bytes')) return new Response(TONE, { status: 200, headers: { 'content-type': 'audio/wav' } });
  if (u.includes('/agents/agent1')) return new Response(JSON.stringify({ voice_id: 'a0e99841-438c-4a64-b679-ae501e7d6091' }), { status: 200 });
  return realFetch(url, opts);
};
process.env.CARTESIA_API_KEY = 'c'; process.env.CARTESIA_AGENT_ID = 'agent1'; process.env.ANTHROPIC_API_KEY = 'k';
const routes = {};
for (const f of ['session', 'status', 'summarize', 'chat', 'tools-web', 'speak']) {
  const mod = (await import(path.join(ROOT, 'netlify/functions', `${f}.mjs`)));
  routes[mod.config.path] = mod.default;
}
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__log') { res.end(JSON.stringify(log)); return; }
  if (url.pathname.startsWith('/__agent/')) { agentCommand(url.pathname.split('/')[2]); res.end('ok'); return; }
  if (routes[url.pathname]) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = await routes[url.pathname](new Request('http://x' + req.url, { method: req.method, body: req.method === 'GET' ? undefined : Buffer.concat(chunks) }));
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer())); return;
  }
  const file = path.join(ROOT, 'public', url.pathname === '/' ? 'index.html' : url.pathname);
  try { const d = await readFile(file); res.writeHead(200, { 'content-type': file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' }); res.end(d); }
  catch { res.writeHead(404); res.end(); }
}).listen(8787);

// ---- fake Cartesia agent ----
let sock = null, audioIn = 0, turn = 0, sessions = 0;
const pcm = (ms) => { const n = Math.round(24000 * ms / 1000); const b = Buffer.alloc(n * 2); for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 8) * 3000), i * 2); return b.toString('base64'); };
function say(text, ms = 600) {
  turn++;
  sock.send(JSON.stringify({ type: 'turn_started', role: 'assistant', turn }));
  for (const w of text.split(' ')) sock.send(JSON.stringify({ type: 'turn_output_text_delta', turn, text: w + ' ' }));
  sock.send(JSON.stringify({ type: 'audio_output', audio: pcm(ms) }));
  sock.send(JSON.stringify({ type: 'turn_ended', role: 'assistant', turn, text }));
}
function agentCommand(cmd) {
  if (!sock) return;
  if (cmd === 'user') { turn++; sock.send(JSON.stringify({ type: 'turn_ended', role: 'user', turn, text: 'Tell me about worgs please' })); }
  if (cmd === 'reply') say('Worgs are big clever wolves. Want to know how to fight one?', 1500);
  if (cmd === 'long') { for (let i = 0; i < 12; i++) say(`Line ${i} of a long answer about something interesting and fairly wordy so it wraps.`, 50); }
  if (cmd === 'clear') sock.send(JSON.stringify({ type: 'audio_output_clear' }));
  if (cmd === 'tool') sock.send(JSON.stringify({ type: 'client_tool_call', tool_call_id: 'tc1', tool_name: 'web_search', parameters: { query: 'worg facts' } }));
  if (cmd === 'remember') sock.send(JSON.stringify({ type: 'client_tool_call', tool_call_id: 'tc2', tool_name: 'save_memory', parameters: { note: 'Josh likes worgs' } }));
  if (cmd === 'drop') sock.terminate();
}
const wss = new WebSocketServer({ port: 8788 });
wss.on('connection', (ws, req) => {
  sock = ws; sessions++;
  log.push({ t: 'ws-connect', q: req.url.split('?')[1]?.replace(/access_token=[^&]+/, 'access_token=…') });
  ws.on('message', (m) => {
    const ev = JSON.parse(m);
    if (ev.type === 'audio_input') { audioIn++; return; }
    log.push({ t: 'ws-in', ev: { ...ev, result: ev.result?.slice?.(0, 60) } });
    if (ev.type === 'session_create') { ws.send(JSON.stringify({ type: 'session_ready' })); setTimeout(() => say(sessions > 1 ? 'Sorry, lost you for a sec.' : "G'day. What's on your mind?"), 100); }
  });
});
setInterval(() => { log.push({ t: 'audioIn', n: audioIn }); audioIn = 0; if (log.length > 400) log.splice(0, 200); }, 2000);
console.log('ready');
