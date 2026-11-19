// Runs Natter on emulated phones, a tablet and desktops (Chrome device emulation)
// against the fake server: layout fits, buttons are finger-sized, typing, a call,
// settings and history all work. Run: node tests/devices.e2e.mjs
import { spawn } from 'node:child_process';
import { chromium, devices } from 'playwright';
const server = spawn(process.execPath, [new URL('./server.mjs', import.meta.url).pathname], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => server.stdout.once('data', r));
const DEVICES = [
  ['iPhone SE', devices['iPhone SE']], ['iPhone 15 Pro', devices['iPhone 15 Pro'] ?? devices['iPhone 14 Pro']],
  ['Pixel 7', devices['Pixel 7']], ['Galaxy S9+', devices['Galaxy S9+']],
  ['iPhone 15 Pro landscape', devices['iPhone 15 Pro landscape'] ?? devices['iPhone 14 Pro landscape']],
  ['iPad Mini', devices['iPad Mini']], ['Desktop 1366', { viewport: { width: 1366, height: 768 } }], ['Desktop 1920', { viewport: { width: 1920, height: 1080 } }],
];
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const out = [];
for (const [name, dev] of DEVICES) {
  const { defaultBrowserType, ...opts } = dev;
  const ctx = await browser.newContext({ ...opts, permissions: ['microphone'] });
  const page = await ctx.newPage();
  const fails = []; const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('dialog', (d) => d.accept());
  const check = (l, c, x = '') => { if (!c) fails.push(`${l}${x ? ' (' + x + ')' : ''}`); };
  const vp = () => page.viewportSize();
  const onScreen = async (sel, label) => { const b = await page.locator(sel).first().boundingBox(); check(`${label} on screen`, !!b && b.y >= 0 && b.y + b.height <= vp().height + 1 && b.x + b.width <= vp().width + 1, b ? `y=${Math.round(b.y)}+${Math.round(b.height)} of ${vp().height}` : 'missing'); };
  const size = async (sel, label) => { if (!opts.hasTouch) return; const b = await page.locator(sel).first().boundingBox(); check(`${label} ≥40px tall for fingers`, !!b && b.height >= 40, b ? `${Math.round(b.height)}px` : ''); };
  const tap = async (sel) => { const l = page.locator(sel).first(); if (opts.hasTouch) await l.tap(); else await l.click(); };
  try {
    await page.goto('http://localhost:8787/');
    check('no sideways scroll', (await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1);
    for (const [s, l] of [['#mainBtn', 'Start button'], ['#typeBox', 'text box'], ['#sendBtn', 'Send'], ['#readBtn', 'Read aloud toggle']]) { await onScreen(s, l); await size(s, l); }
    await size('#histBtn', 'History button'); await size('#setBtn', 'Settings button');
    // typing
    await page.fill('#typeBox', 'Hello from ' + name); await tap('#sendBtn');
    await page.waitForFunction(() => document.querySelectorAll('.msg.assistant:not(.pending)').length >= 1, null, { timeout: 10000 });
    check('typed reply arrives', true);
    // a call
    await tap('#mainBtn');
    await page.waitForFunction(() => /Listening|Speaking/.test(document.querySelector('#status').textContent), null, { timeout: 15000 });
    await page.waitForTimeout(600);
    await onScreen('#mainBtn', 'End button during call'); await onScreen('#muteBtn', 'Mute button during call'); check('text box hidden during call', !(await page.isVisible('#typeBox')));
    await fetch('http://localhost:8787/__agent/long'); await page.waitForTimeout(500);
    await onScreen('#mainBtn', 'End button during a long answer');
    check('no sideways scroll during call', (await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1);
    await tap('#mainBtn'); await page.waitForTimeout(800);
    check('mode menu back after call', await page.isVisible('#hero'));
    // settings dialog fits and its last field is reachable by scrolling
    await tap('#setBtn'); await page.waitForTimeout(300);
    const dlg = await page.locator('#settings').boundingBox();
    check('settings fits the screen', !!dlg && dlg.height <= vp().height + 1 && dlg.width <= vp().width + 1, dlg ? `${Math.round(dlg.width)}x${Math.round(dlg.height)}` : '');
    await page.locator('#debugToggle').scrollIntoViewIfNeeded();
    await onScreen('#debugToggle', 'last setting (scrolled to)');
    await onScreen('#settings [data-close]', 'Settings Done button');
    await tap('#settings [data-close]'); await page.waitForTimeout(200);
    await tap('#histBtn'); await page.waitForTimeout(300);
    check('history lists chats', (await page.$$('.hitem')).length >= 1);
    await onScreen('#history [data-close]', 'History Done button');
    await tap('#history [data-close]');
    check('no page errors', errs.length === 0, errs.join(' | '));
    out.push(`${name.padEnd(24)} ${fails.length ? 'ISSUES' : 'ok'}${fails.length ? '\n    - ' + fails.join('\n    - ') : ''}`);
  } catch (e) {
    out.push(`${name.padEnd(24)} CRASH ${e.message.split('\n')[0]}`);
  }
  await ctx.close();
}
console.log(out.join('\n'));
await browser.close(); server.kill();
process.exit(out.some((l) => !/ ok$/.test(l.split('\n')[0])) ? 1 : 0);
