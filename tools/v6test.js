// v6 (batch 4) verification: 打卡方式 (auto / manual check-in), settings panel + persistence, assist & cruise,
// volume buses, haptics, wardrobe unlock / equip, save migration / export / import / reset, quality, fireworks,
// PWA (service worker under a sub-path + offline reload). Screenshots v6-*.png
// usage: node v6test.js [singleFileUrl]   (needs playwright-core + /usr/bin/google-chrome + python3)
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const OUT = '/workspace/pelican-ride/screenshots';
const URL = process.argv[2] || 'file:///workspace/pelican-ride/pelican-ride.html';
const freePort = () => new Promise(r => { const sv = require('net').createServer(); sv.listen(0, '127.0.0.1', () => { const p = sv.address().port; sv.close(() => r(p)); }); });
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const S = p => p.evaluate(() => window.__pelican.stats);
const D = (p, f, ...a) => p.evaluate(([f, a]) => window.__pelican.debug[f](...a), [f, a]);
const G = (p, k) => p.evaluate(k => window.__pelican.debug[k], k);
const LS = p => p.evaluate(() => JSON.parse(localStorage.getItem('pelicanRide.v2') || 'null'));
async function until(page, fn, ms = 8000, every = 50, arg) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await page.evaluate(fn, arg); if (v) return v; await sleep(every); } return null; }
const VIB = () => { window.__vib = []; Object.defineProperty(navigator, 'vibrate', { configurable: true, value: p => { window.__vib.push(p); return true; } }); };
async function overlapHud(page, label) {
  const res = await page.evaluate(() => {
    const L = window.__pelican.layout, R = [];
    const add = (n, r) => R.push({ n, l: r.left, t: r.top, r: r.right, b: r.bottom });
    for (const sel of ['#hud', '#routeBtn', '#cruiseBtn', '#pauseBtn', '#muteBtn', '#home', '#bellBtn', '#photoBtn']) { const e = document.querySelector(sel); if (!e) continue; const r = e.getBoundingClientRect(); if (r.width && getComputedStyle(e).display !== 'none') add(sel, r); }
    const j = L.joy; add('joystick', { left: j.x - j.r, right: j.x + j.r, top: j.y - j.r - 24, bottom: j.y + j.r });
    const s = L.slider; add('slider', { left: s.x - s.w * 0.75, right: s.x + s.w * 0.75, top: s.top - s.w * 0.38 - 18, bottom: s.bottom + s.w * 0.3 });
    const hits = []; for (let a = 0; a < R.length; a++) for (let b = a + 1; b < R.length; b++) { const A = R[a], B = R[b]; if (A.l < B.r && B.l < A.r && A.t < B.b && B.t < A.b) hits.push(A.n + ' x ' + B.n); }
    return { n: R.length, hits, off: R.filter(r => r.l < 0 || r.t < 0 || r.r > L.W || r.b > L.H).map(r => r.n) };
  });
  ok(!res.hits.length && !res.off.length, `${label}: HUD ${res.n} boxes, hits=${JSON.stringify(res.hits)} off=${JSON.stringify(res.off)}`);
}
// ride towards landmark i of the current route without touching any control; resolve with what happened in the zone
async function rideThroughLandmark(page, i, { watchBtn = false } = {}) {
  await page.evaluate(i => { window.__pelican.debug.warpToLandmark(i, 70); window.__pelican.debug.setSpeed(0.85); }, i);
  const lm = (await D(page, 'landmarks'))[i];
  let btnBefore = null, inZone = false, t0 = Date.now();
  while (Date.now() - t0 < 15000) {
    const r = await page.evaluate(() => { const s = window.__pelican.stats, b = document.getElementById('photoBtn'); return { zone: s.zone, idx: s.idx, photos: s.photosThisRide, btn: !b.classList.contains('hidden') && getComputedStyle(b).display !== 'none', pulse: b.classList.contains('pulse'), mini: b.classList.contains('mini'), txt: b.textContent.trim(), next: document.getElementById('pnext').textContent, now: document.querySelectorAll('.pmk.now').length }; });
    if (r.zone === lm.id) { inZone = true; if (watchBtn && btnBefore === null && !r.photos.includes(lm.id)) btnBefore = r; }
    if (r.photos.includes(lm.id)) return { lm, shot: true, btnBefore, inZone, after: r };
    if (r.idx > lm.idx + 2) return { lm, shot: false, btnBefore, inZone, after: r };
    await sleep(40);
  }
  return { lm, shot: false, btnBefore, inZone, timeout: true };
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  const hook = p => { p.on('console', m => { if (['error', 'warning'].includes(m.type())) errors.push(`[${m.type()}] ${m.text()}`); }); p.on('pageerror', e => errors.push('[pageerror] ' + e.message)); };
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(VIB);
  const page = await ctx.newPage(); hook(page);
  await page.goto(URL); await sleep(900);

  // ---------------------------------------------------------------- defaults
  let st = await G(page, 'settings');
  ok(st.checkin === 'auto' && st.assist === 'off' && st.cruise === false && st.quality === 'auto' && st.vibrate === true, `defaults: 打卡方式=自动打卡, assist off, cruise off, quality auto (${JSON.stringify(st)})`);
  const pw = await G(page, 'pwa');
  ok(pw.singleFile && pw.sw === 'none', `single-file build skips the service worker (${JSON.stringify(pw)})`);
  ok(await page.evaluate(() => !document.querySelector('link[rel=manifest]')), 'single-file build has no manifest link (no file:// errors)');

  // ---------------------------------------------------------------- 自动打卡: no input, every landmark of a pass
  await page.click('#start'); await sleep(400);
  const r0 = await rideThroughLandmark(page, 0, { watchBtn: true });
  ok(r0.inZone && r0.shot, `auto check-in fired at「${r0.lm.name}」with no tap or key press`);
  ok(r0.btnBefore && !r0.btnBefore.btn, `auto mode: no required 拍照 button in the zone before the check-in (visible=${r0.btnBefore && r0.btnBefore.btn})`);
  await sleep(380);
  await page.screenshot({ path: `${OUT}/v6-auto-checkin.png` });
  let c = await G(page, 'checkins');
  const toastTxt = await page.textContent('#toast');
  s = await S(page);
  ok(c.auto >= 1 && c.last.id === r0.lm.id && /打卡成功/.test(toastTxt) && toastTxt.includes(r0.lm.name), `check-in toast 「${toastTxt.trim()}」 (why=${c.last.why}, ${c.last.lmIdx - c.last.idx} segs before the landmark)`);
  ok(s.rider.happy > 0.3, `pelican cheers / hops at the check-in (happy=${s.rider.happy.toFixed(2)})`);
  const fr = c.last.frame;
  ok(fr && fr.lm && (fr.lm.y1 - fr.lm.y0) / fr.h > 0.3 && fr.w <= 1280 * 0.75, `best framing: landmark fills ${fr && fr.lm ? Math.round((fr.lm.y1 - fr.lm.y0) / fr.h * 100) : 0}% of the photo height, crop ${fr ? Math.round(fr.w) : 0}px wide`);
  let ls = await LS(page);
  const pc0 = ls.postcards.sea && ls.postcards.sea[r0.lm.id];
  ok(pc0 && pc0.img.startsWith('data:image/jpeg'), `auto check-in saved the postcard to the v2 save (${pc0 ? Math.round(pc0.img.length / 1024) : 0} KB)`);
  const btnAfter = r0.after;      // sampled right at the check-in (the zone ends a few segments later)
  ok(btnAfter.btn && btnAfter.mini && !btnAfter.pulse && btnAfter.txt === '再拍', `after the check-in only a small optional 「再拍」 button shows (${JSON.stringify({ vis: btnAfter.btn, mini: btnAfter.mini, pulse: btnAfter.pulse, txt: btnAfter.txt })})`);
  const prog = await page.evaluate(() => ({ now: document.querySelectorAll('.pmk.now').length, got: document.querySelectorAll('.pmk.got').length }));
  ok(prog.now === 1 && prog.got >= 1 && btnAfter.now === 1 && /已打卡/.test(btnAfter.next), `progress bar dot marked (${prog.now} now / ${prog.got} got) + 「${btnAfter.next}」`);
  const vib = await page.evaluate(() => window.__vib.slice());
  ok((await G(page, 'buzz')).last === 'checkin' && vib.length >= 1, `check-in vibrates (navigator.vibrate calls: ${JSON.stringify(vib)})`);
  for (let i = 1; i < 4; i++) {
    const r = await rideThroughLandmark(page, i);
    c = await G(page, 'checkins');
    ok(r.shot && c.last.id === r.lm.id, `auto check-in at「${r.lm.name}」(${c.last.why}, ${c.last.lmIdx - c.last.idx} segs ahead, landmark ${c.last.frame && c.last.frame.lm ? Math.round((c.last.frame.lm.y1 - c.last.frame.lm.y0) / c.last.frame.h * 100) : '–'}% of photo height)`);
  }
  const autoAfterPass = (await G(page, 'checkins')).auto;
  // second pass: it happens again on every pass
  await page.evaluate(() => document.getElementById('home').click()); await sleep(300);
  await page.click('#start'); await sleep(400);
  const r2 = await rideThroughLandmark(page, 0);
  ok(r2.shot && (await G(page, 'checkins')).auto === autoAfterPass + 1, 'auto check-in fires again on the next pass of the same landmark');
  // album shows check-ins
  await page.keyboard.press('Escape'); await sleep(200);
  await page.click('#pauseAlbumBtn'); await sleep(300);
  const alb = await page.evaluate(() => ({ stats: document.getElementById('albStats').textContent, stamps: document.querySelectorAll('#albGrid .stampok').length, cap: document.querySelector('#albGrid .pc.got small') && document.querySelector('#albGrid .pc.got small').textContent }));
  ok(alb.stamps === 4 && /已打卡 4\/28/.test(alb.stats) && /打卡/.test(alb.cap), `album: 4 已打卡 stamps, 「已打卡 4/28」, caption 「${alb.cap}」`);
  await page.click('#albumClose'); await sleep(150);

  // ---------------------------------------------------------------- 手动打卡 via the one-line pause toggle
  ok(await page.isVisible('#pause .setseg[data-set="checkin"]'), 'pause menu has the one-line 打卡 toggle');
  await page.click('#pause .setseg[data-set="checkin"] [data-v="manual"]'); await sleep(150);
  ls = await LS(page);
  ok((await G(page, 'settings')).checkin === 'manual' && ls.settings.checkin === 'manual', 'pause toggle switches to 手动打卡 and saves it');
  await page.click('#resumeBtn'); await sleep(200);
  const before = (await G(page, 'checkins')).auto;
  const r3 = await rideThroughLandmark(page, 1, { watchBtn: true });
  ok(r3.inZone && !r3.shot && (await G(page, 'checkins')).auto === before, `manual mode: riding through「${r3.lm.name}」without tapping takes no photo`);
  ok(r3.btnBefore && r3.btnBefore.btn && r3.btnBefore.pulse && !r3.btnBefore.mini && /拍/.test(r3.btnBefore.txt), `manual mode: pulsing 「${r3.btnBefore && r3.btnBefore.txt.trim()}」 button shows in the zone`);
  await page.evaluate(() => { window.__pelican.debug.warpToLandmark(2, 30); window.__pelican.debug.setSpeed(0.3); });
  await until(page, () => !!window.__pelican.stats.zone, 4000);
  await page.keyboard.press('KeyC'); await sleep(300);
  s = await S(page);
  ok(s.photosThisRide.includes((await D(page, 'landmarks'))[2].id), 'manual mode: C key takes the photo');
  await page.click('#photoBtn', { force: true }).catch(() => {});
  // back to auto through the settings panel (pause → 设置)
  await page.keyboard.press('Escape'); await sleep(150);
  await page.click('#pauseSettingsBtn'); await sleep(250);
  ok(await page.isVisible('#settingsPanel'), 'pause menu → 设置 opens the settings panel');
  await page.click('#settingsPanel .setseg[data-set="checkin"] [data-v="auto"]'); await sleep(100);
  ok((await G(page, 'settings')).checkin === 'auto' && await page.evaluate(() => document.querySelector('#pause .setseg [data-v="auto"]').classList.contains('active')), 'settings panel 打卡方式 switches back to 自动打卡 (pause toggle in sync)');
  await page.keyboard.press('Escape'); await sleep(150);
  ok(!(await page.isVisible('#settingsPanel')), 'Esc closes the settings panel');
  await page.keyboard.press('Escape'); await sleep(150);

  // ---------------------------------------------------------------- volume sliders → gain nodes
  let a = await page.evaluate(() => window.__pelican.audio);
  ok(a.started && a.buses, `audio running with music/amb/sfx buses (${JSON.stringify(a.buses)})`);
  await page.evaluate(() => { const r = document.querySelector('[data-vol="music"]'); r.value = 30; r.dispatchEvent(new Event('input', { bubbles: true })); const q = document.querySelector('[data-vol="sfx"]'); q.value = 50; q.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(500);
  a = await page.evaluate(() => window.__pelican.audio);
  ok(Math.abs(a.buses.music - 0.55 * 0.3) < 0.02 && Math.abs(a.buses.sfx - 0.9 * 0.5) < 0.02 && Math.abs(a.buses.amb - 0.9) < 0.02, `sliders drive the bus gains (music ${a.buses.music.toFixed(3)}, sfx ${a.buses.sfx.toFixed(3)}, amb ${a.buses.amb.toFixed(3)})`);
  ok(a.master > 0.1 && !a.muted, `master mute still independent (master ${a.master.toFixed(2)})`);

  // ---------------------------------------------------------------- haptics: bell / bump / off-road
  await page.evaluate(() => { window.__vib.length = 0; });
  await page.keyboard.press('KeyB'); await sleep(100);
  ok((await page.evaluate(() => window.__vib.length)) === 1, 'bell vibrates');
  await page.evaluate(() => { window.__pelican.debug.setX(0.85); window.__pelican.debug.setSpeed(1); });
  await page.keyboard.down('ArrowRight'); await sleep(900); await page.keyboard.up('ArrowRight');
  ok((await page.evaluate(() => window.__vib.length)) >= 2, `riding off the path vibrates (${await page.evaluate(() => JSON.stringify(window.__vib))})`);
  await page.click('#pauseBtn'); await sleep(120);
  await page.click('#pauseSettingsBtn'); await sleep(200);
  await page.click('#settingsPanel .setseg[data-set="vibrate"] [data-v="false"]'); await sleep(80);
  await page.keyboard.press('Escape'); await sleep(80); await page.keyboard.press('Escape'); await sleep(120);
  await page.evaluate(() => { window.__vib.length = 0; }); await page.keyboard.press('KeyB'); await sleep(100);
  ok((await page.evaluate(() => window.__vib.length)) === 0, '震动反馈 off: no vibration');

  // ---------------------------------------------------------------- assist & cruise keep the rider on curvy roads
  async function curveRun(mode, route, secs = 14) {
    await D(page, 'setRoute', route); await sleep(250);
    await D(page, 'setSetting', 'assist', mode === 'cruise' ? 'off' : mode);
    await D(page, 'setSetting', 'cruise', mode === 'cruise');
    await D(page, 'warp', 0.08); await D(page, 'setX', 0); await D(page, 'setSpeed', 1);
    let maxX = 0, off = 0, n = 0, curv = 0, coins0 = (await S(page)).pickups, coll0 = (await S(page)).collisions;
    const t0 = Date.now();
    while (Date.now() - t0 < secs * 1000) { const s = await S(page); maxX = Math.max(maxX, Math.abs(s.playerX)); if (s.offroad) off++; if (Math.abs(s.curve) > 1) curv++; n++; await sleep(60); }
    const s = await S(page);
    return { maxX, off, n, curv, coins: s.pickups - coins0, coll: s.collisions - coll0 };
  }
  const offRun = await curveRun('off', 'forest');
  const light = await curveRun('light', 'forest');
  const strong = await curveRun('strong', 'forest');
  const cruise = await curveRun('cruise', 'forest');
  ok(offRun.curv > 10 && offRun.off > 0, `no assist, hands off: the curves push the rider off the path (max |x| ${offRun.maxX.toFixed(2)}, off-road ${offRun.off}/${offRun.n} samples, ${offRun.curv} in curves)`);
  ok(light.off < offRun.off && light.maxX < offRun.maxX, `转向辅助 轻: stays nearer the path (max |x| ${light.maxX.toFixed(2)}, off-road ${light.off}/${light.n})`);
  ok(strong.off === 0 && strong.maxX < 0.92, `转向辅助 强: never leaves the path through the curves (max |x| ${strong.maxX.toFixed(2)})`);
  ok(cruise.off === 0 && cruise.maxX < 0.92, `巡航模式: steers itself through the curves (max |x| ${cruise.maxX.toFixed(2)}, coins +${cruise.coins}, bumps ${cruise.coll})`);
  const cr2 = await curveRun('cruise', 'snow', 10);
  ok(cr2.off === 0, `巡航模式 on the mountain road too (max |x| ${cr2.maxX.toFixed(2)})`);
  const cbtn = await page.evaluate(() => ({ on: document.getElementById('cruiseBtn').classList.contains('on'), vis: getComputedStyle(document.getElementById('cruiseBtn')).display !== 'none' }));
  ok(cbtn.on && cbtn.vis, 'in-game 巡航 quick button shows the active state');
  await page.screenshot({ path: `${OUT}/v6-cruise.png` });
  await page.keyboard.press('KeyQ'); await sleep(120);
  ok(!(await G(page, 'settings')).cruise && !(await page.evaluate(() => document.getElementById('cruiseBtn').classList.contains('on'))), 'Q toggles cruise off again');
  await page.click('#cruiseBtn'); await sleep(100);
  ok((await G(page, 'settings')).cruise, '巡航 button toggles cruise on');
  await page.click('#cruiseBtn'); await sleep(100);
  await overlapHud(page, 'desktop HUD with 巡航 button');

  // ---------------------------------------------------------------- fireworks: bigger bursts
  await D(page, 'setRoute', 'city'); await D(page, 'setQuality', 'high'); await D(page, 'setTime', '3'); await D(page, 'setWeather', 'clear'); await sleep(300);
  await D(page, 'firework'); await D(page, 'firework');
  await until(page, () => window.__pelican.stats.fwSparks > 0, 4000);
  await sleep(150);
  s = await S(page);
  ok(s.fwPeak >= 80, `fireworks: bigger bursts (${s.fwPeak} sparks at peak; was ≤34 per burst)`);

  // ---------------------------------------------------------------- quality
  await D(page, 'setQuality', 'low'); await sleep(200);
  let q = await G(page, 'quality');
  ok(q.level === 'low' && q.dist === 125, `画质 低 applies (draw distance ${q.dist})`);
  await D(page, 'setQuality', 'auto'); await sleep(100);
  await D(page, 'setRoute', 'city'); await D(page, 'setSpeed', 0.8); await D(page, 'warp', 0.3);
  await sleep(9000);
  q = await G(page, 'quality');
  ok(['high', 'med', 'low'].includes(q.level) && q.fps > 20, `画质 自动 in the night city: level ${q.level}, ${q.fps.toFixed(1)} fps, changes: ${JSON.stringify(q.log)}`);
  await page.click('#pauseBtn'); await sleep(100); await page.click('#pauseSettingsBtn'); await sleep(200);
  const qn = await page.textContent('#qualNote');
  ok(/当前：(高|中|低)/.test(qn), `settings shows the current quality level (「${qn}」)`);
  await page.keyboard.press('Escape'); await sleep(80); await page.keyboard.press('Escape'); await sleep(80);

  // ---------------------------------------------------------------- settings panel from the title + persistence across reload
  await page.evaluate(() => document.getElementById('home').click()); await sleep(300);
  ok(await page.isVisible('#settingsBtn') && await page.isVisible('#wardrobeBtn'), 'title has 设置 and 换装 buttons');
  await page.click('#settingsBtn'); await sleep(250);
  await page.click('#settingsPanel .setseg[data-set="assist"] [data-v="strong"]');
  await page.click('#settingsPanel .setseg[data-set="quality"] [data-v="med"]');
  await page.click('#settingsPanel .setseg[data-set="checkin"] [data-v="manual"]');
  await sleep(150);
  await page.screenshot({ path: `${OUT}/v6-settings.png` });
  const panelFit = await page.evaluate(() => { const r = document.querySelector('.setcard').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth; });
  ok(panelFit, 'settings panel fits the 1280x720 viewport');
  await page.reload(); await sleep(900);
  st = await G(page, 'settings');
  ok(st.assist === 'strong' && st.quality === 'med' && st.checkin === 'manual' && st.vibrate === false && Math.abs(st.vol.music - 0.3) < 0.01 && Math.abs(st.vol.sfx - 0.5) < 0.01, `settings survive a reload (${JSON.stringify(st)})`);
  await page.click('#settingsBtn'); await sleep(200);
  const ui = await page.evaluate(() => ({ assist: document.querySelector('#settingsPanel [data-set="assist"] .active').dataset.v, q: document.querySelector('#settingsPanel [data-set="quality"] .active').dataset.v, music: document.querySelector('[data-vol="music"]').value, ck: document.querySelector('#settingsPanel [data-set="checkin"] .active').textContent }));
  ok(ui.assist === 'strong' && ui.q === 'med' && ui.music === '30' && ui.ck === '手动打卡', `settings UI reflects the saved values (${JSON.stringify(ui)})`);
  await page.click('#settingsPanel .setseg[data-set="checkin"] [data-v="auto"]'); await page.click('#settingsPanel .setseg[data-set="assist"] [data-v="off"]');
  await page.click('#settingsPanel .setseg[data-set="quality"] [data-v="auto"]');
  await page.click('#settingsClose'); await sleep(150);

  // ---------------------------------------------------------------- wardrobe
  await page.click('#wardrobeBtn'); await sleep(300);
  ok(await page.isVisible('#wardrobe') && (await page.$$eval('#wardTabs [data-wcat]', e => e.length)) === 5, 'wardrobe opens with 5 categories (车身/围巾/帽子/眼镜/车筐)');
  await page.click('#wardTabs [data-wcat="hat"]'); await sleep(150);
  let items = await page.evaluate(() => [...document.querySelectorAll('#wardGrid .witem')].map(b => ({ id: b.dataset.item, locked: b.classList.contains('locked'), tag: b.querySelector('small').textContent, lock: !!b.querySelector('small svg') })));
  ok(items.length === 6 && items.filter(i => i.locked).length === 5 && items.find(i => i.id === 'hat:straw').tag.includes('40 金币') && items.find(i => i.id === 'hat:crown').tag.includes('12 张明信片') && items.find(i => i.id === 'hat:straw').lock, `hats: lock icon + price shown (${items.map(i => i.id.split(':')[1] + '=' + i.tag).join(', ')})`);
  const coins0 = (await S(page)).save.coins;
  await page.click('#wardGrid [data-item="hat:straw"]'); await sleep(150);
  let buy = await page.evaluate(() => ({ vis: !document.getElementById('wardBuy').classList.contains('hidden'), dis: document.getElementById('wardBuy').disabled, msg: document.getElementById('wardMsg').textContent }));
  if (coins0 < 40) ok(buy.vis && buy.dis && /金币不够/.test(buy.msg), `too few coins: buy disabled (「${buy.msg}」)`);
  await D(page, 'addCoins', 500); await page.click('#wardTabs [data-wcat="hat"]'); await page.click('#wardGrid [data-item="hat:straw"]'); await sleep(150);
  buy = await page.evaluate(() => ({ vis: !document.getElementById('wardBuy').classList.contains('hidden'), dis: document.getElementById('wardBuy').disabled, txt: document.getElementById('wardBuy').textContent }));
  ok(buy.vis && !buy.dis && buy.txt.includes('40 金币'), `with coins: 「${buy.txt}」 enabled`);
  await page.click('#wardBuy'); await sleep(200);
  let o = await G(page, 'outfit');
  s = await S(page);
  ok(o.hat === 'straw' && (await G(page, 'owned')).includes('hat:straw') && s.save.coins === coins0 + 500 - 40, `bought + equipped 草帽 (coins ${coins0 + 500} → ${s.save.coins})`);
  await page.click('#wardGrid [data-item="hat:crown"]'); await sleep(150);
  buy = await page.evaluate(() => ({ dis: document.getElementById('wardBuy').disabled, msg: document.getElementById('wardMsg').textContent }));
  ok(buy.dis && /明信片/.test(buy.msg), `小皇冠 needs postcards: 「${buy.msg}」`);
  await page.click('#wardTabs [data-wcat="glasses"]'); await page.click('#wardGrid [data-item="glasses:round"]'); await page.click('#wardBuy'); await sleep(150);
  await page.click('#wardTabs [data-wcat="bike"]'); await page.click('#wardGrid [data-item="bike:coral"]'); await page.click('#wardBuy'); await sleep(150);
  await page.click('#wardTabs [data-wcat="basket"]'); await page.click('#wardGrid [data-item="basket:flowers"]'); await page.click('#wardBuy'); await sleep(150);
  await page.click('#wardTabs [data-wcat="hat"]'); await sleep(150);
  o = await G(page, 'outfit');
  ok(o.hat === 'straw' && o.glasses === 'round' && o.bike === 'coral' && o.basket === 'flowers', `outfit equipped: ${JSON.stringify(o)}`);
  await page.screenshot({ path: `${OUT}/v6-wardrobe.png` });
  // equip an owned item = free; re-select default
  await page.click('#wardTabs [data-wcat="scarf"]'); await page.click('#wardGrid [data-item="scarf:red"]'); await sleep(100);
  ok((await G(page, 'outfit')).scarf === 'red', 'owned (free) items equip with one tap');
  await page.click('#wardClose'); await sleep(150);
  await page.reload(); await sleep(900);
  o = await G(page, 'outfit');
  ok(o.hat === 'straw' && o.glasses === 'round' && (await G(page, 'owned')).length === 4, `outfit + owned items persist across reload (${JSON.stringify(o)})`);
  // in game: the outfit is drawn on the rider (pixels differ from the default outfit)
  await page.click('#start'); await sleep(600);
  await D(page, 'setTime', '1'); await D(page, 'setSpeed', 0.4); await sleep(1500);
  await page.screenshot({ path: `${OUT}/v6-hat-sunglasses.png`, clip: { x: 340, y: 240, width: 600, height: 480 } });
  const crop = () => page.evaluate(() => { const c = document.getElementById('game'), L = window.__pelican.layout; const s = document.createElement('canvas'); s.width = 80; s.height = 80; const g = s.getContext('2d'); const k = c.width / L.W; g.drawImage(c, (L.W / 2 - 60) * k, (L.H - 330) * k, 120 * k, 120 * k, 0, 0, 80, 80); return Array.from(g.getImageData(0, 0, 80, 80).data); });
  await page.click('#pauseBtn'); await sleep(150);
  const withHat = await crop();
  await D(page, 'equipItem', 'hat:none'); await D(page, 'equipItem', 'glasses:none'); await sleep(150);
  const noHat = await crop();
  let diff = 0; for (let i = 0; i < withHat.length; i += 4) if (Math.abs(withHat[i] - noHat[i]) + Math.abs(withHat[i + 1] - noHat[i + 1]) + Math.abs(withHat[i + 2] - noHat[i + 2]) > 60) diff++;
  ok(diff > 150, `hat + sunglasses visibly drawn on the in-game pelican (${diff} px differ around the head)`);
  await D(page, 'equipItem', 'hat:straw'); await D(page, 'equipItem', 'glasses:round');
  await page.click('#resumeBtn'); await sleep(200);
  // the outfit shows on postcards (auto check-in renders the in-game rider)
  const r5 = await rideThroughLandmark(page, 0);
  ok(r5.shot, 'auto check-in with the outfit on (postcard includes the dressed-up pelican)');

  // ---------------------------------------------------------------- export / import / reset
  const txt = await D(page, 'exportSave');
  const ex = JSON.parse(txt);
  ok(ex.game === 'pelican-ride' && ex.v === 2 && ex.outfit.hat === 'straw' && ex.postcards.sea, `export: JSON text (${Math.round(txt.length / 1024)} KB, v${ex.v})`);
  const bad = await D(page, 'importSave', '{"hello": 1}');
  const bad2 = await D(page, 'importSave', 'not json');
  ok(!bad.ok && !bad2.ok, `import rejects junk (「${bad.msg}」 / 「${bad2.msg}」)`);
  ex.coins = 777;
  await page.evaluate(() => document.getElementById('home').click()); await sleep(200);
  await page.click('#settingsBtn'); await sleep(200);
  await page.click('#importBtn'); await sleep(100);
  await page.fill('#saveText', JSON.stringify(ex));
  await Promise.all([page.waitForEvent('load'), page.click('#saveApply')]); await sleep(900);
  s = await S(page);
  ok(s.save.coins === 777 && s.save.outfit.hat === 'straw', `import through the panel replaces the save and reloads (coins ${s.save.coins})`);
  await page.click('#settingsBtn'); await sleep(200);
  await page.click('#resetBtn'); await sleep(100);
  ok(await page.isVisible('#resetConfirm'), '重置存档 asks for confirmation first');
  await page.click('#resetNo'); await sleep(100);
  ok(!(await page.isVisible('#resetConfirm')) && (await S(page)).save.coins === 777, 'cancel keeps the save');
  await page.click('#resetBtn'); await sleep(100);
  await Promise.all([page.waitForEvent('load'), page.click('#resetYes')]); await sleep(900);
  s = await S(page);
  ok(s.save.coins === 0 && !Object.keys(s.save.postcards).length && s.save.outfit.hat === 'none' && s.save.settings.checkin === 'auto', 'confirmed reset wipes progress, outfit and settings');

  // ---------------------------------------------------------------- migration from the batch 1–3 keys
  const mctx = await browser.newContext({ viewport: { width: 1000, height: 640 } });
  await mctx.addInitScript(() => {
    if (localStorage.getItem('__seeded')) return;      // seed the old layout once (sessionStorage is unreliable on file:// reloads)
    localStorage.clear(); localStorage.setItem('__seeded', '1');
    localStorage.setItem('pelicanRide.save.v1', JSON.stringify({ totalDist: 4321, coins: 42, best: { sea: 301 }, rides: { sea: 3 } }));
    localStorage.setItem('pelicanRide.env', JSON.stringify({ tod: 2, weather: 'rain' }));
    localStorage.setItem('pelicanRide.muted', '1');
    localStorage.setItem('pelicanRide.pc.sea.icecream', JSON.stringify({ img: 'data:image/jpeg;base64,AAAA', t: 1700000000000 }));
    localStorage.setItem('pelicanRide.pc.city.ferris', JSON.stringify({ img: 'data:image/jpeg;base64,BBBB', t: 1700000000001 }));
  });
  const mp = await mctx.newPage(); hook(mp);
  await mp.goto(URL); await sleep(800);
  const mi = await G(mp, 'saveInfo');
  s = await S(mp);
  const left = await mp.evaluate(() => Object.keys(localStorage).filter(k => k !== '__seeded'));
  ok(mi.migrated && s.save.coins === 42 && Math.round(s.save.totalDist) === 4321 && s.save.best.sea === 301 && s.save.muted === true && s.save.env.tod === 2 && s.save.env.weather === 'rain'
    && s.save.postcards.sea.icecream && s.save.postcards.city.ferris && s.save.settings.checkin === 'auto', 'old save keys migrate into the single v2 save (progress, env, mute, postcards)');
  ok(left.length === 1 && left[0] === 'pelicanRide.v2', `old keys removed after migration (left: ${JSON.stringify(left)})`);
  await mp.reload(); await sleep(600);
  const mi2 = await G(mp, 'saveInfo'), c2 = (await S(mp)).save.coins;
  ok(!mi2.migrated && c2 === 42, `second load reads the v2 save directly (migrated=${mi2.migrated}, coins ${c2})`);
  await mctx.close();

  // ---------------------------------------------------------------- mobile portrait
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const mob = await m.newPage(); hook(mob);
  await mob.goto(URL); await sleep(900);
  await mob.tap('#start'); await sleep(400);
  const rm = await rideThroughLandmark(mob, 3);
  ok(rm.shot, `mobile: auto check-in at「${rm.lm.name}」with no tap`);
  await sleep(150);
  await mob.screenshot({ path: `${OUT}/v6-mobile-portrait.png` });
  await overlapHud(mob, 'mobile portrait HUD (再拍 + 巡航)');
  await mob.tap('#pauseBtn'); await sleep(200);
  const pfit = await mob.evaluate(() => { const r = document.querySelector('#pause .card').getBoundingClientRect(); const t = document.querySelector('#pause .setseg').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && t.right <= r.right && t.left >= r.left; });
  ok(pfit, 'mobile: pause card (with 打卡 toggle + 设置) fits');
  await mob.tap('#pauseSettingsBtn'); await sleep(250);
  const sfit = await mob.evaluate(() => { const c = document.querySelector('.setcard'); const r = c.getBoundingClientRect(); const rows = [...c.querySelectorAll('.setrow')].every(e => e.getBoundingClientRect().right <= r.right + 1); return r.left >= 0 && r.right <= innerWidth && rows; });
  ok(sfit, 'mobile: settings panel rows fit the width');
  await mob.keyboard.press('Escape'); await sleep(100); await mob.keyboard.press('Escape'); await sleep(100);
  await mob.evaluate(() => document.getElementById('home').click()); await sleep(200);
  await mob.tap('#wardrobeBtn'); await sleep(300);
  const wfit = await mob.evaluate(() => { const r = document.querySelector('.wardcard').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; });
  ok(wfit, 'mobile: wardrobe fits the width');
  await m.close();

  // ---------------------------------------------------------------- PWA: served under a sub-path, SW caches, offline reload
  const PORT = await freePort();
  const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: '/workspace', stdio: 'ignore' });
  await sleep(900);
  const pctx = await browser.newContext({ viewport: { width: 1000, height: 640 } });
  const pp = await pctx.newPage(); hook(pp);
  const base = `http://127.0.0.1:${PORT}/pelican-ride/`;
  await pp.goto(base + 'index.html'); await sleep(500);
  const man = await pp.evaluate(async () => { const r = await fetch(document.querySelector('link[rel=manifest]').href); const j = await r.json(); const icons = await Promise.all(j.icons.map(async i => { const b = await (await fetch(new URL(i.src, r.url))).blob(); const bm = await createImageBitmap(b); return `${i.sizes}:${bm.width}x${bm.height}`; })); return { name: j.name, start: j.start_url, scope: j.scope, display: j.display, icons }; });
  ok(man.display === 'standalone' && man.start === './' && man.icons.includes('192x192:192x192') && man.icons.includes('512x512:512x512'), `manifest + icons load under /pelican-ride/ (${JSON.stringify(man)})`);
  const reg = await pp.evaluate(async () => { const r = await navigator.serviceWorker.ready; return { scope: r.scope, active: !!r.active }; });
  ok(reg.active && reg.scope.endsWith('/pelican-ride/'), `service worker registered + active, scope ${reg.scope}`);
  await until(pp, () => navigator.serviceWorker.controller ? true : null, 3000).catch(() => {});
  const cached = await pp.evaluate(async () => { const keys = await caches.keys(); const c = await caches.open(keys.find(k => k.startsWith('pelican-ride-'))); return { keys, urls: (await c.keys()).map(r => new URL(r.url).pathname) }; });
  const need = ['/pelican-ride/', '/pelican-ride/index.html', '/pelican-ride/game.js', '/pelican-ride/manifest.json', '/pelican-ride/icon-192.png', '/pelican-ride/icon-512.png'];
  ok(need.every(u => cached.urls.includes(u)), `SW cache ${cached.keys} holds ${cached.urls.join(' ')}`);
  srv.kill(); await sleep(300);
  await pctx.setOffline(true);
  await pp.reload(); await sleep(1200);
  const off = await pp.evaluate(() => ({ ok: !!window.__pelican, state: window.__pelican && window.__pelican.stats.state, title: document.title }));
  ok(off.ok && off.state === 'title', `offline reload (server stopped + offline) still runs the game (${JSON.stringify(off)})`);
  await pp.click('#start'); await sleep(800);
  ok((await S(pp)).state === 'play', 'offline: ride starts');
  await pctx.close();

  const real = errors.filter(e => !/ERR_INTERNET_DISCONNECTED|ERR_CONNECTION_REFUSED/.test(e));
  ok(real.length === 0, `no console errors / warnings (${real.length}) ${real.slice(0, 5).join(' | ')}`);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
