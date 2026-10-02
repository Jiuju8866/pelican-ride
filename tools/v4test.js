// v4 (batch 2) verification: time of day, weather, lights, world-space followers, pelican actions, ambient sound.
// usage: node v4test.js [url]   (needs playwright-core + /usr/bin/google-chrome)
const { chromium } = require('playwright-core');
const OUT = '/workspace/pelican-ride/screenshots';
const URL = process.argv[2] || 'file:///workspace/pelican-ride/pelican-ride.html';
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// average colour of the canvas (downsampled)
const frameStats = page => page.evaluate(() => {
  const c = document.getElementById('game'), s = document.createElement('canvas'); s.width = 64; s.height = 36;
  const g = s.getContext('2d'); g.drawImage(c, 0, 0, 64, 36);
  const d = g.getImageData(0, 0, 64, 36).data; let r = 0, gg = 0, b = 0, n = 0, sat = 0;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; sat += Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]); }
  return { r: r / n, g: gg / n, b: b / n, lum: (r * 0.3 + gg * 0.59 + b * 0.11) / n, sat: sat / n };
});

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const errors = [];
  const hook = p => { p.on('console', m => { if (['error', 'warning'].includes(m.type())) errors.push(`[${m.type()}] ${m.text()}`); }); p.on('pageerror', e => errors.push('[pageerror] ' + e.message)); };
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage(); hook(page);
  const S = () => page.evaluate(() => window.__pelican.stats);
  const D = (f, ...a) => page.evaluate(([f, a]) => window.__pelican.debug[f](...a), [f, a]);
  await page.goto(URL); await sleep(800);

  // ---- auto clock runs on the title screen
  let s0 = await S(); await sleep(2000); let s1 = await S();
  ok(s0.env.todMode === 'auto' && s1.env.tod > s0.env.tod, `auto time-of-day advances (${s0.env.tod.toFixed(3)} -> ${s1.env.tod.toFixed(3)})`);

  // ---- title "环境" panel
  await page.click('#envBtn'); await sleep(200);
  ok(await page.isVisible('#envPanel'), 'title 环境 panel opens');
  await page.click('#envPanel .envseg[data-kind="tod"] button[data-v="2"]'); await sleep(2500);
  s1 = await S();
  ok(s1.env.todMode === 2 && s1.env.dusk > 0.95, `title picker -> 黄昏 (dusk=${s1.env.dusk.toFixed(2)})`);
  await page.click('#envClose'); await sleep(150);
  ok(!(await page.isVisible('#envPanel')), 'env panel closes');

  await page.click('#start'); await sleep(500);
  await D('setSpeed', 0.55);
  // ---- every time of day x weather renders, on both routes
  const looks = {};
  for (const route of ['sea', 'field']) {
    if (route === 'field') { await page.click('#segctl [data-route="field"]'); await sleep(1200); }
    for (const tod of [0, 1, 2, 3]) for (const w of ['clear', 'rain', 'petals']) {
      await D('setTime', tod); await D('setWeather', w); await sleep(450);
      const st = await S(), fs = await frameStats(page);
      looks[`${route}-${tod}-${w}`] = { ...fs, st };
      const wOk = w === 'rain' ? st.drops > 30 : w === 'petals' ? st.petalCount > 5 : st.drops === 0 && st.petalCount === 0;
      const tOk = Math.abs(st.env.clock - tod) < 0.01 && st.env.phase === ['清晨', '正午', '黄昏', '夜晚'][tod];
      ok(wOk && tOk, `${route} ${st.env.phase}/${w}: renders (lum ${fs.lum.toFixed(0)}, rgb ${fs.r.toFixed(0)},${fs.g.toFixed(0)},${fs.b.toFixed(0)}, drops ${st.drops}, petals ${st.petalCount}, lights ${st.lights})`);
    }
  }
  const L = k => looks[k];
  ok(L('sea-3-clear').lum < L('sea-1-clear').lum * 0.6 && L('field-3-clear').lum < L('field-1-clear').lum * 0.6, `night is darker than noon (sea ${L('sea-3-clear').lum.toFixed(0)} vs ${L('sea-1-clear').lum.toFixed(0)})`);
  ok(L('sea-2-clear').r - L('sea-2-clear').b > L('sea-1-clear').r - L('sea-1-clear').b + 20, `dusk light is warmer (R-B ${(L('sea-2-clear').r - L('sea-2-clear').b).toFixed(0)} vs noon ${(L('sea-1-clear').r - L('sea-1-clear').b).toFixed(0)})`);
  ok(L('sea-1-rain').sat < L('sea-1-clear').sat && L('sea-1-rain').lum < L('sea-1-clear').lum, `rain is greyer & darker (sat ${L('sea-1-rain').sat.toFixed(0)} vs ${L('sea-1-clear').sat.toFixed(0)})`);
  ok(L('field-3-clear').st.env.moonVis > 0.5 && L('field-1-clear').st.env.sunVis > 0.5, 'moon up at night, sun up at noon');

  // ---- lights at night: lamps, windows, lighthouse beam
  await D('setTime', 3); await D('setWeather', 'clear');
  await D('warpToLandmark', 1, 50); await sleep(1500);
  let st = await S();
  ok(st.lights >= 4, `night countryside lights (lamps/windows) collected: ${st.lights}`);
  await page.screenshot({ path: `${OUT}/v4-night-countryside.png` });
  // windmill
  await D('warpToLandmark', 2, 30); await sleep(1000);
  await page.screenshot({ path: '/tmp/v4-windmill-night.png' });

  // ---- ambient sound adapts
  await sleep(2500);
  let a = await page.evaluate(() => window.__pelican.audio);
  ok(a.nightLevel > 0.6 && a.crickets > 0, `night crickets: level ${a.nightLevel.toFixed(2)}, chirps ${a.crickets}`);
  await D('setWeather', 'rain'); await sleep(2500);
  a = await page.evaluate(() => window.__pelican.audio);
  ok(a.rainLevel > 0.5 && a.drips > 0, `rain ambience: level ${a.rainLevel.toFixed(2)}, drips ${a.drips}`);
  await D('setTime', 1); await D('setWeather', 'clear'); await sleep(2500);
  a = await page.evaluate(() => window.__pelican.audio);
  const c0 = a.crickets, d0 = a.drips; await sleep(2000);
  const a2 = await page.evaluate(() => window.__pelican.audio);
  ok(a.rainTarget < 0.02 && a.nightTarget === 0 && a.rainLevel < 0.1 && a2.crickets === c0 && a2.drips === d0,
    `ambience back to day (rain bed ${a.rainLevel.toFixed(2)}, night bus target ${a.nightTarget}, no new chirps/drips)`);

  // ---- followers live in world space
  await D('setSpeed', 0.5); await page.evaluate(() => { window.__pelican.debug.clearFollowers(); }); await D('spawnFollowers', 1); await sleep(4500);
  let f0 = (await S()).followerPos[0];
  ok(f0 && f0.dz > 0 && f0.ss > 0, `follower cruising ahead of the rider in world space (dz ${f0 && f0.dz.toFixed(0)}, scale ${f0 && f0.ss.toFixed(2)})`);
  const before = (await S()).followerPos[0];
  await page.evaluate(() => { window.__pelican.debug.setX(window.__pelican.stats.playerX + 0.9); });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const after = (await S()).followerPos[0];
  ok(after && Math.abs(after.sx - before.sx) > 40, `follower shifts with the camera (perspective), not glued to the screen: sx ${before.sx.toFixed(0)} -> ${after.sx.toFixed(0)}`);
  await D('setX', 0);

  // ---- pelican small actions
  await D('setSpeed', 1); await sleep(5000);
  st = await S();
  ok(st.rider.spread > 0.4, `wings spread at high speed (spread ${st.rider.spread.toFixed(2)}, ${st.speedKmh.toFixed(0)} km/h)`);
  await D('setSpeed', 0); await sleep(4500);
  let yawMin = 9, yawMax = -9, blinked = false, puffed = 0, shot = false;
  for (let i = 0; i < 40; i++) {
    st = await S(); yawMin = Math.min(yawMin, st.rider.yaw); yawMax = Math.max(yawMax, st.rider.yaw);
    if (st.rider.blink > 0) blinked = true; puffed = Math.max(puffed, st.rider.puff);
    if (!shot && st.rider.yaw < -0.55) { await page.screenshot({ path: `${OUT}/v4-pelican-idle.png` }); shot = true; }
    await sleep(200);
  }
  ok(st.rider.idle > 0.8 && yawMin < -0.5 && yawMax > 0.5, `stopped pelican looks left & right (yaw ${yawMin.toFixed(2)}..${yawMax.toFixed(2)})`);
  ok(blinked, 'pelican blinks');
  ok(puffed > 0.5, `pelican puffs its pouch (max ${puffed.toFixed(2)})`);
  await D('setSpeed', 0.5); await sleep(2500);
  await D('warpToLandmark', 0, 40); await sleep(900);
  await page.keyboard.press('KeyC'); await sleep(200);
  st = await S();
  ok(st.rider.happy > 0.5, `happy wiggle after a postcard (happy ${st.rider.happy.toFixed(2)})`);

  // ---- pause menu picker applies instantly to the frozen scene
  await page.click('#pauseBtn'); await sleep(300);
  await page.click('#pause .envseg[data-kind="tod"] button[data-v="3"]'); await sleep(250);
  await page.click('#pause .envseg[data-kind="weather"] button[data-v="petals"]'); await sleep(250);
  st = await S();
  ok(st.paused && st.env.night > 0.99 && st.petalCount > 0, `pause-menu picker: 夜晚 + 落叶 applied while paused (night ${st.env.night}, leaves ${st.petalCount})`);
  await page.screenshot({ path: `${OUT}/v4-pause-picker.png` });
  const tPause = st.t; await sleep(800); st = await S();
  ok(st.t === tPause, 'scene stays frozen while paused');
  await page.click('#resumeBtn'); await sleep(300);

  // ---- persistence of the picker
  await page.reload(); await sleep(800);
  st = await S();
  ok(st.env.todMode === 3 && st.env.weatherMode === 'petals', `time/weather choice persisted (${st.env.todMode}/${st.env.weatherMode})`);

  // ---- hero screenshots
  await page.click('#start'); await sleep(400);
  await D('setSpeed', 0.6);
  await D('setTime', 2); await D('setWeather', 'clear'); await D('warpToLandmark', 1, 70); await sleep(1600);
  await page.screenshot({ path: `${OUT}/v4-dusk-seaside.png` });
  await D('setTime', 1); await D('setWeather', 'rain'); await D('warpToLandmark', 2, 40); await sleep(1600);
  await page.screenshot({ path: `${OUT}/v4-rain.png` });
  await D('setTime', 0); await D('setWeather', 'petals'); await D('warpToLandmark', 1, 44); await sleep(2500);
  await page.screenshot({ path: `${OUT}/v4-petals.png` });
  await D('setTime', 3); await D('setWeather', 'clear'); await D('warpToLandmark', 3, 75); await sleep(1600);
  await page.screenshot({ path: `${OUT}/v4-night-lighthouse.png` });

  // ---- frame rate at the heaviest setting (night + rain)
  await D('setWeather', 'rain'); await sleep(500);
  const fps = await page.evaluate(() => new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(n / 2); }; requestAnimationFrame(f); }));
  ok(fps > 20, `frame rate night+rain (headless software GL): ${fps.toFixed(0)} fps`);

  // ---- auto weather + auto time keep running during a ride
  await D('setTime', 'auto'); await D('setWeather', 'auto');
  s0 = await S(); await sleep(1500); s1 = await S();
  ok(s1.env.tod > s0.env.tod && s1.env.todMode === 'auto', 'auto cycle during the ride');

  // ---- mobile portrait
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const mp = await m.newPage(); hook(mp);
  await mp.goto(URL); await sleep(800);
  await mp.tap('#start'); await sleep(400);
  await mp.evaluate(() => { const d = window.__pelican.debug; d.setSpeed(0.55); d.setTime(2); d.setWeather('petals'); d.warpToLandmark(3, 36); });
  await sleep(2200);
  await mp.screenshot({ path: `${OUT}/v4-mobile-portrait.png` });
  await mp.tap('#pauseBtn'); await sleep(300);
  const pb = await mp.evaluate(() => { const r = document.querySelector('#pause .card').getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, W: innerWidth, H: innerHeight }; });
  ok(pb.l >= 0 && pb.r <= pb.W && pb.t >= 0 && pb.b <= pb.H, `mobile pause card with pickers fits on screen ${JSON.stringify(pb)}`);
  await mp.tap('#pause .envseg[data-kind="tod"] button[data-v="3"]'); await sleep(200);
  ok((await mp.evaluate(() => window.__pelican.stats.env.night)) > 0.99, 'mobile tap on 夜晚 works');
  await mp.screenshot({ path: `${OUT}/v4-mobile-pause.png` });
  const ml = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const lp = await ml.newPage(); hook(lp);
  await lp.goto(URL); await sleep(600); await lp.tap('#start'); await sleep(300); await lp.tap('#pauseBtn'); await sleep(300);
  const lb = await lp.evaluate(() => { const r = document.querySelector('#pause .card').getBoundingClientRect(); return { t: r.top, b: r.bottom, H: innerHeight }; });
  ok(lb.t >= 0 && lb.b <= lb.H, `landscape phone pause card fits ${JSON.stringify(lb)}`);
  await lp.screenshot({ path: '/tmp/v4-landscape-pause.png' });

  ok(errors.length === 0, `console errors/warnings: ${errors.length ? errors.join(' | ') : 'none'}`);
  await browser.close();
})();
