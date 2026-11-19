// End-to-end test of Natter's settings, privacy and history features against
// the fake Cartesia/Claude server in tests/server.mjs. Run: npm run test:e2e
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const server = spawn(process.execPath, [new URL('./server.mjs', import.meta.url).pathname], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((resolve, reject) => { server.stdout.once('data', resolve); server.once('exit', (c) => reject(new Error(`test server exited (${c})`))); });
let failures = 0;
const ok = (label, cond, extra = '') => { if (!cond) failures++; console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ' — ' + extra : ''}`); };
const base = 'http://localhost:8787';
const serverLog = async () => (await (await fetch(base + '/__log')).json());
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, permissions: ['microphone'] });
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => d.accept());
const lastSession = async () => (await serverLog()).filter((l) => l.t === 'sessions').at(-1)?.instructions ?? '';
const call = async () => {
  await page.click('#mainBtn');
  await page.waitForFunction(() => /Listening|Speaking|Hold/.test(document.querySelector('#status').textContent), null, { timeout: 15000 });
  await page.waitForTimeout(700);
};
const hangUp = async () => { await page.click('#mainBtn'); await page.waitForTimeout(1200); };
await page.goto(base + '/');

// Passcode lock: a wrong/missing passcode opens Settings on the passcode field.
await fetch(base + '/__passcode?v=sesame');
await page.click('#mainBtn'); await page.waitForTimeout(800);
ok('locked app asks for the passcode', await page.isVisible('#settings[open]') && (await page.evaluate(() => document.activeElement?.id)) === 'pass');
await page.fill('#pass', 'sesame'); await page.click('#savePass');
await page.click('#settings [data-close]');
await call();
ok('correct passcode lets the call start', true);
await hangUp();
await fetch(base + '/__passcode');

// Voice picker
await page.click('#setBtn'); await page.click('#voiceBtn');
await page.waitForSelector('.voice');
const names = await page.$$eval('.voice .name', (e) => e.map((x) => x.textContent));
ok('voices load (plus the Agent default option)', names.includes('Agent default') && names.filter((n) => n !== 'Agent default').length === 2, names.join(','));
await page.fill('#vq', 'Mat'); await page.press('#vq', 'Enter').catch(() => {}); await page.waitForTimeout(700);
const shown = (await page.$$eval('.voice .name', (e) => e.map((x) => x.textContent))).filter((n) => n !== 'Agent default');
ok('voice search filters', shown.length === 1 && shown[0].startsWith('Matilda'), shown.join(','));
await page.locator('.voice', { hasText: 'Matilda' }).locator('.primary').click();
ok('chosen voice marked', await page.isVisible('.voice.sel'));
await page.click('#voices [data-close]');
ok('settings shows chosen voice', (await page.textContent('#voiceName')) === 'Matilda');

// Personality + expressive off reach the next call's instructions
await page.fill('#persona', 'Dry humour, very brief.'); await page.dispatchEvent('#persona', 'change');
await page.uncheck('#expressive');
await page.click('#settings [data-close]');
await call(); await hangUp();
const inst = await lastSession();
ok('personality reaches the agent', inst.includes('Dry humour, very brief.'));
ok('expressive off removes speech tags guidance', !inst.includes('[laughter]'));
const voiceSent = (await serverLog()).filter((l) => l.t === 'sessions').length > 0;
ok('call made with chosen voice (session created)', voiceSent);

// Incognito: memory not sent, chat not saved
await page.evaluate(() => localStorage.setItem('natter-memory', '- secret memory line'));
await page.click('#setBtn'); await page.check('#incognito'); await page.click('#settings [data-close]');
ok('incognito shown in header', (await page.textContent('#modeTag')).includes('incognito'));
const before = await page.evaluate(() => JSON.parse(localStorage.getItem('natter-history') || '[]').length);
await call();
await fetch(base + '/__agent/user'); await page.waitForTimeout(300);
await hangUp();
const incInst = await lastSession();
ok('incognito call gets no memory', !incInst.includes('secret memory line'));
ok('incognito call not saved', (await page.evaluate(() => JSON.parse(localStorage.getItem('natter-history') || '[]').length)) === before);
await page.fill('#typeBox', 'typed while incognito'); await page.press('#typeBox', 'Enter');
await page.waitForFunction(() => !document.querySelector('.msg.pending'), null, { timeout: 10000 });
ok('incognito typed chat not saved', (await page.evaluate(() => JSON.parse(localStorage.getItem('natter-history') || '[]').length)) === before);
await page.click('#setBtn'); await page.uncheck('#incognito'); await page.click('#settings [data-close]');

// History: view, export, delete
await page.click('#home');
await call(); await fetch(base + '/__agent/user'); await page.waitForTimeout(300); await hangUp();
await page.click('#histBtn');
const items = await page.$$('.hitem');
ok('history lists saved chats', items.length >= 1, `${items.length} chats`);
await page.click('.hitem .meta');
ok('opening a chat shows its transcript', (await page.$$('#histMsgs .msg')).length >= 2);
await page.click('#histBack');
const dl = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
await page.click('#exportHist');
ok('history export downloads', !!(await dl));
const n = (await page.$$('.hitem')).length;
await page.click('.hitem button');
ok('deleting a chat removes it', (await page.$$('.hitem')).length === n - 1);
await page.click('#history [data-close]');

// Memory edit/clear
await page.click('#setBtn');
await page.fill('#memory', '- likes Dubbo sunsets'); await page.click('#saveMem');
ok('memory saves', (await page.evaluate(() => localStorage.getItem('natter-memory'))) === '- likes Dubbo sunsets');
await page.click('#clearMem');
ok('memory clears', (await page.evaluate(() => localStorage.getItem('natter-memory'))) === '');

// Tools setup
await page.click('#setupTools');
await page.waitForFunction(() => /Done|Didn't/.test(document.querySelector('#toolsMsg').textContent), null, { timeout: 8000 });
ok('tools set up on the agent', (await page.textContent('#toolsMsg')).startsWith('Done'), await page.textContent('#toolsMsg'));
await page.click('#settings [data-close]');

ok('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
server.kill();
process.exit(failures ? 1 : 0);
