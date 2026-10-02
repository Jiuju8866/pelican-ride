// Batch-1 verification: journey/finish, postcards + album, pickups, collisions, persistence, layout. Screenshots v3-*.png
const { chromium } = require('playwright-core');
const OUT = '/workspace/pelican-ride/screenshots';
const URL = process.argv[2] || 'file:///workspace/pelican-ride/pelican-ride.html';
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const S = p => p.evaluate(() => window.__pelican.stats);
async function until(page, fn, ms = 8000, every = 50) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await page.evaluate(fn); if (v) return v; await sleep(every); } return null; }
async function overlap(page, label) {
  const res = await page.evaluate(() => {
    const L = window.__pelican.layout, R = [];
    const add = (n, r) => R.push({ n, l: r.left, t: r.top, r: r.right, b: r.bottom });
    for (const sel of ['#hud', '#segctl', '#pauseBtn', '#muteBtn', '#home', '#bellBtn', '#photoBtn']) { const e = document.querySelector(sel); if (!e) continue; const r = e.getBoundingClientRect(); if (r.width && getComputedStyle(e).display !== 'none') add(sel, r); }
    const j = L.joy; add('joystick', { left: j.x - j.r, right: j.x + j.r, top: j.y - j.r - 24, bottom: j.y + j.r });
    const s = L.slider; add('slider', { left: s.x - s.w * 0.75, right: s.x + s.w * 0.75, top: s.top - s.w * 0.38 - 18, bottom: s.bottom + s.w * 0.3 });
    const hits = []; for (let a = 0; a < R.length; a++) for (let b = a + 1; b < R.length; b++) { const A = R[a], B = R[b]; if (A.l < B.r && B.l < A.r && A.t < B.b && B.t < A.b) hits.push(A.n + ' x ' + B.n); }
    return { n: R.length, names: R.map(r => r.n), hits, off: R.filter(r => r.l < 0 || r.t < 0 || r.r > L.W || r.b > L.H).map(r => r.n) };
  });
  ok(!res.hits.length && !res.off.length, `${label}: ${res.n} boxes (${res.names.join(' ')}) hits=${JSON.stringify(res.hits)} off=${JSON.stringify(res.off)}`);
}
async function rideToFinish(page, ms = 170000) {
  const t0 = Date.now(); let held = null; const shot = new Set();
  while (Date.now() - t0 < ms) {
    const st = await page.evaluate(() => window.__pelican.stats);
    if (st.state === 'finished') break;
    const err = st.playerX + st.curve * 0.06;
    const want = err > 0.07 ? 'ArrowLeft' : err < -0.07 ? 'ArrowRight' : null;
    if (want !== held) { if (held) await page.keyboard.up(held); if (want) await page.keyboard.down(want); held = want; }
    if (st.zone && !shot.has(st.zone)) { shot.add(st.zone); await sleep(500); await page.keyboard.press('KeyC'); }
    await sleep(50);
  }
  if (held) await page.keyboard.up(held);
  return (Date.now() - t0) / 1000;
}
async function setSpeed(page, frac) {
  const L = await page.evaluate(() => window.__pelican.layout);
  await page.mouse.move(L.slider.x, L.slider.bottom - 3); await page.mouse.down();
  await page.mouse.move(L.slider.x, L.slider.bottom - (L.slider.bottom - L.slider.top) * frac, { steps: 6 }); await page.mouse.up();
}
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const errors = [];
  const hook = p => { p.on('console', m => { if (['error', 'warning'].includes(m.type())) errors.push(`[${m.type()}] ${m.text()}`); }); p.on('pageerror', e => errors.push('[pageerror] ' + e.message)); };
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage(); hook(page);
  await page.goto(URL); await sleep(900);
  await page.screenshot({ path: `${OUT}/v3-title.png` });
  await page.click('#start'); await sleep(300);
  let s = await S(page);
  ok(s.state === 'play' && s.idx < 30 && s.journey === 3400, `ride starts at the start arch (idx ${s.idx}/${s.journey})`);
  await setSpeed(page, 0.7); await sleep(1500);

  // --- pickup
  let it = await page.evaluate(() => window.__pelican.debug.nextItem(4));
  await page.evaluate(i => window.__pelican.debug.warpIdx(i.idx - 10), it);
  const p0 = (await S(page)).pickups;
  const got = await until(page, `(() => { window.__pelican.debug.setX(${it.offset}); return window.__pelican.stats.pickups > ${p0}; })()`, 6000);
  s = await S(page);
  ok(got && s.rideCoins >= 1 && s.save.coins >= 1, `collectible picked up (ride ${s.rideCoins}, total ${s.save.coins})`);

  // --- gentle collision
  await page.evaluate(() => window.__pelican.debug.setX(0)); await sleep(300);
  let so = await page.evaluate(() => window.__pelican.debug.nextSolid(4));
  await page.evaluate(o => window.__pelican.debug.warpIdx(o.idx - 8), so);
  const c0 = (await S(page)).collisions, v0 = (await S(page)).speedKmh;
  const hit = await until(page, `(() => { if (window.__pelican.stats.collisions > ${c0}) return true; window.__pelican.debug.setX(${so.offset}); return false; })()`, 8000);
  await sleep(120);
  s = await S(page);
  ok(hit && s.collisions === c0 + 1, `bumped into roadside "${so.name}" at offset ${so.offset.toFixed(2)} -> collisions ${s.collisions}, bounced to x=${s.playerX.toFixed(2)}, speed ${v0.toFixed(1)}→${s.speedKmh.toFixed(1)} km/h`);
  await page.evaluate(() => window.__pelican.debug.setX(0));

  // --- landmark photo spot
  await page.evaluate(() => window.__pelican.debug.warpToLandmark(0, 50)); await sleep(800);
  s = await S(page);
  const photoVisible = await page.evaluate(() => { const b = document.getElementById('photoBtn'); return !b.classList.contains('hidden') && b.classList.contains('pulse') && b.getBoundingClientRect().width > 0; });
  ok(s.zone === 'icecream' && photoVisible, `photo zone "${s.zone}" -> 拍照 button visible & pulsing`);
  await overlap(page, 'desktop 1280x720 with photo button');
  await page.screenshot({ path: `${OUT}/v3-riding-photo.png` });
  await page.click('#photoBtn', { force: true }); await sleep(500);
  const pc = await page.evaluate(() => localStorage.getItem('pelicanRide.pc.sea.icecream'));
  s = await S(page);
  ok(pc && JSON.parse(pc).img.startsWith('data:image/jpeg') && s.photosThisRide.includes('icecream'), `postcard saved to localStorage (${pc ? Math.round(pc.length / 1024) : 0} KB JPEG dataURL)`);
  await page.screenshot({ path: `${OUT}/v3-photo-taken.png` });
  await sleep(2500);

  // --- second landmark via C key
  await page.evaluate(() => window.__pelican.debug.warpToLandmark(2, 40)); await sleep(700);
  await page.keyboard.press('KeyC'); await sleep(400);
  ok(!!(await page.evaluate(() => localStorage.getItem('pelicanRide.pc.sea.pier'))), 'C key takes a postcard at 码头');

  // --- pause -> album
  await page.click('#pauseBtn'); await sleep(200);
  await page.click('#pauseAlbumBtn'); await sleep(400);
  const alb = await page.evaluate(() => ({ vis: !document.getElementById('album').classList.contains('hidden'), imgs: document.querySelectorAll('#albGrid img').length, slots: document.querySelectorAll('#albGrid .pc').length }));
  ok(alb.vis && alb.imgs === 2 && alb.slots === 4, `album from pause menu shows ${alb.imgs} collected of ${alb.slots} slots`);
  await page.screenshot({ path: `${OUT}/v3-album.png` });
  const d1 = (await S(page)).distance; await sleep(600); const d2 = (await S(page)).distance;
  ok(d1 === d2, 'game stays paused while album is open');
  await page.keyboard.press('Escape'); await sleep(150);
  ok(await page.evaluate(() => document.getElementById('album').classList.contains('hidden')), 'Esc closes album');
  await page.keyboard.press('Escape'); await sleep(300);
  ok(!(await S(page)).paused, 'Esc resumes ride');

  // --- finish: a genuine full ride at top speed (no warps), photographing every landmark with the C key
  await page.click('#home'); await sleep(200); await page.click('#start'); await sleep(200);
  await setSpeed(page, 1.0);
  const secs = await rideToFinish(page);
  const fin = (await S(page)).state === 'finished';
  console.log(`     (full seaside journey took ${secs.toFixed(0)} s wall-clock at max speed)`);
  await sleep(1600);
  const res = await page.evaluate(() => ({ vis: !document.getElementById('results').classList.contains('hidden'), time: document.getElementById('resTime').textContent, dist: document.getElementById('resDist').textContent, avg: document.getElementById('resAvg').textContent, pc: document.getElementById('resPc').textContent, coins: document.getElementById('resCoins').textContent, best: document.getElementById('resBest').textContent, thumbs: document.querySelectorAll('#resThumbs img').length }));
  s = await S(page);
  ok(fin && res.vis, `finish reached -> results card: ${JSON.stringify(res)}`);
  ok(s.save.best.sea > 60 && s.save.rides.sea >= 1, `best time saved (${(s.save.best.sea || 0).toFixed(1)} s)`);
  await page.screenshot({ path: `${OUT}/v3-finish.png` });
  await page.click('#againBtn'); await sleep(400);
  s = await S(page);
  ok(s.state === 'play' && s.idx < 30 && s.rideCoins === 0, '再骑一次 restarts the journey');
  // 换路线 from results
  await page.evaluate(() => window.__pelican.debug.warp(0.99));
  await until(page, () => !document.getElementById('results').classList.contains('hidden'), 15000);
  await page.click('#switchBtn'); await sleep(900);
  s = await S(page);
  ok(s.route === 'field' && s.state === 'play' && s.idx < 30, '换路线 starts the countryside journey');
  await setSpeed(page, 0.75);
  await page.evaluate(() => window.__pelican.debug.warpToLandmark(1, 45)); await sleep(1500);
  await page.screenshot({ path: `${OUT}/v3-countryside-landmark.png` });
  // menu -> title album
  await page.click('#home'); await sleep(300);
  await page.click('#albumBtn'); await sleep(300);
  ok((await page.evaluate(() => document.querySelectorAll('#albGrid img').length)) >= 0 && !(await page.evaluate(() => document.getElementById('album').classList.contains('hidden'))), 'album reachable from title');
  await page.click('#albTabs [data-atab="sea"]'); await sleep(200);
  ok((await page.evaluate(() => document.querySelectorAll('#albGrid img').length)) === 4, 'title album 海边 tab shows all 4 postcards');
  await page.click('#albumClose');
  // persistence
  const before = await S(page);
  await page.reload(); await sleep(800);
  const after = await S(page);
  ok(after.save.coins === before.save.coins && after.save.totalDist > 0 && after.save.best.sea > 0, `save persisted after reload (coins ${after.save.coins}, total ${after.save.totalDist.toFixed(0)} m)`);
  ok((await page.textContent('#totals')).includes('4/8'), 'title totals: ' + (await page.textContent('#totals')));
  // pause still freezes
  await page.click('#start'); await setSpeed(page, 0.8); await sleep(1200);
  await page.keyboard.press('KeyP'); await sleep(200);
  const f1 = await S(page); await sleep(800); const f2 = await S(page);
  ok(f1.distance === f2.distance && f1.rideTime === f2.rideTime, 'pause freezes distance + ride time');
  await ctx.close();

  // --- mobile portrait / landscape
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const mp = await m.newPage(); hook(mp);
  await mp.goto(URL); await sleep(900);
  await mp.tap('#start'); await sleep(300);
  const cdp = await m.newCDPSession(mp);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id })) });
  const ML = await mp.evaluate(() => window.__pelican.layout);
  await touch('touchStart', [[ML.slider.x, ML.slider.bottom - 3, 2]]);
  for (let i = 1; i <= 8; i++) await touch('touchMove', [[ML.slider.x, ML.slider.bottom - 3 - i * (ML.slider.bottom - ML.slider.top) * 0.09, 2]]);
  await touch('touchEnd', []);
  await mp.evaluate(() => window.__pelican.debug.warpToLandmark(3, 50)); await sleep(1500);
  await overlap(mp, 'mobile portrait 390x844 with photo button');
  await mp.screenshot({ path: `${OUT}/v3-mobile-portrait.png` });
  await mp.tap('#photoBtn', { force: true }); await sleep(400);
  ok(!!(await mp.evaluate(() => localStorage.getItem('pelicanRide.pc.sea.lighthouse'))), 'mobile tap on 拍照 saves postcard');
  await sleep(1500);
  await mp.setViewportSize({ width: 844, height: 390 });
  await mp.evaluate(() => window.__pelican.debug.warpToLandmark(3, 42)); await sleep(900);
  await overlap(mp, 'mobile landscape 844x390 with photo button');
  await mp.screenshot({ path: `${OUT}/v3-mobile-landscape.png` });
  await mp.setViewportSize({ width: 390, height: 844 });
  await mp.evaluate(() => window.__pelican.debug.warp(0.99));
  await until(mp, () => !document.getElementById('results').classList.contains('hidden'), 15000);
  await mp.screenshot({ path: `${OUT}/v3-mobile-finish.png` });
  await mp.tap('#resMenuBtn'); await sleep(300); await mp.tap('#albumBtn'); await sleep(300);
  await mp.screenshot({ path: `${OUT}/v3-mobile-album.png` });
  await m.close();
  await browser.close();
  ok(errors.length === 0, 'console errors/warnings: ' + (errors.length ? errors.join(' | ') : 'none'));
})();
