// v5 (batch 3) verification: five new routes, route picker, 7-route album, layout, perf. Screenshots v5-*.png
// usage: node v5test.js [url]   (needs playwright-core + /usr/bin/google-chrome)
const { chromium } = require('playwright-core');
const MANUAL = () => { try { if (!localStorage.getItem('pelicanRide.v2')) localStorage.setItem('pelicanRide.v2', JSON.stringify({ v: 2, settings: { checkin: 'manual' } })); } catch (_) {} };   // batch 4: these older checks use 手动打卡 (photo button / C)
const OUT = '/workspace/pelican-ride/screenshots';
const URL = process.argv[2] || 'file:///workspace/pelican-ride/pelican-ride.html';
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const NEW = ['forest', 'sakura', 'town', 'snow', 'city'];
const S = p => p.evaluate(() => window.__pelican.stats);
const D = (p, f, ...a) => p.evaluate(([f, a]) => window.__pelican.debug[f](...a), [f, a]);
async function until(page, fn, ms = 8000, every = 50) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await page.evaluate(fn); if (v) return v; await sleep(every); } return null; }
async function setSpeed(page, frac) {
  const L = await page.evaluate(() => window.__pelican.layout);
  await page.mouse.move(L.slider.x, L.slider.bottom - 3); await page.mouse.down();
  await page.mouse.move(L.slider.x, L.slider.bottom - (L.slider.bottom - L.slider.top) * frac, { steps: 6 }); await page.mouse.up();
}
const frameStats = page => page.evaluate(() => {
  const c = document.getElementById('game'), s = document.createElement('canvas'); s.width = 64; s.height = 36;
  const g = s.getContext('2d'); g.drawImage(c, 0, 0, 64, 36);
  const d = g.getImageData(0, 0, 64, 36).data; let n = 0, sum = 0, sq = 0, sat = 0;
  for (let i = 0; i < d.length; i += 4) { const l = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11; sum += l; sq += l * l; n++; sat += Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]); }
  const lum = sum / n; return { lum, sd: Math.sqrt(Math.max(0, sq / n - lum * lum)), sat: sat / n };
});
async function overlapHud(page, label) {
  const res = await page.evaluate(() => {
    const L = window.__pelican.layout, R = [];
    const add = (n, r) => R.push({ n, l: r.left, t: r.top, r: r.right, b: r.bottom });
    for (const sel of ['#hud', '#routeBtn', '#pauseBtn', '#muteBtn', '#home', '#bellBtn', '#photoBtn']) { const e = document.querySelector(sel); if (!e) continue; const r = e.getBoundingClientRect(); if (r.width && getComputedStyle(e).display !== 'none') add(sel, r); }
    const j = L.joy; add('joystick', { left: j.x - j.r, right: j.x + j.r, top: j.y - j.r - 24, bottom: j.y + j.r });
    const s = L.slider; add('slider', { left: s.x - s.w * 0.75, right: s.x + s.w * 0.75, top: s.top - s.w * 0.38 - 18, bottom: s.bottom + s.w * 0.3 });
    const hits = []; for (let a = 0; a < R.length; a++) for (let b = a + 1; b < R.length; b++) { const A = R[a], B = R[b]; if (A.l < B.r && B.l < A.r && A.t < B.b && B.t < A.b) hits.push(A.n + ' x ' + B.n); }
    return { n: R.length, hits, off: R.filter(r => r.l < 0 || r.t < 0 || r.r > L.W || r.b > L.H).map(r => r.n) };
  });
  ok(!res.hits.length && !res.off.length, `${label}: HUD ${res.n} boxes, hits=${JSON.stringify(res.hits)} off=${JSON.stringify(res.off)}`);
}
// cards of a grid all inside the viewport, inside their card, not overlapping, text not clipped
async function gridLayout(page, gridSel, label) {
  const r = await page.evaluate(sel => {
    const vw = innerWidth, vh = innerHeight, g = document.querySelector(sel), card = g.closest('.card').getBoundingClientRect();
    const cs = [...g.querySelectorAll('.rcard')].map(e => ({ r: e.getBoundingClientRect(), clip: [...e.querySelectorAll('b, .rmeta i')].some(t => t.scrollWidth > t.clientWidth + 1 || t.getBoundingClientRect().right > e.getBoundingClientRect().right + 1) }));
    const hits = []; for (let a = 0; a < cs.length; a++) for (let b = a + 1; b < cs.length; b++) { const A = cs[a].r, B = cs[b].r; if (A.left < B.right - 1 && B.left < A.right - 1 && A.top < B.bottom - 1 && B.top < A.bottom - 1) hits.push(a + 'x' + b); }
    const out = cs.filter(c => c.r.left < 0 || c.r.top < 0 || c.r.right > vw || c.r.bottom > vh || c.r.left < card.left || c.r.right > card.right).length;
    return { n: cs.length, hits, out, clipped: cs.filter(c => c.clip).length, card: { l: card.left, t: card.top, r: card.right, b: card.bottom }, vw, vh, w: cs[0] && cs[0].r.width, cols: new Set(cs.map(c => Math.round(c.r.top / 12))).size };
  }, gridSel);
  const cardIn = r.card.l >= 0 && r.card.t >= 0 && r.card.r <= r.vw && r.card.b <= r.vh;
  ok(r.n === 7 && !r.hits.length && !r.out && !r.clipped && cardIn, `${label}: ${r.n} cards in ${r.cols} row(s), card ${Math.round(r.w)}px wide, overlaps=${r.hits.length} outside=${r.out} clipped=${r.clipped} panelInside=${cardIn}`);
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const errors = [];
  const hook = p => { p.on('console', m => { if (['error', 'warning'].includes(m.type())) errors.push(`[${m.type()}] ${m.text()}`); }); p.on('pageerror', e => errors.push('[pageerror] ' + e.message)); };
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } }); await ctx.addInitScript(MANUAL);
  const page = await ctx.newPage(); hook(page);
  await page.goto(URL); await sleep(900);

  // ---- title route picker
  const cards = await page.evaluate(() => [...document.querySelectorAll('#routes .rcard')].map(b => ({ k: b.dataset.route, txt: b.textContent, pic: getComputedStyle(b.querySelector('.pic')).backgroundImage.startsWith('url("data:image/png') })));
  ok(cards.length === 7 && cards.every(c => c.pic && c.txt.includes('最佳') && c.txt.includes('明信片 0/4')), `title grid: 7 route cards with preview + best + postcards (${cards.map(c => c.k).join(',')})`);
  const s0 = await S(page);
  ok(JSON.stringify(s0.routeKeys) === JSON.stringify(['sea', 'field', 'forest', 'sakura', 'town', 'snow', 'city']), 'ROUTE_KEYS lists all 7 routes');
  await page.click('#routes [data-route="forest"]'); await sleep(700);
  let s = await S(page);
  ok(s.route === 'forest' && (await page.evaluate(() => document.querySelector('#routes .rcard.active').dataset.route)) === 'forest', 'clicking a title card switches the route (森林小道)');
  await gridLayout(page, '#routes', 'title grid 1280x720');
  await page.click('#routes [data-route="sea"]'); await sleep(700);
  await page.screenshot({ path: `${OUT}/v5-route-picker-desktop.png` });

  // ---- in-game 路线 button
  await page.click('#start'); await sleep(400);
  ok(await page.isVisible('#routeBtn'), 'in-game 路线 button visible');
  await page.click('#routeBtn'); await sleep(250);
  s = await S(page);
  ok(await page.isVisible('#routePanel') && s.paused && (await page.$$eval('#routeGrid .rcard', e => e.length)) === 7, '路线 opens the picker (7 cards) and pauses');
  await gridLayout(page, '#routeGrid', 'in-game picker 1280x720');
  await page.keyboard.press('Escape'); await sleep(200);
  s = await S(page);
  ok(!(await page.isVisible('#routePanel')) && !s.paused && s.state === 'play', 'Esc closes the picker and resumes');
  await page.click('#routeBtn'); await sleep(250);
  await page.click('#routeGrid [data-route="sakura"]'); await sleep(900);
  s = await S(page);
  ok(s.route === 'sakura' && s.state === 'play' && !s.paused && s.idx < 30, `picking 樱花大道 starts that journey (idx ${s.idx})`);
  const au = await page.evaluate(() => window.__pelican.audio);
  ok(au.started && au.routeBed === 'sakura', `ambient bed follows the route (${au.routeBed}, level ${au.routeLevel.toFixed(2)})`);

  // ---- every new route: times x weathers render, weather variant per route
  await setSpeed(page, 0.55);
  const looks = {};
  for (const k of NEW) {
    await D(page, 'setRoute', k); await sleep(300);
    s = await S(page);
    ok(s.route === k && s.state === 'play' && s.idx < 30, `${k}: route loaded, ride reset (idx ${s.idx})`);
    const ws = ['clear', 'rain'].concat(s.petalType ? ['petals'] : []);
    for (const tod of [0, 1, 2, 3]) for (const w of ws) {
      await D(page, 'setTime', tod); await D(page, 'setWeather', w); await sleep(380);
      const st = await S(page), fs = await frameStats(page);
      looks[`${k}-${tod}-${w}`] = { ...fs, st };
      const base = k === 'sakura' ? 5 : 0;
      const wOk = w === 'rain' ? st.drops > 30 : w === 'petals' ? st.petalCount > 5 : st.drops === 0 && (base ? st.petalCount > base : st.petalCount === 0);
      ok(wOk && fs.sd > 12 && fs.lum > 10, `${k} ${st.env.phase}/${w}${w === 'rain' ? '(' + st.precip + ')' : ''}: renders (lum ${fs.lum.toFixed(0)} sd ${fs.sd.toFixed(0)}, drops ${st.drops}, petals ${st.petalCount}, lights ${st.lights})`);
    }
    ok(looks[`${k}-3-clear`].lum < looks[`${k}-1-clear`].lum * 0.75, `${k}: night darker than noon (${looks[`${k}-3-clear`].lum.toFixed(0)} vs ${looks[`${k}-1-clear`].lum.toFixed(0)})`);
    ok(looks[`${k}-3-clear`].st.lights >= 3, `${k}: lights/windows glow at night (${looks[`${k}-3-clear`].st.lights})`);
  }
  ok(looks['snow-1-rain'].st.precip === 'snow' && looks['snow-1-rain'].st.drops > 30, 'snow route: "rain" weather is snowfall');
  ok(!looks['city-1-clear'].st.petalType && !looks['snow-1-clear'].st.petalType, 'snow / city offer no petals option');
  const lab = await page.evaluate(() => { document.getElementById('pauseBtn').click(); const t = [...document.querySelectorAll('#pause .envseg[data-kind="weather"] button')].map(b => b.hidden ? '' : b.textContent).filter(Boolean).join('/'); document.getElementById('pauseBtn').click(); return t; });
  ok(lab === '自动/晴/小雨', `city pause picker weather options: ${lab}`);

  // ---- sakura petals always fall; city defaults to night + fireworks
  await D(page, 'setRoute', 'sakura'); await D(page, 'setWeather', 'clear'); await D(page, 'setTime', 1); await sleep(1500);
  s = await S(page);
  ok(s.petalCount > 5, `sakura: petals fall even in clear weather (${s.petalCount})`);
  await D(page, 'setRoute', 'snow'); await sleep(1600); s = await S(page);
  ok(s.petalCount === 0, `snow: no stray petals after switching from sakura (${s.petalCount})`);
  await D(page, 'setRoute', 'city'); await D(page, 'setTime', 'auto'); await D(page, 'setWeather', 'clear'); await sleep(2200);
  s = await S(page);
  ok(s.env.todMode === 'auto' && s.env.night > 0.9, `city: auto time holds night (night ${s.env.night.toFixed(2)})`);
  const fw0 = s.fireworks; await D(page, 'firework'); await sleep(2600); s = await S(page);
  ok(s.fireworks > fw0, `city: fireworks burst (${fw0} -> ${s.fireworks})`);
  await D(page, 'setTime', 1); await sleep(300);

  // ---- landmarks: postcards at all 4 per new route, then the finish
  for (const k of NEW) {
    await D(page, 'setRoute', k); await sleep(200);
    await D(page, 'setTime', k === 'city' ? 3 : 1); await D(page, 'setWeather', 'clear');
    const lms = await D(page, 'landmarks');
    ok(lms.length === 4, `${k}: 4 landmarks (${lms.map(l => l.name).join(' / ')})`);
    for (let i = 0; i < 4; i++) {
      await D(page, 'warpToLandmark', i, 40);
      const z = await until(page, `window.__pelican.stats.zone === ${JSON.stringify(lms[i].id)}`, 5000);
      await sleep(250); await page.keyboard.press('KeyC'); await sleep(250);
      const pc = await page.evaluate(([k, id]) => { const v = ((JSON.parse(localStorage.getItem('pelicanRide.v2') || 'null') || {}).postcards || {})[k]?.[id]; return v && v.img && v.img.startsWith('data:image/jpeg') ? v.img.length : 0; }, [k, lms[i].id]);
      ok(z && pc > 2000, `${k}: postcard「${lms[i].name}」captured (${(pc / 1024).toFixed(0)} KB)`);
      if (k === 'forest' && i === 1) { await sleep(500); await page.screenshot({ path: `${OUT}/v5-forest.png` }); }
    }
    s = await S(page);
    ok(s.photosThisRide.length === 4, `${k}: progress shows 4/4 this ride`);
    if (k === 'snow') {           // check the bridge railing / lake clamp keep the rider out of the water
      const ice = lms[2]; await D(page, 'warpIdx', ice.idx - 20); await D(page, 'setX', -2.3); await sleep(700); s = await S(page);
      ok(s.playerX >= -1.55, `snow: rider eased off the frozen lake edge (x ${s.playerX.toFixed(2)})`);
    }
    if (k === 'city') {
      const br = lms[2]; await D(page, 'warpIdx', br.idx - 10); await D(page, 'setX', 1.8); await sleep(700); s = await S(page);
      ok(s.onBridge && Math.abs(s.playerX) <= 1.03, `city: bridge railings keep the rider on the deck (x ${s.playerX.toFixed(2)})`);
    }
    await D(page, 'warp', 0.99);
    const fin = await until(page, () => !document.getElementById('results').classList.contains('hidden'), 15000);
    s = await S(page);
    ok(fin && s.state === 'finished' && (await page.textContent('#resPc')).includes('4 / 4'), `${k}: finish reachable, results card (${await page.textContent('#resTitle')})`);
    await page.click('#againBtn'); await sleep(300);
  }

  // ---- results 换路线 opens the picker; picks a route
  await D(page, 'warp', 0.99);
  await until(page, () => !document.getElementById('results').classList.contains('hidden'), 15000);
  await page.click('#switchBtn'); await sleep(300);
  ok(await page.isVisible('#routePanel'), 'results 换路线 opens the route picker');
  await page.click('#routeGrid [data-route="forest"]'); await sleep(900);
  s = await S(page);
  ok(s.route === 'forest' && s.state === 'play' && s.idx < 30, 'picker from results starts the chosen journey');

  // ---- route screenshots (one per new route)
  const shot = async (k, tod, w, lm, before, name, extra) => {
    await D(page, 'setRoute', k); await D(page, 'setTime', tod); await D(page, 'setWeather', w); await setSpeed(page, 0.45);
    await D(page, 'warpToLandmark', lm, before); await sleep(300);
    if (extra) await extra();
    await sleep(1400);
    await page.screenshot({ path: `${OUT}/${name}.png` });
  };
  await shot('sakura', 0, 'clear', 0, 34, 'v5-sakura');
  await shot('town', 1, 'clear', 3, 44, 'v5-town');
  await shot('snow', 1, 'rain', 1, 34, 'v5-snow');
  await shot('city', 3, 'clear', 1, 64, 'v5-city', async () => { await setSpeed(page, 0.25); await sleep(300); await D(page, 'firework'); await D(page, 'firework'); await sleep(250); await D(page, 'firework'); });
  ok((await S(page)).env.night > 0.9, 'v5-city shot at night');

  // ---- album: 7 tabs
  await page.click('#home'); await sleep(300);
  const meta = await page.evaluate(() => [...document.querySelectorAll('#routes .rcard')].map(b => b.dataset.route + ':' + b.querySelector('.rmeta').textContent.replace(/\s+/g, ' ')));
  ok(NEW.every(k => meta.find(m => m.startsWith(k + ':') && m.includes('明信片 4/4'))), `title cards show postcards x/4 (${meta.join(' | ')})`);
  ok((await page.textContent('#totals')).includes('20/28'), 'title totals: ' + (await page.textContent('#totals')));
  await page.click('#albumBtn'); await sleep(300);
  const tabs = await page.$$eval('#albTabs [data-atab]', e => e.map(b => b.dataset.atab + ' ' + b.textContent));
  ok(tabs.length === 7, `album has 7 tabs (${tabs.join(', ')})`);
  for (const k of NEW) {
    await page.click(`#albTabs [data-atab="${k}"]`); await sleep(150);
    const n = await page.$$eval('#albGrid img', e => e.length);
    ok(n === 4, `album ${k} tab shows 4 postcards`);
  }
  await page.click('#albTabs [data-atab="sakura"]'); await sleep(300);
  await page.screenshot({ path: `${OUT}/v5-album.png` });
  await page.click('#albumClose'); await sleep(200);

  // ---- perf: heaviest scene (night city, lit windows + bloom + fireworks)
  await page.click('#routes [data-route="city"]'); await sleep(700);
  await page.click('#start'); await D(page, 'setTime', 3); await D(page, 'setWeather', 'clear'); await setSpeed(page, 0.8); await D(page, 'warpToLandmark', 1, 30); await D(page, 'firework');
  await sleep(600);
  const fps = await page.evaluate(() => new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(n / 2); }; requestAnimationFrame(f); }));
  ok(fps > 20, `frame rate night city (headless software GL): ${fps.toFixed(0)} fps`);
  await overlapHud(page, 'in-game 1280x720');

  // ---- layouts: 390x844 portrait, 844x390 landscape
  for (const [w, h, tag] of [[390, 844, 'mobile'], [844, 390, 'landscape']]) {
    const c2 = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); await c2.addInitScript(MANUAL);
    const p2 = await c2.newPage(); hook(p2);
    await p2.goto(URL); await sleep(900);
    await gridLayout(p2, '#routes', `title grid ${w}x${h}`);
    if (tag === 'mobile') await p2.screenshot({ path: `${OUT}/v5-route-picker-mobile.png` });
    else await p2.screenshot({ path: `${OUT}/v5-route-picker-landscape.png` });
    await p2.tap('#start'); await sleep(500);
    await overlapHud(p2, `in-game ${w}x${h}`);
    await p2.tap('#routeBtn'); await sleep(300);
    await gridLayout(p2, '#routeGrid', `in-game picker ${w}x${h}`);
    if (tag === 'mobile') await p2.screenshot({ path: `${OUT}/v5-route-panel-mobile.png` });
    await p2.tap('#routeGrid [data-route="snow"]'); await sleep(900);
    const st = await p2.evaluate(() => window.__pelican.stats);
    ok(st.route === 'snow' && st.state === 'play', `${w}x${h}: tap a card in the picker -> 雪山之路`);
    await p2.tap('#pauseBtn'); await sleep(200); await p2.tap('#pauseAlbumBtn'); await sleep(300);
    const alb = await p2.evaluate(() => { const c = document.querySelector('.albumcard').getBoundingClientRect(), t = [...document.querySelectorAll('#albTabs button')].map(b => b.getBoundingClientRect()); return { inside: c.left >= 0 && c.right <= innerWidth && c.top >= 0 && c.bottom <= innerHeight, tabsIn: t.every(r => r.left >= c.left && r.right <= c.right), n: t.length }; });
    ok(alb.inside && alb.tabsIn && alb.n === 7, `${w}x${h}: album card + 7 tabs fit`);
    if (tag === 'mobile') await p2.screenshot({ path: `${OUT}/v5-album-mobile.png` });
    await c2.close();
  }

  ok(errors.length === 0, 'no console errors/warnings' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
  await browser.close();
})();
