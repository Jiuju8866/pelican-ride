const { chromium } = require('playwright-core');
const OUT = '/workspace/pelican-ride/screenshots';
const URL = process.argv[2] || 'http://localhost:8765/index.html';
async function drive(page, ms, bias = 0) {
  const t0 = Date.now(); let held = null;
  while (Date.now() - t0 < ms) {
    const st = await page.evaluate(() => window.__pelican.stats);
    const err = st.playerX - bias + st.curve * 0.08;
    const want = err > 0.08 ? 'ArrowLeft' : err < -0.08 ? 'ArrowRight' : null;
    if (want !== held) { if (held) await page.keyboard.up(held); if (want) await page.keyboard.down(want); held = want; }
    await page.waitForTimeout(40);
  }
  if (held) await page.keyboard.up(held);
}
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [];
  const hook = page => {
    page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
    page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
  };
  // ---------- desktop
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage(); hook(page);
  await page.goto(URL);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/01-title.png` });
  await page.click('#start');
  await page.waitForTimeout(300);
  // drag speed slider to ~85% with mouse
  const geo = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  // slider: right side; find via hit test region
  const sx = geo.w - 60, sBot = geo.h - 50, sTop = sBot - 250;
  await page.mouse.move(sx, sBot - 20); await page.mouse.down();
  await page.mouse.move(sx, sBot - 230, { steps: 10 }); await page.mouse.up();
  await drive(page, 4000);
  await page.keyboard.down('ArrowRight'); await page.waitForTimeout(350);
  await page.screenshot({ path: `${OUT}/02-seaside-riding.png` });
  await page.keyboard.up('ArrowRight');
  console.log('sea stats', JSON.stringify(await page.evaluate(() => window.__pelican.stats)));
  await drive(page, 6000, -0.3);
  await page.screenshot({ path: `${OUT}/02b-seaside-riding.png` });
  // switch route in-game
  await page.click('#segctl [data-route="field"]');
  await page.waitForTimeout(500);
  await drive(page, 5000);
  await page.keyboard.down('ArrowLeft'); await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/03-countryside-riding.png` });
  await page.keyboard.up('ArrowLeft');
  await drive(page, 7000, 0.2);
  await page.screenshot({ path: `${OUT}/03b-countryside-riding.png` });
  console.log('field stats', JSON.stringify(await page.evaluate(() => window.__pelican.stats)));
  // fps estimate
  const fps = await page.evaluate(() => new Promise(r => { let n = 0; const t0 = performance.now(); (function f() { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(n / 2); })(); }));
  console.log('fps(headless,swiftshader)', fps);
  await ctx.close();
  // ---------- mobile portrait (touch)
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const mp = await m.newPage(); hook(mp);
  await mp.goto(URL);
  await mp.waitForTimeout(1200);
  await mp.screenshot({ path: `${OUT}/04-mobile-title.png` });
  await mp.tap('#start');
  await mp.waitForTimeout(300);
  // simulate touch drags through CDP (two fingers: joystick + slider)
  const cdp = await m.newCDPSession(mp);
  const touch = async (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id })) });
  const lay = await mp.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  await touch('touchStart', [[lay.w - 40, lay.h - 90, 2]]);
  for (let i = 1; i <= 10; i++) await touch('touchMove', [[lay.w - 40, lay.h - 90 - i * 18, 2]]);
  await touch('touchEnd', []);
  await mp.waitForTimeout(2000);
  await touch('touchStart', [[70, lay.h - 110, 1]]);
  for (let i = 1; i <= 6; i++) await touch('touchMove', [[70 + i * 4, lay.h - 110, 1]]);
  await mp.waitForTimeout(350);
  await mp.screenshot({ path: `${OUT}/05-mobile-portrait-riding.png` });
  console.log('mobile stats', JSON.stringify(await mp.evaluate(() => window.__pelican.stats)));
  await touch('touchEnd', []);
  // landscape phone
  await mp.setViewportSize({ width: 844, height: 390 });
  await mp.waitForTimeout(800);
  await mp.screenshot({ path: `${OUT}/06-mobile-landscape-riding.png` });
  await m.close();
  await browser.close();
  console.log('console errors/warnings:', errors.length ? errors.join('\n') : 'none');
})();
