// End-to-end test of voice calls and typing against a fake Cartesia agent.
// Run: npm run test:e2e   (needs Playwright and Chrome: npx playwright install chromium)
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const server = spawn(process.execPath, [new URL('./server.mjs', import.meta.url).pathname], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((resolve, reject) => {
  server.stdout.once('data', resolve);
  server.once('exit', (code) => reject(new Error(`test server exited (${code})`)));
});
let failures = 0;
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, permissions: ['microphone'] });
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const ok = (label, cond, extra = '') => { if (!cond) failures++; console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ' — ' + extra : ''}`); };
const agent = (cmd) => fetch(`http://localhost:8787/__agent/${cmd}`);
const serverLog = async () => (await (await fetch('http://localhost:8787/__log')).json());
const status = () => page.textContent('#status');
await page.goto('http://localhost:8787/');
await page.evaluate(() => localStorage.setItem('natter-mode', 'think'));
await page.reload();

await page.click('#mainBtn');
await page.waitForFunction(() => document.querySelector('#status').textContent.match(/Listening|Speaking/), null, { timeout: 15000 });
ok('call connects', true, await status());
ok('typing box hidden and locked during call', await page.isDisabled('#typeBox') && !(await page.isVisible('#typeBox')));
await page.waitForSelector('.msg.assistant');
ok('greeting shown', (await page.textContent('.msg.assistant')).includes("G'day"));
await page.waitForTimeout(2500);
const ins = (await serverLog()).filter((l) => l.t === 'audioIn').map((l) => l.n);
ok('mic audio streams to agent', ins.some((n) => n > 10), `chunks/2s: ${ins.slice(-3).join(',')}`);
const sess = (await serverLog()).find((l) => l.t === 'sessions');
ok('session carries mode instructions', /thinking partner/i.test(sess?.instructions ?? ''));

await agent('user'); await page.waitForTimeout(300);
ok('user turn shown', (await page.$$eval('.msg.user', (e) => e.map((x) => x.textContent))).includes('Tell me about worgs please'));
ok('thinking state after user speaks', /Thinking/.test(await status()), await status());
await agent('reply'); await page.waitForTimeout(400);
ok('speaking state while audio plays', /Speaking/.test(await status()), await status());
await agent('clear'); await page.waitForTimeout(300);
ok('barge-in clears playback', /Listening/.test(await status()), await status());

await agent('tool'); await page.waitForTimeout(1500);
const toolRes = (await serverLog()).find((l) => l.t === 'ws-in' && l.ev.type === 'client_tool_result' && l.ev.tool_call_id === 'tc1');
ok('web tool result returned to agent', !!toolRes && /Lookup answer/.test(toolRes.ev.result), JSON.stringify(toolRes?.ev ?? {}));
await agent('remember'); await page.waitForTimeout(600);
ok('save_memory stores the note', (await page.evaluate(() => localStorage.getItem('natter-memory'))).includes('Josh likes worgs'));

// Scroll up during a long answer: must not yank you down; "Jump to latest" appears.
await agent('long'); await page.waitForTimeout(400);
await page.evaluate(() => { const s = document.querySelector('#scroll'); s.scrollTop = 0; s.dispatchEvent(new Event('scroll')); });
await agent('long'); await page.waitForTimeout(500);
const top = await page.evaluate(() => document.querySelector('#scroll').scrollTop);
ok('reading earlier lines is not interrupted by autoscroll', top < 50, `scrollTop ${top}`);
ok('"Jump to latest" offered', await page.isVisible('#jump.show'));
ok('End button reachable while scrolled up', await page.isVisible('#mainBtn'));
await page.click('#jump'); await page.waitForTimeout(600);

// Drop the connection: should reconnect and carry on.
await agent('drop');
await page.waitForFunction(() => /Reconnecting/.test(document.querySelector('#status').textContent), null, { timeout: 5000 }).then(() => ok('notices the drop and reconnects', true), () => ok('notices the drop and reconnects', false));
await page.waitForFunction(() => [...document.querySelectorAll('.msg.assistant')].some((e) => e.textContent.includes('lost you')), null, { timeout: 15000 }).then(() => ok('reconnected and resumed', true), () => ok('reconnected and resumed', false));
const sessCalls = (await serverLog()).filter((l) => l.t === 'sessions');
ok('reconnect sends the conversation so far', /connection just dropped/i.test(sessCalls.at(-1)?.instructions ?? ''), `${sessCalls.length} session calls`);

// Hang up.
await page.click('#mainBtn'); await page.waitForTimeout(1500);
ok('mode menu shown after the call', await page.isVisible('#hero') && (await page.textContent('#heroText')).includes('Chat ended'));
ok('typing box back after the call', !(await page.isDisabled('#typeBox')) && await page.isVisible('#typeBox'));
const hist = await page.evaluate(() => JSON.parse(localStorage.getItem('natter-history') || '[]'));
ok('call saved to history', hist.length === 1 && hist[0].turns.length >= 3, `${hist[0]?.turns.length} turns`);
ok('memory summarised after call', (await page.evaluate(() => localStorage.getItem('natter-memory'))).includes('talked about worgs'));
// Typing after the call continues that conversation.
await page.fill('#typeBox', 'One more thing about worgs'); await page.press('#typeBox', 'Enter');
await page.waitForFunction(() => document.querySelectorAll('.msg.assistant:not(.pending)').length > 3 && !document.querySelector('.msg.pending'), null, { timeout: 10000 });
const hist2 = await page.evaluate(() => JSON.parse(localStorage.getItem('natter-history') || '[]'));
ok('typed follow-up joins the same saved chat', hist2.length === 1 && hist2[0].turns.length === hist[0].turns.length + 2, `${hist2.length} chats, ${hist2[0]?.turns.length} turns`);

// Push-to-talk: second call, hold to talk.
await page.click('#home');
await page.evaluate(() => localStorage.setItem('natter-talk', 'ptt')); await page.reload();
await page.click('#mainBtn');
await page.waitForFunction(() => /Hold to talk|Speaking/.test(document.querySelector('#status').textContent), null, { timeout: 15000 });
await page.waitForTimeout(1200);
ok('PTT button visible during call', await page.isVisible('#pttBtn'));
const box = await page.locator('#pttBtn').boundingBox();
await page.mouse.move(box.x + 10, box.y + 10); await page.mouse.down(); await page.waitForTimeout(300);
ok('holding PTT listens', /Listening/.test(await status()), await status());
await page.mouse.up(); await page.waitForTimeout(200);
ok('releasing PTT stops listening', /Hold to talk/.test(await status()), await status());
await page.click('#mainBtn'); await page.waitForTimeout(800);
ok('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
server.kill();
process.exit(failures ? 1 : 0);
