// v2 verification: pause/resume, audio graph, mute persistence, layout overlap, screenshots.
// usage: node v2test.js [url]   (needs playwright-core + /usr/bin/google-chrome)
const { chromium } = require('playwright-core');
const OUT = '/workspace/pelican-ride/screenshots';
const URL = process.argv[2] || 'file:///workspace/pelican-ride/pelican-ride.html';
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function overlapCheck(page, label) {
  const res = await page.evaluate(() => {
    const L = window.__pelican.layout, rects = [];
    const add = (name, r) => rects.push({ name, l: r.left, t: r.top, r: r.right, b: r.bottom });
    const el = sel => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return r.width ? r : null; };
    for (const sel of ['#hud', '#segctl', '#pauseBtn', '#muteBtn', '#home', '#bellBtn']) { const r = el(sel); if (r) add(sel, r); }
    const j = L.joy; add('joystick', { left: j.x - j.r, right: j.x + j.r, top: j.y - j.r - 24, bottom: j.y + j.r });
    const s = L.slider; add('slider', { left: s.x - s.w * 0.75, right: s.x + s.w * 0.75, top: s.top - s.w * 0.38 - 18, bottom: s.bottom + s.w * 0.3 });
    const hits = [];
    for (let a = 0; a < rects.length; a++) for (let b = a + 1; b < rects.length; b++) {
      const A = rects[a], B = rects[b];
      if (A.l < B.r && B.l < A.r && A.t < B.b && B.t < A.b) hits.push(A.name + ' x ' + B.name);
    }
    const off = rects.filter(r => r.l < 0 || r.t < 0 || r.r > L.W || r.b > L.H).map(r => r.name);
    return { hits, off, n: rects.length };
  });
  ok(res.hits.length === 0 && res.off.length === 0, `${label}: ${res.n} UI boxes, no overlaps/off-screen ${JSON.stringify(res)}`);
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const errors = [];
  const hook = p => { p.on('console', m => { if (['error', 'warning'].includes(m.type())) errors.push(`[${m.type()}] ${m.text()}`); }); p.on('pageerror', e => errors.push('[pageerror] ' + e.message)); };

  // ---------------- desktop
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage(); hook(page);
  await page.goto(URL); await sleep(800);
  let a = await page.evaluate(() => window.__pelican.audio);
  ok(!a.started && a.state === 'none', `no AudioContext before a user gesture (${a.state})`);
  await page.click('#start'); await sleep(600);
  a = await page.evaluate(() => window.__pelican.audio);
  ok(a.started && a.state === 'running', `AudioContext running after click (state=${a.state})`);
  ok(a.nodes > 40, `audio nodes created: ${a.nodes}`);
  await overlapCheck(page, 'desktop 1280x720');
  // set speed with the slider (mouse drag)
  const L = await page.evaluate(() => window.__pelican.layout);
  await page.mouse.move(L.slider.x, L.slider.bottom - 5); await page.mouse.down();
  await page.mouse.move(L.slider.x, L.slider.top + (L.slider.bottom - L.slider.top) * 0.15, { steps: 8 }); await page.mouse.up();
  await sleep(3000);
  a = await page.evaluate(() => window.__pelican.audio);
  ok(a.ticks > 10, `pedal ticks scheduled while riding: ${a.ticks}; music loop/step ${a.loop}/${a.step}; master gain ${a.master.toFixed(2)}`);
  await page.keyboard.press('KeyB'); await sleep(100);
  await page.click('#bellBtn'); await sleep(250);
  a = await page.evaluate(() => window.__pelican.audio);
  ok(a.bells === 2, `bell rang via B key and button: ${a.bells}`);
  await page.screenshot({ path: `${OUT}/v2-desktop-riding.png` });

  // pause via button
  await page.click('#pauseBtn'); await sleep(400);
  let s1 = await page.evaluate(() => window.__pelican.stats);
  await sleep(1500);
  let s2 = await page.evaluate(() => window.__pelican.stats);
  a = await page.evaluate(() => window.__pelican.audio);
  ok(s1.paused && s2.paused, 'paused via button');
  ok(s1.distance === s2.distance && s1.t === s2.t && s1.distance > 0, `distance frozen while paused (${s1.distance.toFixed(2)} -> ${s2.distance.toFixed(2)} m), clock frozen`);
  ok(a.state === 'suspended', `audio suspended while paused (${a.state})`);
  const hudBefore = await page.textContent('#dist');
  await page.screenshot({ path: `${OUT}/v2-desktop-paused.png` });
  // resume via Esc
  await page.keyboard.press('Escape'); await sleep(1200);
  let s3 = await page.evaluate(() => window.__pelican.stats);
  a = await page.evaluate(() => window.__pelican.audio);
  ok(!s3.paused && s3.distance > s2.distance + 1, `resume via Esc, distance advancing (${s3.distance.toFixed(2)} m)`);
  ok(a.state === 'running', `audio running again (${a.state})`);
  // P toggles
  await page.keyboard.press('KeyP'); await sleep(200);
  ok((await page.evaluate(() => window.__pelican.stats.paused)) === true, 'P pauses');
  await page.click('#resumeBtn'); await sleep(200);
  ok((await page.evaluate(() => window.__pelican.stats.paused)) === false, '继续 button resumes');
  // auto-pause when tab hidden
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  await sleep(400);
  s1 = await page.evaluate(() => window.__pelican.stats); a = await page.evaluate(() => window.__pelican.audio);
  ok(s1.paused && a.state === 'suspended', `auto-pause + audio suspend when tab hidden (${a.state})`);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
  await sleep(300);
  ok((await page.evaluate(() => window.__pelican.stats.paused)) === true, 'stays paused after tab becomes visible (waits for player)');
  // pause overlay menu -> title
  await page.click('#pauseMenuBtn'); await sleep(300);
  s1 = await page.evaluate(() => window.__pelican.stats); a = await page.evaluate(() => window.__pelican.audio);
  ok(s1.state === 'title' && !s1.paused && a.state === 'running', `菜单 in pause overlay returns to title, audio resumes (${a.state})`);
  // mute persistence
  await page.click('#muteBtn'); await sleep(400);
  a = await page.evaluate(() => window.__pelican.audio);
  const ls = await page.evaluate(() => localStorage.getItem('pelicanRide.muted'));
  ok(a.muted && ls === '1' && a.master < 0.05, `mute toggles master to ~0 and saves localStorage (${ls}, gain ${a.master.toFixed(3)})`);
  await page.reload(); await sleep(700);
  const cls = await page.getAttribute('#muteBtn', 'class');
  a = await page.evaluate(() => window.__pelican.audio);
  ok(cls.includes('muted') && a.muted, 'mute state restored after reload');
  await page.click('#start'); await sleep(500);
  a = await page.evaluate(() => window.__pelican.audio);
  ok(a.state === 'running' && a.master < 0.01, `muted session: context runs silently (gain ${a.master.toFixed(3)})`);
  await page.click('#muteBtn'); await sleep(500);
  a = await page.evaluate(() => window.__pelican.audio);
  ok(!a.muted && a.master > 0.3 && (await page.evaluate(() => localStorage.getItem('pelicanRide.muted'))) === '0', `unmute restores volume (${a.master.toFixed(2)})`);
  await ctx.close();

  // ---------------- mobile portrait + landscape
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const mp = await m.newPage(); hook(mp);
  await mp.goto(URL); await sleep(900);
  await mp.screenshot({ path: `${OUT}/v2-mobile-portrait-title.png` });
  await mp.tap('#start'); await sleep(400);
  a = await mp.evaluate(() => window.__pelican.audio);
  ok(a.state === 'running', `mobile: audio running after tap (${a.state})`);
  await overlapCheck(mp, 'mobile portrait 390x844');
  const cdp = await m.newCDPSession(mp);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id })) });
  const ML = await mp.evaluate(() => window.__pelican.layout);
  await touch('touchStart', [[ML.slider.x, ML.slider.bottom - 5, 2]]);
  for (let i = 1; i <= 10; i++) await touch('touchMove', [[ML.slider.x, ML.slider.bottom - 5 - i * (ML.slider.bottom - ML.slider.top) * 0.08, 2]]);
  await touch('touchEnd', []);
  await sleep(2200);
  await touch('touchStart', [[ML.joy.x, ML.joy.y, 1]]);
  for (let i = 1; i <= 5; i++) await touch('touchMove', [[ML.joy.x + i * 5, ML.joy.y, 1]]);
  await sleep(300);
  await mp.tap('#bellBtn'); await sleep(250);
  await mp.screenshot({ path: `${OUT}/v2-mobile-portrait-riding.png` });
  await touch('touchEnd', []);
  a = await mp.evaluate(() => window.__pelican.audio);
  ok(a.bells >= 1, `mobile bell tap: ${a.bells}`);
  await mp.tap('#pauseBtn'); await sleep(400);
  await mp.screenshot({ path: `${OUT}/v2-mobile-portrait-paused.png` });
  await mp.tap('#resumeBtn'); await sleep(300);
  await mp.setViewportSize({ width: 844, height: 390 }); await sleep(700);
  await overlapCheck(mp, 'mobile landscape 844x390');
  await mp.screenshot({ path: `${OUT}/v2-mobile-landscape-riding.png` });
  await m.close();

  await browser.close();
  ok(errors.length === 0, 'console errors/warnings: ' + (errors.length ? errors.join(' | ') : 'none'));
})();
